const express = require('express');
const router = express.Router();
const { db } = require('../db');

function requireAdmin(req, res) {
  const token = req.query.token || req.headers['x-admin-token'];
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken) {
    res.status(503).json({ error: 'Admin not configured — set ADMIN_TOKEN env var' });
    return false;
  }
  if (!token || token !== adminToken) {
    res.status(403).json({ error: 'Invalid admin token' });
    return false;
  }
  return true;
}

// GET /api/admin/users — all users with basic stats
router.get('/admin/users', (req, res) => {
  if (!requireAdmin(req, res)) return;

  const users = db.prepare(`
    SELECT
      u.id, u.name, u.email, u.role, u.created_at,
      (SELECT COUNT(*) FROM calendar_days WHERE user_id = u.id) AS day_count,
      c.id              AS conn_id,
      c.status          AS conn_status,
      c.relationship_type AS relationship_type
    FROM users u
    LEFT JOIN connections c ON c.id = (
      SELECT id FROM connections
      WHERE (requester_id = u.id OR target_id = u.id)
      ORDER BY CASE WHEN status = 'approved' THEN 0 ELSE 1 END, created_at DESC
      LIMIT 1
    )
    ORDER BY u.created_at DESC
  `).all();

  res.json({ users });
});

// PUT /api/admin/connections/:id/role — admin changes a connection's relationship label
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

// DELETE /api/admin/users/:id — delete user + all their data (cascade)
router.delete('/admin/users/:id', (req, res) => {
  if (!requireAdmin(req, res)) return;

  const { id } = req.params;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  db.exec('BEGIN');
  try {
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
