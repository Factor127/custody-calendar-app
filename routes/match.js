const express = require('express');
const router  = express.Router();
const { db }  = require('../db');
const crypto  = require('crypto');

// POST /api/match/create  — Person A submits their schedule
router.post('/match/create', (req, res) => {
  const { name, email, schedule } = req.body;
  if (!schedule) return res.status(400).json({ error: 'Schedule is required' });

  const token = crypto.randomUUID();
  const scheduleStr = typeof schedule === 'string' ? schedule : JSON.stringify(schedule);

  db.prepare(`
    INSERT INTO match_requests (token, person_a_name, person_a_email, person_a_schedule)
    VALUES (?, ?, ?, ?)
  `).run(token, name || null, email || null, scheduleStr);

  res.json({ token, match_url: `/match/${token}` });
});

// GET /api/match/:token  — status + person A name (safe to expose)
router.get('/match/:token', (req, res) => {
  const row = db.prepare('SELECT * FROM match_requests WHERE token = ?').get(req.params.token);
  if (!row) return res.status(404).json({ error: 'Match not found' });

  const resp = {
    status:         row.status,
    person_a_name:  row.person_a_name,
  };

  // Only expose schedules once both parties have submitted
  if (row.status === 'completed') {
    resp.person_a_schedule = row.person_a_schedule;
    resp.person_b_name     = row.person_b_name;
    // don't expose emails ever
  }

  res.json(resp);
});

// POST /api/match/:token/complete  — Person B submits their schedule
router.post('/match/:token/complete', (req, res) => {
  const { name, email, schedule } = req.body;
  const { token } = req.params;

  const row = db.prepare('SELECT * FROM match_requests WHERE token = ?').get(token);
  if (!row)                    return res.status(404).json({ error: 'Match not found' });
  if (row.status === 'completed') return res.status(409).json({ error: 'Already completed' });

  const scheduleStr = typeof schedule === 'string' ? schedule : JSON.stringify(schedule);

  db.prepare(`
    UPDATE match_requests
    SET person_b_name     = ?,
        person_b_email    = ?,
        person_b_schedule = ?,
        status            = 'completed',
        completed_at      = datetime('now')
    WHERE token = ?
  `).run(name || null, email || null, scheduleStr, token);

  res.json({ status: 'completed' });
});

module.exports = router;
