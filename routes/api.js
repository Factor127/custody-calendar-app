const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const { db, q, generateDaysFromPattern, checkAndRenewConnection, upsertManyDays, toDateStr } = require('../db');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const { buildInvite, buildCancellation, buildSubscribeFeed } = require('../utils/ical');
const { sendCalendarInvite, sendEmail } = require('../utils/email');

// ── Auth helper ───────────────────────────────────────────────────────────────

function requireToken(req, res) {
  const token = req.query.token || req.body.token || req.headers['x-access-token'];
  if (!token) { res.status(401).json({ error: 'Missing token' }); return null; }
  const user = q.getUserByToken.get(token);
  if (!user) { res.status(403).json({ error: 'Invalid token' }); return null; }
  return user;
}

// Normalise pattern_data to canonical key names before storing
function normalizePatternData(pattern_type, pattern_data) {
  if (pattern_type !== 'alternating_weeks' || !pattern_data) return pattern_data;
  const d = typeof pattern_data === 'string' ? JSON.parse(pattern_data) : pattern_data;
  // Map onboarding keys → canonical keys
  if (!d.week_a_days && d.week1_self_days) d.week_a_days = d.week1_self_days;
  if (!d.week_b_days && d.week2_self_days) d.week_b_days = d.week2_self_days;
  delete d.week1_self_days;
  delete d.week2_self_days;
  return d;
}

function requireOwner(req, res) {
  const user = requireToken(req, res);
  if (!user) return null;
  if (user.role !== 'owner') { res.status(403).json({ error: 'Owner access required' }); return null; }
  return user;
}

// ── First-time setup ──────────────────────────────────────────────────────────

// POST /api/users/setup — create owner account
// Multi-tenant: any email can set up their own account (no single-owner constraint).
// Requires a valid magic token (proof of email ownership from /api/auth/request flow).
router.post('/users/setup', (req, res) => {
  const { magic, name, pattern_type, pattern_data, anchor_date, days, google_id } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
  if (!magic) return res.status(400).json({ error: 'Email verification required. Please use the link sent to your email.' });

  // Validate the magic link (must be unused and unexpired)
  const link = q.getMagicLink.get(magic);
  if (!link) return res.status(400).json({ error: 'Your verification link is invalid or has expired. Please request a new one.' });
  if (link.user_id) return res.status(409).json({ error: 'This email already has an account. Please log in instead.' });

  // Consume the magic link and create the account
  q.useMagicLink.run(magic);

  const id = uuidv4();
  const token = uuidv4();
  q.createUserWithEmail.run(id, name.trim(), 'owner', token, link.email);

  // Link Google ID if the user came via Google SSO
  if (google_id) q.updateGoogleId.run(google_id, id);

  // Save pattern for future reference / regeneration
  if (pattern_type && pattern_type !== 'none') {
    const normData = normalizePatternData(pattern_type, pattern_data);
    q.upsertPattern.run(id, pattern_type, JSON.stringify(normData || {}), anchor_date || null);

    // For structured patterns, generate 12 months of days as a baseline
    if (pattern_type !== 'custom') {
      const start = toDateStr(new Date());
      const yearOut = new Date(); yearOut.setFullYear(yearOut.getFullYear() + 1);
      const fakePattern = { pattern_type, pattern_data: JSON.stringify(normData || {}), anchor_date };
      upsertManyDays(id, generateDaysFromPattern(fakePattern, start, toDateStr(yearOut)));
    }
  }

  // Save reviewed/edited days from the wizard (overrides generated days for the covered period)
  if (days && Array.isArray(days) && days.length > 0) {
    upsertManyDays(id, days);
  }

  res.json({ token, message: 'Owner created. Save your personal URL.' });
});

// ── Pattern & calendar generation ─────────────────────────────────────────────

// POST /api/pattern/generate — preview generated days without saving
router.post('/pattern/generate', (req, res) => {
  const { pattern_type, pattern_data, anchor_date } = req.body;
  if (!pattern_type) return res.status(400).json({ error: 'pattern_type required' });

  const today = new Date();
  const start = toDateStr(today);
  const end = toDateStr(new Date(today.getTime() + 90 * 24 * 60 * 60 * 1000)); // 90 days

  const fakePattern = { pattern_type, pattern_data: JSON.stringify(pattern_data || {}), anchor_date };
  const days = generateDaysFromPattern(fakePattern, start, end);

  res.json({ days, start, end });
});

// POST /api/users/register — complete partner onboarding
router.post('/users/register', (req, res) => {
  const { invite_token, name, email, pattern_type, pattern_data, anchor_date, days } = req.body;

  if (!invite_token) return res.status(400).json({ error: 'invite_token required' });
  if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });

  const invite = q.getInvite.get(invite_token);
  if (!invite) return res.status(404).json({ error: 'Invite not found' });
  if (invite.used_by) return res.status(409).json({ error: 'Invite already used' });
  if (invite.expires_at && invite.expires_at < new Date().toISOString()) {
    return res.status(410).json({ error: 'Invite expired' });
  }

  // Email is required — it's the recovery mechanism for the partner account
  if (!email || !email.trim().includes('@')) {
    return res.status(400).json({ error: 'Email address is required to create your account.' });
  }
  const normalEmail = email.trim().toLowerCase();
  const normalMobile = req.body.mobile ? req.body.mobile.trim() : null;
  const existing = q.getUserByEmail.get(normalEmail);
  if (existing) return res.status(409).json({ error: 'An account with that email already exists. Try logging in instead.' });

  const userId = uuidv4();
  const token = uuidv4();
  q.createUserWithEmail.run(userId, name.trim(), 'partner', token, normalEmail);
  if (normalMobile) q.updateUserMobile.run(normalMobile, userId);

  // Mark invite as used
  q.claimInvite.run(userId, invite_token);

  // Save pattern if provided
  if (pattern_type && pattern_type !== 'custom') {
    const normData = normalizePatternData(pattern_type, pattern_data);
    q.upsertPattern.run(userId, pattern_type, JSON.stringify(normData || {}), anchor_date || null);

    // Auto-generate days for the next 12 months
    const start = toDateStr(new Date());
    const yearOut = new Date(); yearOut.setFullYear(yearOut.getFullYear() + 1);
    const fakePattern = { pattern_type, pattern_data: JSON.stringify(normData || {}), anchor_date };
    upsertManyDays(userId, generateDaysFromPattern(fakePattern, start, toDateStr(yearOut)));
  }

  // Save manual days if provided (custom mode)
  if (days && Array.isArray(days) && days.length > 0) {
    upsertManyDays(userId, days);
  }

  // Mirror mode: generate partner days as inverse of owner's calendar
  if (req.body.is_mirror) {
    const ownerDays = q.getDaysForUser.all(invite.created_by);
    const mirroredDays = ownerDays.map(d => ({
      date: d.date,
      owner: d.owner === 'self' ? 'coparent' : 'self',
      tags: []
    }));
    upsertManyDays(userId, mirroredDays);
  }

  // Auto-create a pending connection request to the invite creator (owner)
  // so the owner sees the new person in their connections panel immediately.
  const existingConn = q.getConnectionByRequester.get(userId);
  if (!existingConn) {
    const connId = uuidv4();
    q.createConnection.run(connId, userId, invite.created_by);
    // Stamp the relationship_type from the invite directly onto the connection
    q.updateConnectionRole.run(invite.relationship_type || 'coparent', connId);
  }

  res.json({ token, userId, message: 'Registered successfully' });
});

// ── Calendar data ─────────────────────────────────────────────────────────────

// GET /api/calendar/owner?token= — partner fetches their co-parent's calendar
// MUST be declared before /calendar/:userId or Express will treat 'owner' as a userId param
// Multi-tenant: finds the owner via the partner's connection (not global getOwner)
router.get('/calendar/owner', (req, res) => {
  const partner = requireToken(req, res);
  if (!partner) return;
  if (partner.role !== 'partner') return res.status(403).json({ error: 'Partner access only' });

  // Find which owner this partner is connected to (multi-tenant safe)
  const conn = q.getConnectionByRequester.get(partner.id);
  if (!conn) return res.status(403).json({ error: 'No connection found' });

  const owner = q.getUserById.get(conn.target_id);
  if (!owner) return res.status(404).json({ error: 'Co-parent account not found' });

  const approvedConn = q.getApprovedConnection.get(partner.id, owner.id);
  if (!approvedConn) return res.status(403).json({ error: 'No approved connection' });

  const live = checkAndRenewConnection(approvedConn);
  if (live.status !== 'approved') {
    return res.status(403).json({ error: 'Connection expired', status: live.status });
  }

  const days = q.getDaysForUser.all(owner.id);
  res.json({ days: days.map(parseTags), approved_until: live.approved_until, user: { name: owner.name, id: owner.id } });
});

// GET /api/calendar/:userId?token= — get calendar days for a user
// If requester is the user themselves → full data
// If requester is approved partner viewing owner → owner's days only (no partner layer)
router.get('/calendar/:userId', (req, res) => {
  const requester = requireToken(req, res);
  if (!requester) return;

  const { userId } = req.params;
  const targetUser = q.getUserById.get(userId);
  if (!targetUser) return res.status(404).json({ error: 'User not found' });

  // Self-access: always allowed
  if (requester.id === userId) {
    const days = q.getDaysForUser.all(userId);
    return res.json({ days: days.map(parseTags), user: { name: targetUser.name, id: targetUser.id, role: targetUser.role } });
  }

  // Cross-access: check for any approved connection between the two users (symmetric)
  const conn = db.prepare(`
    SELECT * FROM connections
    WHERE status = 'approved'
    AND ((requester_id = ? AND target_id = ?) OR (requester_id = ? AND target_id = ?))
    LIMIT 1
  `).get(requester.id, userId, userId, requester.id);

  if (!conn) return res.status(403).json({ error: 'No approved connection' });

  const live = checkAndRenewConnection(conn);
  if (live.status !== 'approved') {
    return res.status(403).json({ error: 'Connection expired', status: live.status });
  }

  // Direction-aware share window: requester sees target's calendar until target_share_until
  const iAmRequester = live.requester_id === requester.id;
  const effectiveUntil = iAmRequester
    ? (live.target_share_until || live.approved_until)
    : (live.requester_share_until || live.approved_until);

  const days = q.getDaysForUser.all(userId);
  return res.json({
    days: days.map(parseTags),
    approved_until: effectiveUntil,
    user: { name: targetUser.name, id: targetUser.id }
  });
});

// POST /api/calendar/save — bulk save days for the calling user
router.post('/calendar/save', (req, res) => {
  const user = requireToken(req, res);
  if (!user) return;

  const { days } = req.body;
  if (!Array.isArray(days)) return res.status(400).json({ error: 'days must be an array' });

  upsertManyDays(user.id, days);
  res.json({ saved: days.length });
});

// ── Invites ───────────────────────────────────────────────────────────────────

// POST /api/invites/generate — any authenticated user generates an invite link
// Owners can invite co-parents or partners; partners can invite their own partner.
router.post('/invites/generate', (req, res) => {
  const user = requireToken(req, res);
  if (!user) return;

  // Partners may only generate partner-type invites
  const relType = ['partner', 'friend'].includes(req.body.relationship_type)
    ? req.body.relationship_type
    : 'coparent';

  const token = uuidv4();
  q.createInvite.run(token, user.id, null, relType);

  const BASE_URL = req.app.locals.BASE_URL;
  res.json({ invite_url: `${BASE_URL}/invite/${token}`, token, relationship_type: relType });
});

// GET /api/invites/:token — validate an invite token (used by onboarding page)
router.get('/invites/:token', (req, res) => {
  const token = req.params.token;
  console.log(`[invite-validate] token="${token}"`);
  const invite = q.getInvite.get(token);
  if (!invite) {
    console.log(`[invite-validate] NOT FOUND for token="${token}"`);
    return res.status(404).json({ error: 'Invite not found' });
  }
  if (invite.used_by) {
    console.log(`[invite-validate] ALREADY USED by "${invite.used_by}" for token="${token}"`);
    return res.status(409).json({ error: 'Invite already used', used: true });
  }
  const owner = q.getUserById.get(invite.created_by);
  console.log(`[invite-validate] OK — owner="${owner?.name}", relType="${invite.relationship_type}"`);
  res.json({ valid: true, owner_name: owner?.name || 'your partner' });
});

// ── Connections ───────────────────────────────────────────────────────────────

// POST /api/connections/request — partner requests to view owner's calendar
// Multi-tenant: finds the specific owner this partner was invited by (via invite.created_by)
router.post('/connections/request', (req, res) => {
  const partner = requireToken(req, res);
  if (!partner) return;
  if (partner.role !== 'partner') return res.status(403).json({ error: 'Only partners can request connections' });

  // Find the owner this partner was invited by
  const invite = q.getInviteByUsedBy.get(partner.id);
  if (!invite) return res.status(404).json({ error: 'No invite found for this account' });
  const owner = q.getUserById.get(invite.created_by);
  if (!owner) return res.status(404).json({ error: 'Co-parent account not found' });

  // Check if already requested/approved
  const existing = q.getConnectionByRequester.get(partner.id);
  if (existing && (existing.status === 'pending' || existing.status === 'approved')) {
    return res.json({ connection: existing, already_exists: true });
  }

  const connId = uuidv4();
  q.createConnection.run(connId, partner.id, owner.id);

  const desiredDays = parseInt(req.body.desired_duration_days, 10) || null;
  if (desiredDays) q.updateDesiredDuration.run(desiredDays, connId);

  res.json({ connection_id: connId, status: 'pending', message: 'Request sent to owner for approval' });
});

// GET /api/connections/status?token= — partner polls their connection status
router.get('/connections/status', (req, res) => {
  const partner = requireToken(req, res);
  if (!partner) return;

  const conn = q.getConnectionByRequester.get(partner.id);
  if (!conn) return res.json({ status: 'none' });

  const live = checkAndRenewConnection(conn);
  const owner = q.getUserById.get(conn.target_id);

  res.json({
    status: live.status,
    approved_until: live.approved_until,
    auto_renew: Boolean(live.auto_renew),
    owner_name: owner?.name,
    connection_id: live.id,
    desired_duration_days: live.desired_duration_days || null
  });
});

// GET /api/connections/pending?token= — owner sees pending requests
router.get('/connections/pending', (req, res) => {
  const owner = requireOwner(req, res);
  if (!owner) return;

  const pending = q.getPendingConnections.all(owner.id);
  res.json({ pending });
});

// GET /api/connections/all?token= — any authenticated user sees all their connections (both sides)
router.get('/connections/all', (req, res) => {
  const user = requireToken(req, res);
  if (!user) return;
  const connections = q.getAllConnectionsForUser.all(user.id, user.id, user.id, user.id, user.id);
  const live = connections.map(c => {
    const renewed = checkAndRenewConnection(c);
    const iAmRequester = renewed.requester_id === user.id;
    // their_share_until = how long THEY share their calendar with ME
    // my_share_until    = how long I share MY calendar with THEM
    const their_share_until = iAmRequester
      ? (renewed.target_share_until || renewed.approved_until)
      : (renewed.requester_share_until || renewed.approved_until);
    const my_share_until = iAmRequester
      ? (renewed.requester_share_until || renewed.approved_until)
      : (renewed.target_share_until || renewed.approved_until);
    return { ...renewed, their_share_until, my_share_until };
  });
  res.json({ connections: live });
});

// POST /api/connections/approve — the targeted user approves a connection request
router.post('/connections/approve', (req, res) => {
  const user = requireToken(req, res);
  if (!user) return;

  const { connection_id, duration_days, auto_renew } = req.body;
  if (!connection_id) return res.status(400).json({ error: 'connection_id required' });
  if (!duration_days || duration_days < 1) return res.status(400).json({ error: 'duration_days required' });

  const conn = q.getConnectionById.get(connection_id);
  if (!conn) return res.status(404).json({ error: 'Connection not found' });
  if (conn.target_id !== user.id) return res.status(403).json({ error: 'Not your connection to approve' });

  q.approveConnection.run(
    Number(duration_days),
    Number(duration_days),
    Number(duration_days),
    auto_renew ? 1 : 0,
    connection_id
  );

  res.json({ status: 'approved', duration_days, auto_renew: Boolean(auto_renew) });
});

// POST /api/connections/reject — either party can disconnect
router.post('/connections/reject', (req, res) => {
  const user = requireToken(req, res);
  if (!user) return;

  const { connection_id } = req.body;
  const conn = q.getConnectionById.get(connection_id);
  if (!conn || (conn.target_id !== user.id && conn.requester_id !== user.id)) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  q.rejectConnection.run(connection_id);
  res.json({ status: 'rejected' });
});

// POST /api/connections/auto-renew — connection target toggles auto-renew
router.post('/connections/auto-renew', (req, res) => {
  const user = requireToken(req, res);
  if (!user) return;
  const owner = user; // keep variable name for downstream compat

  const { connection_id, auto_renew } = req.body;
  const conn = q.getConnectionById.get(connection_id);
  if (!conn || conn.target_id !== owner.id) return res.status(403).json({ error: 'Not authorized' });

  q.updateAutoRenew.run(auto_renew ? 1 : 0, connection_id);
  res.json({ auto_renew: Boolean(auto_renew) });
});

// PUT /api/connections/:id/my-share — either party updates how long they share THEIR calendar
router.put('/connections/:id/my-share', (req, res) => {
  const user = requireToken(req, res);
  if (!user) return;

  const { duration_days } = req.body;
  const days = Number(duration_days);
  if (!days || days < 1) return res.status(400).json({ error: 'duration_days required' });

  const conn = q.getConnectionById.get(req.params.id);
  if (!conn || (conn.requester_id !== user.id && conn.target_id !== user.id)) {
    return res.status(403).json({ error: 'Not authorized' });
  }

  const newUntil = new Date();
  newUntil.setDate(newUntil.getDate() + days);
  const newUntilStr = newUntil.toISOString().slice(0, 10);

  if (conn.requester_id === user.id) {
    q.setRequesterShare.run(newUntilStr, days, conn.id);
  } else {
    // Target updating their own share — also update approved_until for backward compat
    q.setTargetShare.run(newUntilStr, days, newUntilStr, conn.id);
  }

  res.json({ ok: true, my_share_until: newUntilStr });
});

// GET /api/connections/:id/coparent-mobile — get co-parent's mobile for WhatsApp
router.get('/connections/:id/coparent-mobile', (req, res) => {
  const user = requireToken(req, res);
  if (!user) return;
  const conn = q.getConnectionById.get(req.params.id);
  if (!conn) return res.status(404).json({ error: 'Not found' });
  if (conn.requester_id !== user.id && conn.target_id !== user.id) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  const otherId = conn.requester_id === user.id ? conn.target_id : conn.requester_id;
  const other = db.prepare('SELECT mobile FROM users WHERE id = ?').get(otherId);
  res.json({ mobile: other?.mobile || null });
});

// PUT /api/connections/:id/rerequest — partner re-requests access with a preferred duration
router.put('/connections/:id/rerequest', (req, res) => {
  const partner = requireToken(req, res);
  if (!partner) return;

  const conn = q.getConnectionById.get(req.params.id);
  if (!conn || conn.requester_id !== partner.id) return res.status(403).json({ error: 'Not authorized' });
  if (conn.status !== 'expired' && conn.status !== 'rejected') {
    return res.status(400).json({ error: 'Connection is not expired or rejected' });
  }

  const desiredDays = parseInt(req.body.desired_duration_days, 10) || 30;
  // Reset to pending and store the desired duration
  db.prepare("UPDATE connections SET status = 'pending', desired_duration_days = ? WHERE id = ?").run(desiredDays, conn.id);
  res.json({ ok: true, status: 'pending' });
});

// PUT /api/connections/:id/role — owner changes the relationship type label
router.put('/connections/:id/role', (req, res) => {
  const user = requireToken(req, res);
  if (!user) return;

  const { relationship_type } = req.body;
  if (!['coparent', 'partner', 'friend'].includes(relationship_type)) {
    return res.status(400).json({ error: 'relationship_type must be coparent, partner, or friend' });
  }

  const conn = q.getConnectionById.get(req.params.id);
  if (!conn || (conn.requester_id !== user.id && conn.target_id !== user.id)) {
    return res.status(403).json({ error: 'Not authorized' });
  }

  q.updateConnectionRole.run(relationship_type, req.params.id);
  res.json({ relationship_type });
});

// ── Suggestions (co-parent proposes schedule change to owner) ─────────────────

// POST /api/suggestions — any connected user submits a proposed schedule change to the other
router.post('/suggestions', (req, res) => {
  const me = requireToken(req, res);
  if (!me) return;

  const { changes, note } = req.body;
  if (!Array.isArray(changes) || changes.length === 0) {
    return res.status(400).json({ error: 'changes must be a non-empty array' });
  }

  // Find the approved connection — works for both partner (as requester) and owner (as target)
  let conn = q.getConnectionByRequester.get(me.id);
  if (!conn || conn.status !== 'approved') {
    // Owner role: look for any approved connection where they are the target
    conn = db.prepare(
      "SELECT * FROM connections WHERE target_id = ? AND status = 'approved' ORDER BY created_at DESC LIMIT 1"
    ).get(me.id);
  }
  if (!conn || conn.status !== 'approved') {
    return res.status(403).json({ error: 'No active connection' });
  }

  // Send to the other party
  const toUserId = conn.requester_id === me.id ? conn.target_id : conn.requester_id;

  const id = uuidv4();
  q.createSuggestion.run(id, me.id, toUserId, JSON.stringify(changes), note || null);
  res.json({ id, status: 'pending' });
});

// GET /api/suggestions/pending — any authenticated user sees suggestions sent to them
router.get('/suggestions/pending', (req, res) => {
  const me = requireToken(req, res);
  if (!me) return;

  const suggestions = q.getPendingSuggestionsForOwner.all(me.id);
  res.json({
    suggestions: suggestions.map(s => ({ ...s, changes: JSON.parse(s.changes) }))
  });
});

// POST /api/suggestions/:id/approve — recipient approves; changes applied to both calendars
router.post('/suggestions/:id/approve', (req, res) => {
  const me = requireToken(req, res);
  if (!me) return;

  const s = q.getSuggestionById.get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Suggestion not found' });
  if (s.to_user_id !== me.id) return res.status(403).json({ error: 'Not your suggestion to approve' });
  if (s.status !== 'pending') return res.status(409).json({ error: 'Suggestion already handled' });

  const changes = JSON.parse(s.changes);

  // Apply each change — proposed_owner is always from the sender's (from_user_id) perspective
  db.exec('BEGIN');
  try {
    for (const c of changes) {
      const existingFrom = q.getDay.get(s.from_user_id, c.date);
      const existingTo   = q.getDay.get(me.id, c.date);
      // Sender's calendar: apply proposed_owner as-is
      q.upsertDay.run(s.from_user_id, c.date, c.proposed_owner, existingFrom?.tags || '[]');
      // Recipient's calendar: flip perspective
      const toOwner = c.proposed_owner === 'self' ? 'coparent' : 'self';
      q.upsertDay.run(me.id, c.date, toOwner, existingTo?.tags || '[]');
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  q.updateSuggestionStatus.run('approved', s.id);
  res.json({ status: 'approved', applied: changes.length });
});

// POST /api/suggestions/:id/reject — recipient declines suggestion
router.post('/suggestions/:id/reject', (req, res) => {
  const me = requireToken(req, res);
  if (!me) return;

  const s = q.getSuggestionById.get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Suggestion not found' });
  if (s.to_user_id !== me.id) return res.status(403).json({ error: 'Not your suggestion' });
  if (s.status !== 'pending') return res.status(409).json({ error: 'Suggestion already handled' });

  q.updateSuggestionStatus.run('rejected', s.id);
  res.json({ status: 'rejected' });
});

// ── Import existing HTML backup ───────────────────────────────────────────────

// POST /api/import/html?token= — owner uploads backup HTML, we parse + seed DB
router.post('/import/html', upload.single('file'), (req, res) => {
  const owner = requireOwner(req, res);
  if (!owner) return;

  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const html = req.file.buffer.toString('utf-8');
  const days = parseHtmlBackup(html);

  if (days.length === 0) return res.status(400).json({ error: 'No calendar data found in file' });

  upsertManyDays(owner.id, days);
  res.json({ imported: days.length });
});

/**
 * Parse the backup HTML and extract custody day data.
 * Looks for <td class="r"> or <td class="z"> with a .day-num and .month-title.
 * Returns [{ date: 'YYYY-MM-DD', owner: 'self'|'coparent', tags: [] }]
 */
function parseHtmlBackup(html) {
  const days = [];
  const MONTH_MAP = {
    'January': 1, 'February': 2, 'March': 3, 'April': 4,
    'May': 5, 'June': 6, 'July': 7, 'August': 8,
    'September': 9, 'October': 10, 'November': 11, 'December': 12
  };

  // Split into month blocks
  const monthBlocks = html.split('<div class="month">');
  for (const block of monthBlocks.slice(1)) {
    // Extract month/year from title
    const titleMatch = block.match(/class="month-title">([^<]+)<\/div>/);
    if (!titleMatch) continue;
    const titleText = titleMatch[1].trim();
    const titleParts = titleText.match(/(\w+)\s+(\d{4})/);
    if (!titleParts) continue;
    const monthNum = MONTH_MAP[titleParts[1]];
    const year = parseInt(titleParts[2]);
    if (!monthNum || !year) continue;

    // Extract all td.r and td.z cells
    const cellRegex = /<td\s+class="([^"]*(?:^|\s)(?:r|z)(?:\s|$)[^"]*)"[^>]*>([\s\S]*?)<\/td>/g;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(block)) !== null) {
      const classList = cellMatch[1];
      const cellContent = cellMatch[2];

      // Determine owner: 'r' class means R has kids (→ self for R = owner)
      const isR = /(?:^|\s)r(?:\s|$)/.test(classList);
      const isZ = /(?:^|\s)z(?:\s|$)/.test(classList);
      if (!isR && !isZ) continue;
      const owner = isR ? 'self' : 'coparent';

      // Extract day number
      const dayMatch = cellContent.match(/class="day-num">\s*(\d+)/);
      if (!dayMatch) continue;
      const dayNum = parseInt(dayMatch[1]);
      if (!dayNum) continue;

      // Extract tags
      const tags = [];
      const tagRegex = /class="tag">([^<]+)<\/span>/g;
      let tagMatch;
      while ((tagMatch = tagRegex.exec(cellContent)) !== null) {
        tags.push(tagMatch[1].trim());
      }

      // Build ISO date string
      const dateStr = `${year}-${String(monthNum).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
      days.push({ date: dateStr, owner, tags });
    }
  }

  return days;
}

// ── Owner info ────────────────────────────────────────────────────────────────

// GET /api/me?token= — get current user info
router.get('/me', (req, res) => {
  const user = requireToken(req, res);
  if (!user) return;
  res.json({ id: user.id, name: user.name, role: user.role, email: user.email || null, mobile: user.mobile || null, coparent_name: user.coparent_name || null, coparent_phone: user.coparent_phone || null, partner_phone: user.partner_phone || null });
});

// PUT /api/me — update profile (name, mobile, coparent_name)
router.put('/me', (req, res) => {
  const user = requireToken(req, res);
  if (!user) return;
  const { name, mobile, coparent_name, coparent_phone, partner_phone } = req.body;
  if (name && name.trim()) {
    q.updateUserProfile.run(name.trim(), mobile ? mobile.trim() : null, user.id);
  } else if (mobile !== undefined) {
    q.updateUserMobile.run(mobile ? mobile.trim() : null, user.id);
  }
  if (coparent_name !== undefined) {
    q.updateCoparentName.run(coparent_name ? coparent_name.trim() : null, user.id);
  }
  if (coparent_phone !== undefined) {
    db.prepare('UPDATE users SET coparent_phone = ? WHERE id = ?').run(coparent_phone ? coparent_phone.trim() : null, user.id);
  }
  if (partner_phone !== undefined) {
    db.prepare('UPDATE users SET partner_phone = ? WHERE id = ?').run(partner_phone ? partner_phone.trim() : null, user.id);
  }
  res.json({ ok: true });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseTags(row) {
  return { ...row, tags: JSON.parse(row.tags || '[]') };
}

// ── Custody Pattern ───────────────────────────────────────────────────────────

// GET /api/pattern — return current custody pattern for the logged-in user
router.get('/pattern', (req, res) => {
  const user = requireToken(req, res);
  if (!user) return;
  const pattern = q.getPattern.get(user.id);
  res.json({ pattern: pattern || null });
});

// PUT /api/pattern — save pattern and regenerate calendar days
router.put('/pattern', (req, res) => {
  const user = requireToken(req, res);
  if (!user) return;

  const { pattern_type, pattern_data, anchor_date } = req.body;
  const VALID_TYPES = ['alternating_weeks', 'specific_days', 'custom'];
  if (!VALID_TYPES.includes(pattern_type)) {
    return res.status(400).json({ error: 'Invalid pattern_type' });
  }

  const normData = normalizePatternData(pattern_type, pattern_data);
  const dataStr = JSON.stringify(normData || {});
  q.upsertPattern.run(user.id, pattern_type, dataStr, anchor_date || null);

  // Regenerate calendar days only for auto-generate types
  if (pattern_type !== 'custom') {
    const start = new Date(); start.setFullYear(start.getFullYear() - 1); // 1 year back
    const end   = new Date(); end.setFullYear(end.getFullYear() + 2);     // 2 years ahead
    const pattern = { pattern_type, pattern_data: dataStr, anchor_date: anchor_date || null };
    upsertManyDays(user.id, generateDaysFromPattern(pattern, toDateStr(start), toDateStr(end)));
  }

  res.json({ ok: true });
});

// ── Activities ────────────────────────────────────────────────────────────

// POST /api/activities — create an activity suggestion
router.post('/activities', (req, res) => {
  const me = requireToken(req, res);
  if (!me) return;

  const { title, link, dates, to_user_id } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: 'title required' });
  if (!Array.isArray(dates) || dates.length === 0) return res.status(400).json({ error: 'dates required' });
  if (!to_user_id) return res.status(400).json({ error: 'to_user_id required' });

  // Verify they share an approved partner connection
  const conn = db.prepare(`
    SELECT * FROM connections
    WHERE status = 'approved' AND relationship_type = 'partner'
    AND ((requester_id = ? AND target_id = ?) OR (requester_id = ? AND target_id = ?))
  `).get(me.id, to_user_id, to_user_id, me.id);
  if (!conn) return res.status(403).json({ error: 'No approved partner connection' });

  const id = uuidv4();
  q.createActivity.run(id, me.id, to_user_id, title.trim(), link?.trim() || null, JSON.stringify(dates));
  res.json({ id, status: 'pending' });
});

// GET /api/activities — get all activities for current user
router.get('/activities', (req, res) => {
  const me = requireToken(req, res);
  if (!me) return;
  const activities = q.getActivitiesForUser.all(me.id, me.id);
  res.json({ activities: activities.map(a => ({ ...a, dates: JSON.parse(a.dates) })) });
});

// GET /api/activities/partner-mobile — get partner's mobile for activity WhatsApp
// (declared before /:id routes to avoid being captured by the param pattern)
router.get('/activities/partner-mobile', (req, res) => {
  const me = requireToken(req, res);
  if (!me) return;
  const conn = db.prepare(`
    SELECT * FROM connections
    WHERE status = 'approved' AND relationship_type = 'partner'
    AND (requester_id = ? OR target_id = ?)
    LIMIT 1
  `).get(me.id, me.id);
  // Own partner_phone always takes priority (most reliable — user entered it themselves)
  if (me.partner_phone) return res.json({ mobile: me.partner_phone });
  if (!conn) return res.json({ mobile: null });
  const otherId = conn.requester_id === me.id ? conn.target_id : conn.requester_id;
  const other = db.prepare('SELECT mobile FROM users WHERE id = ?').get(otherId);
  res.json({ mobile: other?.mobile || null });
});

// POST /api/activities/:id/accept
router.post('/activities/:id/accept', async (req, res) => {
  const me = requireToken(req, res);
  if (!me) return;
  const a = q.getActivityById.get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Not found' });
  if (a.to_user_id !== me.id) return res.status(403).json({ error: 'Not your activity to accept' });
  if (a.status !== 'pending') return res.status(409).json({ error: 'Already handled' });
  q.updateActivityStatus.run('accepted', a.id);

  // Send .ics calendar invite to both parties (fire and forget)
  try {
    const fromUser = q.getUserById.get(a.from_user_id);
    const toUser   = me;
    const dates    = JSON.parse(a.dates);
    const activity = { ...a, dates };
    const icsContent = buildInvite({ activity, fromUser, toUser });
    const dateLabel  = dates.length === 1 ? dates[0] : `${dates[0]} + ${dates.length - 1} more day${dates.length > 2 ? 's' : ''}`;
    const subject    = `📅 ${a.title} — ${dateLabel}`;

    if (fromUser?.email) {
      sendCalendarInvite({
        to: fromUser.email,
        subject,
        bodyText: `${toUser.name} accepted your invitation to "${a.title}". The event has been added to your calendar.`,
        icsContent,
      });
    }
    if (toUser?.email) {
      sendCalendarInvite({
        to: toUser.email,
        subject,
        bodyText: `You accepted "${a.title}" with ${fromUser?.name || 'your partner'}. The event has been added to your calendar.`,
        icsContent,
      });
    }
  } catch (err) {
    console.error('[activities/accept] email error:', err.message);
  }

  res.json({ status: 'accepted' });
});

// POST /api/activities/:id/decline
router.post('/activities/:id/decline', (req, res) => {
  const me = requireToken(req, res);
  if (!me) return;
  const a = q.getActivityById.get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Not found' });
  if (a.to_user_id !== me.id) return res.status(403).json({ error: 'Not your activity' });
  if (a.status !== 'pending') return res.status(409).json({ error: 'Already handled' });
  q.updateActivityStatus.run('declined', a.id);
  res.json({ status: 'declined' });
});

// POST /api/activities/:id/redate — suggest different dates (declines current, creates new from other direction)
router.post('/activities/:id/redate', (req, res) => {
  const me = requireToken(req, res);
  if (!me) return;
  const a = q.getActivityById.get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Not found' });
  if (a.to_user_id !== me.id) return res.status(403).json({ error: 'Not your activity' });

  const { dates } = req.body;
  if (!Array.isArray(dates) || dates.length === 0) return res.status(400).json({ error: 'dates required' });

  // Decline original
  q.updateActivityStatus.run('declined', a.id);

  // Create new suggestion in reverse direction
  const newId = uuidv4();
  q.createActivity.run(newId, me.id, a.from_user_id, a.title, a.link, JSON.stringify(dates));
  res.json({ id: newId, status: 'pending' });
});

// DELETE /api/activities/:id — delete for both parties
router.delete('/activities/:id', async (req, res) => {
  const me = requireToken(req, res);
  if (!me) return;
  const a = q.getActivityById.get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Not found' });
  if (a.from_user_id !== me.id && a.to_user_id !== me.id) return res.status(403).json({ error: 'Not authorized' });

  // If accepted, send cancellation emails before deleting
  if (a.status === 'accepted') {
    try {
      const fromUser = q.getUserById.get(a.from_user_id);
      const toUser   = q.getUserById.get(a.to_user_id);
      const dates    = JSON.parse(a.dates);
      const icsContent = buildCancellation({ activity: { ...a, dates }, fromUser, toUser });
      const subject    = `Cancelled: ${a.title}`;
      const body       = `"${a.title}" has been cancelled and removed from your calendar.`;
      if (fromUser?.email) sendCalendarInvite({ to: fromUser.email, subject, bodyText: body, icsContent, method: 'CANCEL' });
      if (toUser?.email)   sendCalendarInvite({ to: toUser.email,   subject, bodyText: body, icsContent, method: 'CANCEL' });
    } catch (err) {
      console.error('[activities/delete] cancellation email error:', err.message);
    }
  }

  q.deleteActivity.run(a.id);
  res.json({ ok: true });
});

// GET /api/calendar.ics?token= — iCal subscribe feed (custody days)
// Paste this URL into Apple Calendar / Outlook / Google Calendar once to get a live feed
router.get('/calendar.ics', (req, res) => {
  const user = requireToken(req, res);
  if (!user) return;

  const days = q.getDaysForUser.all(user.id);
  const icsContent = buildSubscribeFeed({ user, days: days.map(parseTags) });

  const safeName = user.name.toLowerCase().replace(/[^a-z0-9]/g, '-');
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="spontany-${safeName}.ics"`);
  res.setHeader('Cache-Control', 'no-cache');
  res.send(icsContent);
});

// POST /api/calendar/notify-change — save changed days and notify co-parent by email
router.post('/calendar/notify-change', async (req, res) => {
  const me = requireToken(req, res);
  if (!me) return;

  const { connection_id, changes } = req.body;
  if (!Array.isArray(changes) || changes.length === 0) {
    return res.status(400).json({ error: 'changes required' });
  }

  const conn = q.getConnectionById.get(connection_id);
  if (!conn || (conn.requester_id !== me.id && conn.target_id !== me.id)) {
    return res.status(403).json({ error: 'Not authorized' });
  }

  const otherId = conn.requester_id === me.id ? conn.target_id : conn.requester_id;
  const other = q.getUserById.get(otherId);

  if (other?.email) {
    const changeLines = changes.map(c => {
      const label = c.new_owner === 'self' ? me.name : (other.name || 'Co-parent');
      return `  ${c.date}: now with ${label}`;
    }).join('\n');

    sendEmail({
      to: other.email,
      subject: `📅 ${me.name} updated the custody schedule`,
      bodyText: `Hi ${other.name || 'there'},\n\n${me.name} made the following changes to the custody schedule:\n\n${changeLines}\n\nLog in to Spontany to see the updated calendar.\n\nThe Spontany team`,
    });
  }

  res.json({ ok: true, notified: !!other?.email });
});

module.exports = router;
