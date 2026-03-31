const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const { db, q, generateDaysFromPattern, checkAndRenewConnection, upsertManyDays, toDateStr, normalizePhone } = require('../db');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const { buildInvite, buildCancellation, buildSubscribeFeed } = require('../utils/ical');
const { sendCalendarInvite, sendEmail } = require('../utils/email');
const { sendPush } = require('../utils/push');

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
  const { magic, name, pattern_type, pattern_data, anchor_date, days, google_id,
          work_schedule, mobile, age, relationship_status, city, city_place_id, photo } = req.body;
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
  if (google_id)           q.updateGoogleId.run(google_id, id);
  if (work_schedule)       db.prepare('UPDATE users SET work_schedule = ? WHERE id = ?').run(JSON.stringify(work_schedule), id);
  if (mobile)              db.prepare('UPDATE users SET mobile = ? WHERE id = ?').run(mobile.trim(), id);
  if (age)                 db.prepare('UPDATE users SET age = ? WHERE id = ?').run(age, id);
  if (relationship_status) db.prepare('UPDATE users SET relationship_status = ? WHERE id = ?').run(relationship_status, id);
  if (city)                db.prepare("UPDATE users SET city = ? WHERE id = ?").run(city.trim(), id);
  if (city_place_id)       db.prepare("UPDATE users SET city_place_id = ? WHERE id = ?").run(city_place_id, id);
  if (photo)               db.prepare('UPDATE users SET photo = ? WHERE id = ?').run(photo, id);

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
  const { invite_token, name, email, pattern_type, pattern_data, anchor_date, days,
          age, relationship_status, city, city_place_id, work_schedule, photo } = req.body;

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
  if (normalMobile)        q.updateUserMobile.run(normalMobile, userId);
  if (age)                 db.prepare('UPDATE users SET age = ? WHERE id = ?').run(age, userId);
  if (relationship_status) db.prepare('UPDATE users SET relationship_status = ? WHERE id = ?').run(relationship_status, userId);
  if (city)                db.prepare("UPDATE users SET city = ? WHERE id = ?").run(city.trim(), userId);
  if (city_place_id)       db.prepare("UPDATE users SET city_place_id = ? WHERE id = ?").run(city_place_id, userId);
  if (work_schedule)       db.prepare('UPDATE users SET work_schedule = ? WHERE id = ?').run(JSON.stringify(work_schedule), userId);
  if (photo)               db.prepare('UPDATE users SET photo = ? WHERE id = ?').run(photo, userId);

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
  res.json({
    valid:             true,
    owner_name:        owner?.name || 'your partner',
    relationship_type: invite.relationship_type || 'friend'
  });
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

  // Notify the owner that a connection request arrived
  sendPush(owner.id, {
    title: '👋 New connection request',
    body:  `${partner.name} wants to connect with you on Spontany.`,
    tag:   'connection-request',
    url:   '/calendar.html',
  });
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
  const connections = q.getAllConnectionsForUser.all(user.id, user.id, user.id, user.id, user.id, user.id);
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

  // Notify the requester (partner) that they were approved
  sendPush(conn.requester_id, {
    title: '✅ You\'re connected!',
    body:  `${user.name} approved your connection request. You can now see each other's availability.`,
    tag:   'connection-approved',
    url:   '/calendar.html',
  });
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

// DELETE /api/connections/:id — permanently remove a rejected/expired connection
router.delete('/connections/:id', (req, res) => {
  const user = requireToken(req, res);
  if (!user) return;

  const conn = q.getConnectionById.get(req.params.id);
  if (!conn || (conn.target_id !== user.id && conn.requester_id !== user.id)) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  // Delete child rows first (foreign key constraints are ON)
  db.prepare('DELETE FROM connection_preferences WHERE connection_id = ?').run(req.params.id);
  q.deleteConnection.run(req.params.id);
  res.json({ deleted: true });
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
  res.json({ id: user.id, name: user.name, role: user.role, email: user.email || null, mobile: user.mobile || null, coparent_name: user.coparent_name || null, coparent_phone: user.coparent_phone || null, partner_phone: user.partner_phone || null, work_schedule: user.work_schedule || null, photo: user.photo || null });
});

// PUT /api/me — update profile (name, mobile, coparent_name, work_schedule)
router.put('/me', (req, res) => {
  const user = requireToken(req, res);
  if (!user) return;
  const { name, mobile, coparent_name, coparent_phone, partner_phone, work_schedule, photo } = req.body;
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
  if (work_schedule !== undefined) {
    db.prepare('UPDATE users SET work_schedule = ? WHERE id = ?')
      .run(work_schedule ? JSON.stringify(work_schedule) : null, user.id);
  }
  if (photo !== undefined) {
    db.prepare('UPDATE users SET photo = ? WHERE id = ?').run(photo || null, user.id);
  }
  res.json({ ok: true });
});

// POST /api/ical/import — fetch an iCal URL server-side and return event dates
router.post('/ical/import', async (req, res) => {
  const me = requireToken(req, res);
  if (!me) return;

  const { url } = req.body;
  if (!url || !url.startsWith('http')) return res.status(400).json({ error: 'Valid URL required' });

  let text;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return res.status(502).json({ error: `Could not fetch calendar (HTTP ${r.status})` });
    text = await r.text();
  } catch (e) {
    return res.status(502).json({ error: 'Could not reach that URL — check it is public and correct' });
  }

  // Minimal iCal parser — extract DTSTART dates from VEVENT blocks
  const today = new Date();
  const cutoff = new Date(today); cutoff.setDate(cutoff.getDate() + 90);
  const todayStr = today.toISOString().slice(0, 10);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const dates = new Set();
  const vevents = text.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || [];
  for (const ev of vevents) {
    // Match DTSTART with or without TZID, date-only or datetime
    const m = ev.match(/DTSTART[^:\n]*:(\d{8})/);
    if (!m) continue;
    const raw = m[1];
    const ds = `${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}`;
    if (ds >= todayStr && ds <= cutoffStr) dates.add(ds);
  }

  const dateArr = [...dates].sort();
  res.json({ dates: dateArr, count: dateArr.length });
});

// ── Weekly free-time digest ────────────────────────────────────────────────────
//
// POST /api/cron/weekly-digest
// Called by Railway cron (or any external scheduler) every Friday morning.
// Set CRON_SECRET env var in Railway; pass it as header X-Cron-Secret.
// Railway cron setup: Dashboard → your service → Settings → Cron Schedule
//   Schedule: 0 8 * * 5  (08:00 UTC every Friday)
//   Command:  curl -X POST https://YOUR_APP.railway.app/api/cron/weekly-digest
//                  -H "X-Cron-Secret: $CRON_SECRET"
//
router.post('/cron/weekly-digest', async (req, res) => {
  const secret = req.headers['x-cron-secret'];
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const BASE_URL = process.env.BASE_URL || `https://${req.headers.host}`;
  const today    = new Date(); today.setHours(0, 0, 0, 0);
  const endDate  = new Date(today); endDate.setDate(today.getDate() + 14);
  const fromStr  = toDateStr(today);
  const toStr    = toDateStr(endDate);

  // Helper: is a date string a work block given a work_schedule JSON string
  function isWorkDay(dateStr, wsStr) {
    if (!wsStr) return false;
    try {
      const ws  = JSON.parse(wsStr);
      const dow = new Date(dateStr + 'T12:00:00').getDay();
      if (ws.type === 'standard_weekdays') return dow >= 1 && dow <= 5;
      if (ws.type === 'custom')  return (ws.days || []).includes(dow);
      if (ws.type === 'ical')    return (ws.dates || []).includes(dateStr);
    } catch { /* ignore */ }
    return false;
  }

  // Collect notifications per user: userId → { name, email, token, overlaps:[{withName, dates[]}] }
  const notify = {};

  const connections = q.getAllApprovedConnections.all();
  for (const c of connections) {
    const reqDays = Object.fromEntries(
      q.getDaysForUserInRange.all(c.requester_id, fromStr, toStr).map(r => [r.date, r.owner])
    );
    const tgtDays = Object.fromEntries(
      q.getDaysForUserInRange.all(c.target_id, fromStr, toStr).map(r => [r.date, r.owner])
    );

    // Find mutually free dates
    const overlapDates = [];
    for (let i = 0; i <= 14; i++) {
      const d = new Date(today); d.setDate(today.getDate() + i);
      const ds = toDateStr(d);
      const reqFree = reqDays[ds] === 'coparent' && !isWorkDay(ds, c.req_ws);
      const tgtFree = tgtDays[ds] === 'coparent' && !isWorkDay(ds, c.tgt_ws);
      if (reqFree && tgtFree) overlapDates.push(ds);
    }
    if (overlapDates.length === 0) continue;

    // Format dates nicely
    const formatted = overlapDates.map(ds => {
      const d = new Date(ds + 'T12:00:00');
      return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
    });

    // Add to requester's notification
    if (c.req_email) {
      if (!notify[c.requester_id]) notify[c.requester_id] = { name: c.req_name, email: c.req_email, token: c.req_token, overlaps: [] };
      notify[c.requester_id].overlaps.push({ withName: c.tgt_name, dates: formatted });
    }
    // Add to target's notification
    if (c.tgt_email) {
      if (!notify[c.target_id]) notify[c.target_id] = { name: c.tgt_name, email: c.tgt_email, token: c.tgt_token, overlaps: [] };
      notify[c.target_id].overlaps.push({ withName: c.req_name, dates: formatted });
    }
  }

  // Send one email per user
  let sent = 0;
  for (const [, user] of Object.entries(notify)) {
    const calUrl = `${BASE_URL}/calendar?token=${user.token}`;

    // Build overlap lines
    const overlapHtml = user.overlaps.map(o =>
      `<div style="margin-bottom:14px;">
        <div style="font-weight:700;font-size:14px;color:#202124;">${o.withName}</div>
        ${o.dates.map(d =>
          `<div style="font-size:13px;color:#e65100;font-weight:600;padding:3px 0;">📅 ${d}</div>`
        ).join('')}
      </div>`
    ).join('');

    const overlapText = user.overlaps.map(o =>
      `${o.withName}: ${o.dates.join(', ')}`
    ).join('\n');

    const html = `<!DOCTYPE html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;padding:28px 20px;color:#202124;background:#fff;">
  <div style="font-size:22px;font-weight:900;color:#bf360c;margin-bottom:2px;letter-spacing:-0.01em;">Spontany</div>
  <div style="font-size:12px;color:#999;margin-bottom:28px;">Your free time, made visible</div>

  <p style="font-size:17px;font-weight:700;margin:0 0 8px;">Hey ${user.name} 👋</p>
  <p style="font-size:14px;color:#555;margin:0 0 20px;line-height:1.5;">
    You have some upcoming free time that overlaps with people you know.<br>
    Don't let the window slip — make a plan while there's still time.
  </p>

  <div style="background:#fff8f0;border:1.5px solid #ffcc80;border-radius:12px;padding:16px 20px;margin-bottom:24px;">
    <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:#999;margin-bottom:10px;">Free together in the next 2 weeks</div>
    ${overlapHtml}
  </div>

  <a href="${calUrl}" style="display:inline-block;background:#e65100;color:white;padding:13px 28px;border-radius:9px;text-decoration:none;font-weight:800;font-size:14px;">
    Plan something →
  </a>

  <p style="font-size:11px;color:#bbb;margin-top:28px;line-height:1.6;">
    You're getting this because you have active Spontany connections.<br>
    Open your calendar to manage or update your schedule.
  </p>
</body></html>`;

    const bodyText = `Hey ${user.name},\n\nYou have upcoming free time overlapping with:\n${overlapText}\n\nPlan something: ${calUrl}`;

    await sendEmail({ to: user.email, subject: `🗓 You have free time coming up — don't miss it`, bodyText, html });
    sent++;
  }

  res.json({ ok: true, connections_checked: connections.length, emails_sent: sent });
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

// ── RSVP (public — rsvp_token is the credential) ──────────────────────────

// GET /api/rsvp/:token — fetch event details for RSVP landing page
router.get('/rsvp/:token', (req, res) => {
  const inv = q.getInviteeByRsvpToken.get(req.params.token);
  if (!inv) return res.status(404).json({ error: 'not found' });
  res.json({
    name:        inv.name,
    inviterName: inv.inviter_name,
    venue:       inv.venue || inv.opp_title || null,
    date:        inv.date,
    time:        inv.event_time || null,
    location:    inv.venue_address || inv.opp_location || null,
    link:        inv.opp_url || null,
    startTime:   inv.opp_start_time || null,
    status:      inv.status
  });
});

// POST /api/rsvp/:token — submit accept/decline
router.post('/rsvp/:token', (req, res) => {
  const { status } = req.body;
  if (!['accepted', 'declined'].includes(status)) {
    return res.status(400).json({ error: 'status must be accepted or declined' });
  }
  const inv = q.getInviteeByRsvpToken.get(req.params.token);
  if (!inv) return res.status(404).json({ error: 'not found' });
  q.updateInviteeStatus.run(status, inv.id);
  // Track RSVP acceptance as a contribution win
  if (status === 'accepted' && inv.opportunity_id) {
    const { trackOppEvent } = require('../db');
    trackOppEvent(inv.opportunity_id, inv.user_id, 'rsvp_accepted');
  }
  res.json({ ok: true, inviterName: inv.inviter_name });
});

// ── Outings ───────────────────────────────────────────────────────────────

// POST /api/outings — create a new outing with invitees
router.post('/outings', (req, res) => {
  const me = requireToken(req, res);
  if (!me) return;

  const { id: pregenId, date, message, invitees,
          venue, venue_address, venue_place_id, opportunity_id, image_url, status } = req.body;
  if (!Array.isArray(invitees) || (invitees.length === 0 && status !== 'saved')) {
    return res.status(400).json({ error: 'invitees required' });
  }

  const outingId = pregenId || uuidv4();
  q.createOuting.run(
    outingId, me.id, date, message || null,
    venue || null, venue_address || null, venue_place_id || null, opportunity_id || null, image_url || null,
    status || 'pending'
  );

  for (const inv of invitees) {
    const invId = uuidv4();
    q.createOutingInvitee.run(invId, outingId, inv.userId || null, inv.name, inv.phone || null, inv.rsvpToken || null);
  }

  // If there's a linked opportunity and a date, create a plan for the creator
  if (opportunity_id && date) {
    try {
      const planId = uuidv4();
      q.createPlan.run(planId, me.id, date, opportunity_id, null);
    } catch(e) { /* plan may already exist for this date+opp — not critical */ }
  }

  // Also create plans for any invitees who are registered app users
  if (opportunity_id && date) {
    for (const inv of invitees) {
      if (inv.userId) {
        try {
          const planId = uuidv4();
          q.createPlan.run(planId, inv.userId, date, opportunity_id, null);
        } catch(e) { /* non-critical */ }
      }
    }
  }

  // ── Contribution tracking ─────────────────────────────────────────────
  if (opportunity_id) {
    const { trackOppEvent, incOppCounter } = require('../db');
    trackOppEvent(opportunity_id, me.id, 'outing_created');
    incOppCounter('incOppOutings', opportunity_id);
  }

  res.json({ id: outingId, status: 'pending' });

  // Notify registered invitees that they've been invited (non-saved outings only)
  if (status !== 'saved' && invitees.length > 0 && date) {
    const dateLabel = new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    for (const inv of invitees) {
      if (inv.userId) {
        sendPush(inv.userId, {
          title: `📅 ${me.name} invited you out`,
          body:  `${message || 'An outing'} · ${dateLabel}`,
          tag:   `outing-invite-${outingId}`,
          url:   `/calendar.html?openEvent=${outingId}`,
        });
      }
    }
  }
});

// GET /api/outings — list my outings with invitees
router.get('/outings', (req, res) => {
  const me = requireToken(req, res);
  if (!me) return;

  const outings = q.getOutingsForUser.all(me.id);
  const result = outings.map(o => ({ ...o, invitees: q.getOutingInvitees.all(o.id) }));
  res.json({ outings: result });
});

// GET /api/outings/incoming — outings where I am an invitee (partner sees plans sent to them)
router.get('/outings/incoming', (req, res) => {
  const me = requireToken(req, res);
  if (!me) return;

  const outings = q.getOutingsAsInvitee.all(me.id);
  const result = outings.map(o => {
    const creator = q.getUserById.get(o.created_by);
    return { ...o, creator_name: creator?.name || 'Someone' };
  });
  res.json({ outings: result });
});

// PUT /api/outings/:id/invitees/:inviteeId — update one invitee's status
// Allowed if: you are the outing creator (can update any invitee)
//          OR you are the invitee updating your own record
router.put('/outings/:id/invitees/:inviteeId', (req, res) => {
  const me = requireToken(req, res);
  if (!me) return;

  const outing = q.getOutingById.get(req.params.id);
  if (!outing) return res.status(404).json({ error: 'Outing not found' });

  // Check if the caller is the outing creator OR the specific invitee
  const invitees    = q.getOutingInvitees.all(outing.id);
  const inviteeRow  = invitees.find(i => i.id === req.params.inviteeId);
  if (!inviteeRow)  return res.status(404).json({ error: 'Invitee not found' });

  const isCreator  = outing.created_by === me.id;
  const isInvitee  = inviteeRow.user_id === me.id;
  if (!isCreator && !isInvitee) return res.status(403).json({ error: 'Not authorized' });

  const { status } = req.body;
  if (!['pending', 'accepted', 'declined'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  q.updateInviteeStatus.run(status, req.params.inviteeId);
  res.json({ ok: true, status });

  // Notify outing creator when an invitee responds (accepted or declined)
  if (isInvitee && (status === 'accepted' || status === 'declined')) {
    const emoji = status === 'accepted' ? '🎉' : '😔';
    const verb  = status === 'accepted' ? 'is in!'  : 'can\'t make it';
    sendPush(outing.created_by, {
      title: `${emoji} ${me.name} ${verb}`,
      body:  outing.message || 'for your outing',
      tag:   `outing-rsvp-${outing.id}`,
      url:   `/calendar.html?openEvent=${outing.id}`,
    });
  }
});

// GET /api/overlap — mutual free days between me and each approved connection
// "Free" = not a work day AND not a day I have the kids
router.get('/overlap', (req, res) => {
  const me = requireToken(req, res);
  if (!me) return;

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const ahead = new Date(today); ahead.setDate(today.getDate() + 30);
  const startStr = toDateStr(today);
  const endStr   = toDateStr(ahead);

  function getFreeDaysForUser(userId) {
    const user = q.getUserById.get(userId);
    if (!user) return [];
    const ws       = user.work_schedule ? JSON.parse(user.work_schedule) : null;
    const workDays = new Set(ws?.type === 'none' ? [] : (ws?.days ?? [1, 2, 3, 4, 5]));
    const calRows  = q.getDaysForUserInRange.all(userId, startStr, endStr);
    const calMap   = Object.fromEntries(calRows.map(r => [r.date, r.owner]));
    const free = [];
    for (let d = new Date(today); d <= ahead; d.setDate(d.getDate() + 1)) {
      const ds  = toDateStr(d);
      const dow = d.getDay();
      // Free = not having kids AND not a work day
      if (calMap[ds] !== 'self' && !workDays.has(dow)) free.push(ds);
    }
    return free;
  }

  const myFreeDays = getFreeDaysForUser(me.id);
  const myFreeSet  = new Set(myFreeDays);

  const conns = q.getAllConnectionsForUser.all(me.id, me.id, me.id, me.id, me.id)
    .filter(c => c.status === 'approved');

  const overlap = conns.map(c => {
    const theirFree   = getFreeDaysForUser(c.other_user_id);
    const sharedDays  = theirFree.filter(d => myFreeSet.has(d));
    return {
      connection_id:     c.id,
      other_user_id:     c.other_user_id,
      other_name:        c.other_name,
      relationship_type: c.relationship_type,
      overlap_days:      sharedDays.slice(0, 10)
    };
  });

  res.json({ overlap, my_free_count: myFreeDays.length });
});

// GET /api/places/cities — public city autocomplete (no auth — used during onboarding)
// Only returns (cities) type results, so exposure is minimal.
router.get('/places/cities', async (req, res) => {
  const input = (req.query.q || '').trim();
  if (input.length < 2) return res.json({ predictions: [] });

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return res.json({ predictions: [] });

  try {
    const url = 'https://maps.googleapis.com/maps/api/place/autocomplete/json'
      + '?input='  + encodeURIComponent(input)
      + '&types=(cities)'
      + '&key='    + apiKey;
    const gData = await fetch(url).then(r => r.json());
    const predictions = (gData.predictions || []).slice(0, 6).map(p => ({
      place_id:    p.place_id,
      name:        p.structured_formatting?.main_text || p.description,
      description: p.description,
    }));
    res.json({ predictions });
  } catch (err) {
    res.json({ predictions: [] });
  }
});

// GET /api/places/autocomplete — proxy to Google Places API (keeps key server-side)
router.get('/places/autocomplete', async (req, res) => {
  const me = requireToken(req, res);
  if (!me) return;

  const input = (req.query.q || '').trim();
  if (input.length < 2) return res.json({ predictions: [] });

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'Places API not configured' });

  try {
    const url = 'https://maps.googleapis.com/maps/api/place/autocomplete/json'
      + '?input='  + encodeURIComponent(input)
      + '&types=establishment|geocode'
      + '&key='    + apiKey;

    const gData = await fetch(url).then(r => r.json());

    const predictions = (gData.predictions || []).slice(0, 5).map(p => ({
      place_id:       p.place_id,
      main_text:      p.structured_formatting?.main_text      || p.description,
      secondary_text: p.structured_formatting?.secondary_text || '',
      description:    p.description
    }));

    res.json({ predictions });
  } catch (err) {
    console.error('[places]', err.message);
    res.status(500).json({ error: 'Places lookup failed' });
  }
});

// Decode HTML entities in OG tag content
function _decodeEntities(s) {
  if (!s) return s;
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g,          (_, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'");
}

// Extract a YYYY-MM-DD from natural-language text like "on Monday, April 13 2026"
// or "Thursday, 3 April 2025" or "April 3, 2025"
function _parseDateFromText(text) {
  if (!text) return null;
  const M = { january:0,february:1,march:2,april:3,may:4,june:5,july:6,august:7,
              september:8,october:9,november:10,december:11,
              jan:0,feb:1,mar:2,apr:3,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
  // "April 13 2026" / "April 13, 2026"
  const r1 = text.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})[\s,]+(\d{4})\b/i);
  // "13 April 2026"
  const r2 = text.match(/\b(\d{1,2})\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})\b/i);
  let day, mon, year;
  if (r1) { mon = M[r1[1].toLowerCase()]; day = +r1[2]; year = +r1[3]; }
  else if (r2) { day = +r2[1]; mon = M[r2[2].toLowerCase()]; year = +r2[3]; }
  else return null;
  if (mon === undefined || !day || day > 31 || year < 2020) return null;
  return `${year}-${String(mon + 1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}

// Return venue UTC offset in hours for cities found in text (daylight-saving adjusted).
// Returns null if venue city not recognised.
function _venueUtcOffset(text) {
  if (!text) return null;
  const t = text.toLowerCase();
  // Eastern: NYC, Boston, Miami, Atlanta, Toronto, Washington DC, Philadelphia, Detroit
  if (/new york|brooklyn|manhattan|bronx|queens|\bnyc\b|boston|miami|atlanta|washington\s*d\.?c|philadelphia|detroit|toronto|montreal|cleveland|pittsburgh|baltimore|charlotte|nashville|orlando|tampa|jacksonville/.test(t)) return -4; // EDT (Apr–Oct)
  // Central: Chicago, Dallas, Houston, Minneapolis, New Orleans, Kansas City, St Louis
  if (/chicago|dallas|houston|minneapolis|new orleans|kansas city|st[. ]+louis|milwaukee|memphis|oklahoma/.test(t)) return -5; // CDT
  // Mountain: Denver, Phoenix, Salt Lake City
  if (/denver|salt lake|phoenix|albuquerque|tucson/.test(t)) return -6; // MDT (Phoenix stays -7 MST all year but close enough)
  // Pacific: LA, SF, Seattle, Portland, Las Vegas
  if (/los angeles|hollywood|san francisco|san jose|san diego|seattle|portland|las vegas|sacramento|anaheim/.test(t)) return -7; // PDT
  return null;
}

// GET /api/unfurl?url=... — extract title/date/description from any pasted link
router.get('/unfurl', async (req, res) => {
  const me = requireToken(req, res); if (!me) return;
  const url = (req.query.url || '').trim();
  // co = client UTC offset in minutes EAST of UTC (Israel = 180, NY = -240)
  // Sent as -new Date().getTimezoneOffset() from the browser
  const clientOffsetMin = parseInt(req.query.co) || 0;
  if (!url.match(/^https?:\/\//i)) return res.status(400).json({ error: 'Invalid URL' });

  // Facebook serves OG tags to its own crawler UA; force English descriptions
  const isFacebook = /facebook\.com/i.test(url);
  const headers = {
    'User-Agent': isFacebook
      ? 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'
      : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  try {
    const resp = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(8000) });
    const html = await resp.text();

    // Pull + decode a meta tag value — handles both attribute orders
    const meta = (prop) => {
      const re1 = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"'<>]{1,600})["']`, 'i');
      const re2 = new RegExp(`<meta[^>]+content=["']([^"'<>]{1,600})["'][^>]+(?:property|name)=["']${prop}["']`, 'i');
      return _decodeEntities((html.match(re1) || html.match(re2))?.[1]?.trim() || null);
    };

    let title = meta('og:title') || meta('twitter:title')
              || _decodeEntities(html.match(/<title[^>]*>([^<]{1,200})<\/title>/i)?.[1]?.trim() || null);
    // Reject generic error/login pages
    const tl = (title || '').toLowerCase();
    if (tl === 'facebook' || tl === 'error' || tl.includes('log in') || tl.includes('sign in')) title = null;

    const description = meta('og:description') || meta('description') || null;
    const image       = meta('og:image') || meta('twitter:image') || null;
    const siteName    = meta('og:site_name') || null;

    // Date: structured tags first → JSON-LD → natural-language in description/title → URL pattern
    let date = meta('article:published_time') || meta('og:updated_time')
             || meta('event:start_time') || meta('datePublished') || null;
    let textParsed = false; // true when date came from natural-language (venue local time, no tz info)
    if (!date) {
      const jld = html.match(/"startDate"\s*:\s*"([^"]{6,30})"/i);
      if (jld) date = jld[1];
    }
    if (!date) { date = _parseDateFromText(description); if (date) textParsed = true; }
    if (!date) { date = _parseDateFromText(title);       if (date) textParsed = true; }
    if (!date) {
      const m = url.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
      if (m) date = `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
    }
    if (date) {
      const d = new Date(date);
      date = isNaN(d) ? null : d.toISOString().slice(0, 10);
    }

    // Timezone correction for text-parsed dates (venue local time → client local date).
    // e.g. "April 13" in NY is "April 14" for someone in Israel (UTC+3) since a
    // typical 8 PM ET show is midnight UTC = 3 AM Israel time = April 14.
    if (textParsed && date && clientOffsetMin !== 0) {
      const venueOffsetHrs = _venueUtcOffset(description || title || '');
      if (venueOffsetHrs !== null) {
        // Compute UTC time of a typical 8 PM venue-local start
        const localHour   = 20; // 8 PM assumed concert start
        const utcHour     = localHour - venueOffsetHrs; // e.g. 20 -(-4) = 24 → next day 0:00
        const extraDays   = Math.floor(utcHour / 24);
        const utcHourMod  = utcHour % 24;
        const utcDate     = new Date(date + 'T00:00:00Z');
        utcDate.setUTCDate(utcDate.getUTCDate() + extraDays);
        utcDate.setUTCHours(utcHourMod, 0, 0, 0);
        // Shift UTC time by client offset to get client's local timestamp, then read date
        const clientMs   = utcDate.getTime() + clientOffsetMin * 60 * 1000;
        date = new Date(clientMs).toISOString().slice(0, 10);
      }
    }

    if (!title && !date) return res.status(422).json({ error: 'Could not extract event details from this page' });
    res.json({ title, description, image, siteName, date, url });
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch URL: ' + err.message });
  }
});

// PUT /api/outings/:id — update outing details (title, venue, time, etc.)
router.put('/outings/:id', (req, res) => {
  const me = requireToken(req, res);
  if (!me) return;

  const outing = q.getOutingById.get(req.params.id);
  if (!outing || outing.created_by !== me.id) return res.status(403).json({ error: 'Not authorized' });

  const { title, venue, event_time, venue_address, status, venue_place_id } = req.body;

  // If title/venue_address are being updated (full edit from event pane), use updateOutingFull
  if (title !== undefined || venue_address !== undefined) {
    q.updateOutingFull.run(
      title !== undefined ? (title || null) : (outing.title || null),
      venue !== undefined ? (venue || null) : (outing.venue || null),
      event_time !== undefined ? (event_time || null) : (outing.event_time || null),
      venue_address !== undefined ? (venue_address || null) : (outing.venue_address || null),
      req.params.id,
      me.id
    );
  } else {
    q.updateOutingDetails.run(
      venue          || null,
      event_time     || null,
      status         || outing.status,
      venue_place_id || null,
      venue_address  || null,
      req.params.id
    );
  }

  // Notify all invitees of the update
  if (title !== undefined || venue !== undefined || event_time !== undefined || venue_address !== undefined) {
    const invitees = q.getOutingInvitees.all(req.params.id);
    for (const inv of invitees) {
      if (inv.user_id && inv.user_id !== me.id) {
        sendPush(inv.user_id, {
          title: 'Plan updated',
          body:  `${me.name} updated the details for ${outing.venue || outing.message || 'your plan'}`,
          tag:   `outing-updated-${outing.id}`,
          url:   `/calendar.html?openEvent=${outing.id}`,
        });
      }
    }
  }

  res.json({ ok: true });
});

// GET /api/outings/:id/detail — full outing detail with invitees + chat
router.get('/outings/:id/detail', (req, res) => {
  const me = requireToken(req, res);
  if (!me) return;

  const outing = q.getOutingWithInvitees.get(req.params.id);
  if (!outing) return res.status(404).json({ error: 'Not found' });

  const invitees = q.getOutingInviteesWithUsers.all(req.params.id);

  // Check access: must be creator or invitee
  const isCreator  = outing.created_by === me.id;
  const myInvitee  = invitees.find(i => i.user_id === me.id);
  if (!isCreator && !myInvitee) return res.status(403).json({ error: 'Not authorized' });

  // Get messages — non-creators only see public messages + their own private ones
  const allMsgs = q.getOutingMessages.all(req.params.id);
  const messages = isCreator
    ? allMsgs
    : allMsgs.filter(m => !m.is_private || m.sender_id === me.id);

  res.json({
    outing,
    invitees: invitees.map(i => ({
      id:           i.id,
      user_id:      i.user_id,
      name:         i.user_name || i.name,
      photo:        i.user_photo || null,
      status:       i.status,
      decline_note: i.decline_note || null,
    })),
    messages: messages.map(m => ({
      id:           m.id,
      sender_id:    m.sender_id,
      sender_name:  m.sender_name,
      sender_photo: m.sender_photo || null,
      message:      m.message,
      is_private:   !!m.is_private,
      message_type: m.message_type,
      suggestion_id:m.suggestion_id || null,
      created_at:   m.created_at,
    })),
    is_creator: isCreator,
  });
});

// POST /api/outings/:id/messages — post a chat message
router.post('/outings/:id/messages', (req, res) => {
  const me = requireToken(req, res);
  if (!me) return;

  const outing = q.getOutingById.get(req.params.id);
  if (!outing) return res.status(404).json({ error: 'Not found' });

  const invitees = q.getOutingInvitees.all(req.params.id);
  const isCreator = outing.created_by === me.id;
  const isInvitee = invitees.some(i => i.user_id === me.id);
  if (!isCreator && !isInvitee) return res.status(403).json({ error: 'Not authorized' });

  const { message, is_private } = req.body;
  if (!message || !message.trim()) return res.status(400).json({ error: 'message required' });

  const msgId = uuidv4();
  const isPriv = is_private ? 1 : 0;
  q.createOutingMessage.run(msgId, req.params.id, me.id, message.trim(), isPriv, 'chat', null);

  // Push notifications for public messages
  if (!isPriv) {
    const allParticipants = [outing.created_by, ...invitees.map(i => i.user_id).filter(Boolean)];
    const unique = [...new Set(allParticipants)].filter(uid => uid !== me.id);
    const eventName = outing.venue || outing.message || 'your plan';
    for (const uid of unique) {
      sendPush(uid, {
        title: `${me.name} in ${eventName}`,
        body:  message.trim().slice(0, 120),
        tag:   `outing-chat-${req.params.id}`,
        url:   `/calendar.html?openEvent=${req.params.id}`,
      });
    }
  }

  res.json({ ok: true, message: { id: msgId, sender_id: me.id, sender_name: me.name, message: message.trim(), is_private: !!isPriv, message_type: 'chat', created_at: new Date().toISOString() } });
});

// POST /api/outings/:id/rsvp — invitee responds (confirmed/maybe/declined/ignored)
router.post('/outings/:id/rsvp', (req, res) => {
  const me = requireToken(req, res);
  if (!me) return;

  const outing = q.getOutingById.get(req.params.id);
  if (!outing) return res.status(404).json({ error: 'Not found' });

  const invitees = q.getOutingInvitees.all(req.params.id);
  const myInvitee = invitees.find(i => i.user_id === me.id);
  if (!myInvitee) return res.status(403).json({ error: 'Not your invite' });

  const { status, note } = req.body;
  if (!['confirmed', 'maybe', 'declined', 'ignored'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  q.updateOutingRsvp.run(status, note || null, myInvitee.id);

  // Notify creator
  const eventName = outing.venue || outing.message || 'your plan';
  const pushMsgs = {
    confirmed: { title: `✅ ${me.name} is coming!`,       body: `Confirmed for ${eventName}` },
    maybe:     { title: `🤔 ${me.name} might come`,       body: `Maybe for ${eventName}` },
    declined:  { title: `❌ ${me.name} can't make it`,    body: note ? `Reason: ${note}` : eventName },
    ignored:   { title: `${me.name} removed their invite`,body: eventName },
  };
  const pm = pushMsgs[status];
  sendPush(outing.created_by, { ...pm, tag: `outing-rsvp-${outing.id}`, url: `/calendar.html?openEvent=${outing.id}` });

  res.json({ ok: true });
});

// POST /api/outings/:id/suggest — invitee suggests a different time/place
router.post('/outings/:id/suggest', (req, res) => {
  const me = requireToken(req, res);
  if (!me) return;

  const outing = q.getOutingById.get(req.params.id);
  if (!outing) return res.status(404).json({ error: 'Not found' });
  if (outing.created_by === me.id) return res.status(400).json({ error: 'Creator cannot suggest to their own outing' });

  const invitees = q.getOutingInvitees.all(req.params.id);
  const myInvitee = invitees.find(i => i.user_id === me.id);
  if (!myInvitee) return res.status(403).json({ error: 'Not your invite' });

  const { suggested_time, suggested_place } = req.body;
  if (!suggested_time && !suggested_place) return res.status(400).json({ error: 'suggested_time or suggested_place required' });

  const suggId = uuidv4();
  q.createOutingSuggestion.run(suggId, req.params.id, me.id, suggested_time || null, suggested_place || null);

  // System message in chat
  const parts = [suggested_time, suggested_place].filter(Boolean);
  const suggText = `${me.name} suggested: ${parts.join(' · ')}`;
  const msgId = uuidv4();
  q.createOutingMessage.run(msgId, req.params.id, me.id, suggText, 0, 'suggestion', suggId);

  // Notify creator
  const eventName = outing.venue || outing.message || 'your plan';
  sendPush(outing.created_by, {
    title: `${me.name} has a suggestion`,
    body:  `For ${eventName}: ${parts.join(' · ')}`,
    tag:   `outing-suggest-${outing.id}`,
    url:   `/calendar.html?openEvent=${outing.id}`,
  });

  res.json({ ok: true, suggestion_id: suggId });
});

// POST /api/outings/:id/suggestions/:suggId/accept — creator accepts a suggestion
router.post('/outings/:id/suggestions/:suggId/accept', (req, res) => {
  const me = requireToken(req, res);
  if (!me) return;

  const outing = q.getOutingById.get(req.params.id);
  if (!outing) return res.status(404).json({ error: 'Not found' });
  if (outing.created_by !== me.id) return res.status(403).json({ error: 'Only creator can accept suggestions' });

  const sugg = q.getOutingSuggestion.get(req.params.suggId);
  if (!sugg || sugg.outing_id !== req.params.id) return res.status(404).json({ error: 'Suggestion not found' });

  q.acceptOutingSuggestion.run(req.params.suggId);

  // Apply the suggestion to the outing
  const newTime  = sugg.suggested_time  || outing.event_time;
  const newVenue = sugg.suggested_place || outing.venue;
  q.updateOutingDetails.run(newVenue, newTime, outing.status, outing.venue_place_id, outing.venue_address, req.params.id);

  // System message
  const suggester = q.getUserById.get(sugg.suggester_id);
  const sysMsg = `${me.name} accepted ${suggester?.name || 'their'}'s suggestion`;
  const msgId = uuidv4();
  q.createOutingMessage.run(msgId, req.params.id, me.id, sysMsg, 0, 'system', null);

  // Notify all invitees
  const invitees = q.getOutingInvitees.all(req.params.id);
  const eventName = newVenue || outing.message || 'your plan';
  for (const inv of invitees) {
    if (inv.user_id && inv.user_id !== me.id) {
      sendPush(inv.user_id, {
        title: 'Plan updated',
        body:  `${me.name} updated ${eventName}`,
        tag:   `outing-updated-${outing.id}`,
        url:   `/calendar.html?openEvent=${outing.id}`,
      });
    }
  }

  res.json({ ok: true });
});

// DELETE /api/outings/:id — cancel/delete an outing (creator only)
router.delete('/outings/:id', (req, res) => {
  const me = requireToken(req, res);
  if (!me) return;

  const outing = q.getOutingById.get(req.params.id);
  if (!outing) return res.status(404).json({ error: 'Not found' });
  if (outing.created_by !== me.id) return res.status(403).json({ error: 'Not authorized' });

  // Notify invitees before deleting
  const invitees = q.getOutingInvitees.all(req.params.id);
  const eventName = outing.venue || outing.message || 'your plan';
  for (const inv of invitees) {
    if (inv.user_id && inv.user_id !== me.id) {
      sendPush(inv.user_id, {
        title: `❌ ${me.name} cancelled`,
        body:  `"${eventName}" has been cancelled.`,
        tag:   `outing-cancelled-${outing.id}`,
        url:   '/calendar.html',
      });
    }
  }

  q.deleteOutingInvitees.run(req.params.id);
  q.deleteOuting.run(req.params.id);
  res.json({ ok: true });
});

// ── Connection preferences ─────────────────────────────────────────────────

// GET /api/connections/:id/preferences
router.get('/connections/:id/preferences', (req, res) => {
  const me = requireToken(req, res);
  if (!me) return;
  const prefs = q.getConnectionPrefs.get(me.id, req.params.id);
  res.json({
    activity_types: prefs ? JSON.parse(prefs.activity_types || '[]') : [],
    confidence:  prefs?.confidence  || 0,
    skipped_at:  prefs?.skipped_at  || null,
    last_updated:prefs?.last_updated|| null
  });
});

// GET /api/preferences — all prefs for the authed user (bulk, for client-side use)
router.get('/preferences', (req, res) => {
  const me = requireToken(req, res);
  if (!me) return;
  const rows = q.getAllPrefsForUser.all(me.id);
  const map = {};
  for (const r of rows) {
    map[r.connection_id] = {
      activity_types: JSON.parse(r.activity_types || '[]'),
      confidence:  r.confidence,
      skipped_at:  r.skipped_at,
      last_updated:r.last_updated
    };
  }
  res.json({ preferences: map });
});

// POST /api/connections/:id/preferences
router.post('/connections/:id/preferences', (req, res) => {
  const me = requireToken(req, res);
  if (!me) return;
  const { activity_types, skip } = req.body;
  const newId = require('crypto').randomUUID();

  if (skip) {
    q.skipConnectionPrefs.run(newId, me.id, req.params.id);
  } else {
    const types = Array.isArray(activity_types) ? activity_types : [];
    q.upsertConnectionPrefs.run(newId, me.id, req.params.id, JSON.stringify(types));
  }
  res.json({ ok: true });
});

// ── GET /api/contacts/google/matches — fetch Google contacts + match to users ──
router.get('/contacts/google/matches', async (req, res) => {
  const me = requireToken(req, res);
  if (!me) return;

  if (!me.google_access_token) {
    return res.status(403).json({ error: 'no_google_token', message: 'Google contacts not connected' });
  }

  // Refresh token if expired
  let accessToken = me.google_access_token;
  if (me.google_token_expiry && new Date(me.google_token_expiry) < new Date()) {
    if (!me.google_refresh_token) {
      return res.status(403).json({ error: 'token_expired', message: 'Please reconnect Google contacts' });
    }
    try {
      const r = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id:     process.env.GOOGLE_CLIENT_ID,
          client_secret: process.env.GOOGLE_CLIENT_SECRET,
          refresh_token: me.google_refresh_token,
          grant_type:    'refresh_token',
        }),
      });
      const tok = await r.json();
      if (!tok.access_token) throw new Error('refresh failed');
      accessToken = tok.access_token;
      const expiry = new Date(Date.now() + (tok.expires_in || 3600) * 1000).toISOString();
      q.updateGoogleTokens.run(accessToken, me.google_refresh_token, expiry, me.id);
    } catch(e) {
      return res.status(403).json({ error: 'token_expired', message: 'Please reconnect Google contacts' });
    }
  }

  // Fetch contacts from Google People API (paginate up to 2000)
  const allPhones = [];
  let pageToken = null;
  do {
    const url = new URL('https://people.googleapis.com/v1/people/me/connections');
    url.searchParams.set('personFields', 'names,phoneNumbers');
    url.searchParams.set('pageSize', '1000');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const r = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!r.ok) return res.status(502).json({ error: 'google_api_error' });
    const data = await r.json();

    for (const person of (data.connections || [])) {
      const name = person.names?.[0]?.displayName || 'Unknown';
      for (const ph of (person.phoneNumbers || [])) {
        allPhones.push({ name, phone: ph.value });
      }
    }
    pageToken = data.nextPageToken || null;
  } while (pageToken);

  // Match each phone against registered users
  const seen = new Set();
  const matches = [];
  for (const { name: contactName, phone } of allPhones) {
    const normalized = normalizePhone(phone);
    if (!normalized) continue;
    const user = q.getUserByPhone.get(normalized);
    if (!user || user.id === me.id || seen.has(user.id)) continue;
    seen.add(user.id);
    const existing = q.getConnectionBetween.get(me.id, user.id, user.id, me.id);
    matches.push({
      contactName,
      user: { id: user.id, name: user.name, photo: user.photo || null },
      connection: existing
        ? { id: existing.id, status: existing.status }
        : null,
    });
  }

  res.json({ matches, total_contacts: allPhones.length });
});

// ── GET /api/users/find-by-phone — look up a registered user by phone number ──
// Returns a safe public profile only. Never returns token, email, or sensitive fields.
router.get('/users/find-by-phone', (req, res) => {
  const me = requireToken(req, res);
  if (!me) return;

  const raw = req.query.phone || '';
  const normalized = normalizePhone(raw);
  if (!normalized || normalized.replace(/\D/g, '').length < 7) {
    return res.status(400).json({ error: 'Please enter a valid phone number' });
  }

  const user = q.getUserByPhone.get(normalized);
  if (!user || user.id === me.id) return res.json({ found: false });

  // Check if already connected
  const existing = q.getConnectionBetween.get(me.id, user.id, user.id, me.id);
  res.json({
    found: true,
    user:  { id: user.id, name: user.name, photo: user.photo || null },
    connection: existing
      ? { id: existing.id, status: existing.status, relationship_type: existing.relationship_type }
      : null,
  });
});

// ── POST /api/connections/request-friend — send a friend connection request ──
// Unlike /connections/request (partner-only), any user can send a friend request.
router.post('/connections/request-friend', (req, res) => {
  const me = requireToken(req, res);
  if (!me) return;

  const { target_user_id } = req.body;
  if (!target_user_id) return res.status(400).json({ error: 'target_user_id required' });

  const target = q.getUserById.get(target_user_id);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.id === me.id) return res.status(400).json({ error: 'Cannot connect to yourself' });

  // Check for existing connection
  const existing = q.getConnectionBetween.get(me.id, target.id, target.id, me.id);
  if (existing && (existing.status === 'pending' || existing.status === 'approved')) {
    return res.json({ connection_id: existing.id, status: existing.status, already_exists: true });
  }

  const connId = uuidv4();
  q.createFriendConnection.run(connId, me.id, target.id);

  res.json({ connection_id: connId, status: 'pending' });

  // Notify the target
  sendPush(target.id, {
    title: `👋 ${me.name} wants to connect`,
    body:  'They found you on Spontany. Tap to see their request.',
    tag:   `friend-request-${connId}`,
    url:   '/connections',
  });
});

module.exports = router;
