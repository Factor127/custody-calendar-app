const express = require('express');
const router = express.Router();
const { db } = require('../db');

function requireAdmin(req, res) {
  const token = req.query.token || req.headers['x-admin-token'];
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken) {
    res.status(503).json({ error: 'Admin not configured - set ADMIN_TOKEN env var' });
    return false;
  }
  if (!token || token !== adminToken) {
    res.status(403).json({ error: 'Invalid admin token' });
    return false;
  }
  return true;
}

// GET /api/admin/users - all users with basic stats
router.get('/admin/users', (req, res) => {
  if (!requireAdmin(req, res)) return;

  const users = db.prepare(`
    SELECT
      u.id, u.name, u.email, u.role, u.created_at,
      (SELECT COUNT(*) FROM calendar_days WHERE user_id = u.id) AS day_count,
      (SELECT c.id FROM connections c
        WHERE c.requester_id = u.id OR c.target_id = u.id
        ORDER BY CASE WHEN c.status='approved' THEN 0 ELSE 1 END, c.created_at DESC
        LIMIT 1) AS conn_id,
      (SELECT c.status FROM connections c
        WHERE c.requester_id = u.id OR c.target_id = u.id
        ORDER BY CASE WHEN c.status='approved' THEN 0 ELSE 1 END, c.created_at DESC
        LIMIT 1) AS conn_status,
      (SELECT c.relationship_type FROM connections c
        WHERE c.requester_id = u.id OR c.target_id = u.id
        ORDER BY CASE WHEN c.status='approved' THEN 0 ELSE 1 END, c.created_at DESC
        LIMIT 1) AS relationship_type,
      -- Contribution stats
      (SELECT COUNT(*) FROM opportunities WHERE created_by = u.id) AS opp_count,
      (SELECT COUNT(*) FROM plans WHERE user_id = u.id) AS plan_count,
      (SELECT COALESCE(SUM(plan_count + outing_count), 0)
         FROM opportunities WHERE created_by = u.id) AS outcome_count
    FROM users u
    ORDER BY u.created_at DESC
  `).all();

  res.json({ users });
});

// PUT /api/admin/connections/:id/role - admin changes a connection's relationship label
router.put('/admin/connections/:id/role', (req, res) => {
  if (!requireAdmin(req, res)) return;

  const { relationship_type } = req.body;
  if (!['coparent', 'partner', 'friend'].includes(relationship_type)) {
    return res.status(400).json({ error: 'relationship_type must be coparent, partner or friend' });
  }

  const conn = db.prepare('SELECT * FROM connections WHERE id = ?').get(req.params.id);
  if (!conn) return res.status(404).json({ error: 'Connection not found' });

  db.prepare('UPDATE connections SET relationship_type = ? WHERE id = ?')
    .run(relationship_type, req.params.id);

  res.json({ relationship_type });
});

// ── Opportunities ─────────────────────────────────────────────────────────

// GET /api/admin/opportunities - all opportunities with submitter name
router.get('/admin/opportunities', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const opps = db.prepare(`
    SELECT o.*, u.name AS submitter_name
    FROM opportunities o
    LEFT JOIN users u ON u.id = o.created_by
    ORDER BY o.created_at DESC
  `).all();
  res.json({ opportunities: opps });
});

// PUT /api/admin/opportunities/:id - update type / category / visibility / title
router.put('/admin/opportunities/:id', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { id } = req.params;
  const opp = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(id);
  if (!opp) return res.status(404).json({ error: 'not found' });
  const { title, type, category, visibility } = req.body;
  db.prepare(`
    UPDATE opportunities
    SET title = ?, type = ?, category = ?, visibility = ?
    WHERE id = ?
  `).run(
    title      ?? opp.title,
    type       ?? opp.type,
    category   ?? opp.category,
    visibility ?? opp.visibility,
    id
  );
  res.json({ ok: true });
});

// DELETE /api/admin/opportunities/:id - hard delete any opportunity
router.delete('/admin/opportunities/:id', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const result = db.prepare('DELETE FROM opportunities WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'not found' });
  // Also remove any plans referencing this opportunity
  db.prepare('DELETE FROM plans WHERE opportunity_id = ?').run(req.params.id);
  res.json({ deleted: true });
});

// ── Submissions ────────────────────────────────────────────────────────────

// GET /api/admin/submissions - all URL submissions with submitter name
router.get('/admin/submissions', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const subs = db.prepare(`
    SELECT s.*, u.name AS submitter_name
    FROM opportunity_submissions s
    LEFT JOIN users u ON u.id = s.submitted_by
    ORDER BY s.created_at DESC
  `).all();
  res.json({ submissions: subs.map(s => ({
    ...s,
    parsed_data: s.parsed_data ? JSON.parse(s.parsed_data) : null
  })) });
});

// DELETE /api/admin/submissions/:id - remove a submission record
router.delete('/admin/submissions/:id', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const result = db.prepare('DELETE FROM opportunity_submissions WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'not found' });
  res.json({ deleted: true });
});

// ── Stats ──────────────────────────────────────────────────────────────────

// GET /api/admin/stats - aggregate counts + engagement totals
router.get('/admin/stats', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const oppCount    = db.prepare('SELECT COUNT(*) AS c FROM opportunities').get().c;
  const subCount    = db.prepare('SELECT COUNT(*) AS c FROM opportunity_submissions').get().c;
  const planCount   = db.prepare('SELECT COUNT(*) AS c FROM plans').get().c;
  const byType      = db.prepare('SELECT type, COUNT(*) AS c FROM opportunities GROUP BY type').all();
  const byCat       = db.prepare('SELECT category, COUNT(*) AS c FROM opportunities GROUP BY category ORDER BY c DESC').all();
  const byStatus    = db.prepare('SELECT status, COUNT(*) AS c FROM opportunity_submissions GROUP BY status').all();
  // Engagement totals from gamification counters
  const engRow      = db.prepare(`
    SELECT COALESCE(SUM(view_count),0)   AS total_views,
           COALESCE(SUM(save_count),0)   AS total_saves,
           COALESCE(SUM(plan_count),0)   AS total_plans_from_opps,
           COALESCE(SUM(outing_count),0) AS total_outings
    FROM opportunities
  `).get();
  const eventCount  = db.prepare('SELECT COUNT(*) AS c FROM opportunity_events').get().c;
  // Top contributors (by outcomes = plans + outings generated from their suggestions)
  const topContributors = db.prepare(`
    SELECT u.name, u.id,
           COUNT(o.id) AS opp_count,
           COALESCE(SUM(o.plan_count + o.outing_count), 0) AS outcome_count
    FROM opportunities o
    JOIN users u ON u.id = o.created_by
    GROUP BY o.created_by
    ORDER BY outcome_count DESC, opp_count DESC
    LIMIT 5
  `).all();
  res.json({ oppCount, subCount, planCount, byType, byCat, byStatus,
             ...engRow, eventCount, topContributors });
});

// ── Users ──────────────────────────────────────────────────────────────────

// DELETE /api/admin/users/:id - delete user + all their data (cascade)
router.delete('/admin/users/:id', (req, res) => {
  if (!requireAdmin(req, res)) return;

  const { id } = req.params;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  db.exec('BEGIN');
  try {
    // Push subscriptions
    db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').run(id);
    // Outing messages & suggestions sent by this user
    db.prepare('DELETE FROM outing_messages WHERE sender_id = ?').run(id);
    db.prepare('DELETE FROM outing_suggestions WHERE suggester_id = ?').run(id);
    // Outing invitee records
    db.prepare('DELETE FROM outing_invitees WHERE user_id = ?').run(id);
    // Outings created by this user (cascade their invitees/messages first)
    const userOutings = db.prepare('SELECT id FROM outings WHERE created_by = ?').all(id);
    for (const o of userOutings) {
      db.prepare('DELETE FROM outing_messages WHERE outing_id = ?').run(o.id);
      db.prepare('DELETE FROM outing_suggestions WHERE outing_id = ?').run(o.id);
      db.prepare('DELETE FROM outing_invitees WHERE outing_id = ?').run(o.id);
    }
    db.prepare('DELETE FROM outings WHERE created_by = ?').run(id);
    // Connection preferences (references connections)
    const userConns = db.prepare('SELECT id FROM connections WHERE requester_id = ? OR target_id = ?').all(id, id);
    for (const c of userConns) {
      db.prepare('DELETE FROM connection_preferences WHERE connection_id = ?').run(c.id);
    }
    // Activities
    try { db.prepare('DELETE FROM activities WHERE user_id = ?').run(id); } catch(e2) { /* table may not exist */ }
    db.prepare('DELETE FROM magic_links WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM suggestions WHERE from_user_id = ? OR to_user_id = ?').run(id, id);
    db.prepare('DELETE FROM connections WHERE requester_id = ? OR target_id = ?').run(id, id);
    db.prepare('DELETE FROM calendar_days WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM custody_pattern WHERE user_id = ?').run(id);
    db.prepare('UPDATE invites SET used_by = NULL WHERE used_by = ?').run(id);
    db.prepare('DELETE FROM invites WHERE created_by = ?').run(id);
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    return res.status(500).json({ error: 'Delete failed', detail: e.message });
  }

  res.json({ deleted: true, name: user.name });
});

module.exports = router;
