// ── Push subscription endpoints ───────────────────────────────────────────────
const express  = require('express');
const router   = express.Router();
const { v4: uuidv4 } = require('uuid');
const { q }    = require('../db');
const { VAPID_PUBLIC } = require('../utils/push');

function requireToken(req, res) {
  const token = req.query.token || req.body?.token;
  if (!token) { res.status(401).json({ error: 'token required' }); return null; }
  const user = q.getUserByToken.get(token);
  if (!user)  { res.status(401).json({ error: 'invalid token' });  return null; }
  return user;
}

// GET /api/push/vapid-public — client needs this to subscribe
router.get('/push/vapid-public', (req, res) => {
  if (!VAPID_PUBLIC) return res.status(503).json({ error: 'push not configured' });
  res.json({ key: VAPID_PUBLIC });
});

// POST /api/push/subscribe — save a push subscription
router.post('/push/subscribe', (req, res) => {
  const me = requireToken(req, res);
  if (!me) return;

  const { endpoint, keys } = req.body;
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return res.status(400).json({ error: 'invalid subscription object' });
  }

  q.upsertPushSub.run(uuidv4(), me.id, endpoint, keys.p256dh, keys.auth);
  res.json({ ok: true });
});

// DELETE /api/push/subscribe — remove a push subscription
router.delete('/push/subscribe', (req, res) => {
  const me = requireToken(req, res);
  if (!me) return;

  const { endpoint } = req.body;
  if (!endpoint) return res.status(400).json({ error: 'endpoint required' });

  q.deletePushSub.run(endpoint, me.id);
  res.json({ ok: true });
});

module.exports = router;
