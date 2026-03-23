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
      (SELECT status FROM connections
       WHERE (requester_id = u.id OR target_id = u.id)
       ORDER BY created_at DESC LIMIT 1) AS conn_status,
      COALESCE(
        (SELECT c.relationship_type FROM connections c
         WHERE c.requester_id = u.id ORDER BY c.created_at DESC LIMIT 1),
        (SELECT i.relationship_type FROM invites i
         WHERE i.used_by = u.id ORDER BY i.created_at DESC LIMIT 1)
      ) AS relationship_type
    FROM users u
    ORDER BY u.created_at DESC
  `).all();

  res.json({ users });
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
