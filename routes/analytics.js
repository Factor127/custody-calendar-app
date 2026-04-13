const express = require('express');
const router  = express.Router();
const { db, q } = require('../db');

// POST /api/sa — lightweight event ingestion (no auth required for match flow)
router.post('/sa', (req, res) => {
  const { event, props, page, session_id, token } = req.body;
  if (!event || typeof event !== 'string') return res.status(400).end();

  let userId = null;
  if (token) {
    const user = q.getUserByToken.get(token);
    if (user) userId = user.id;
  }

  try {
    q.insertAnalyticsEvent.run(
      userId,
      session_id || null,
      event.slice(0, 64),
      JSON.stringify(props || {}).slice(0, 2048),
      (page || '').slice(0, 128) || null
    );
  } catch(e) { /* never block the client */ }

  res.status(204).end();
});

// GET /api/admin/analytics — campaign funnel dashboard data
router.get('/admin/analytics', (req, res) => {
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken || req.query.token !== adminToken) return res.status(403).end();

  // 1. Match funnel by utm_content (which hook works)
  const funnel = db.prepare(`
    SELECT
      COALESCE(e_start.utm_content, '(direct)') AS hook,
      COUNT(DISTINCT e_start.session_id) AS sessions,
      COUNT(DISTINCT e_sched.session_id) AS started_schedule,
      COUNT(DISTINCT e_fork.session_id) AS reached_fork,
      COUNT(DISTINCT e_created.session_id) AS created_match,
      COUNT(DISTINCT e_result.session_id) AS saw_result,
      COUNT(DISTINCT e_invite.session_id) AS sent_invite
    FROM (
      SELECT DISTINCT session_id,
        json_extract(props, '$.utm_content') AS utm_content
      FROM analytics_events WHERE event = 'match_splash'
    ) e_start
    LEFT JOIN (SELECT DISTINCT session_id FROM analytics_events WHERE event = 'match_your_schedule') e_sched ON e_sched.session_id = e_start.session_id
    LEFT JOIN (SELECT DISTINCT session_id FROM analytics_events WHERE event = 'match_fork') e_fork ON e_fork.session_id = e_start.session_id
    LEFT JOIN (SELECT DISTINCT session_id FROM analytics_events WHERE event = 'match_created') e_created ON e_created.session_id = e_start.session_id
    LEFT JOIN (SELECT DISTINCT session_id FROM analytics_events WHERE event = 'match_result') e_result ON e_result.session_id = e_start.session_id
    LEFT JOIN (SELECT DISTINCT session_id FROM analytics_events WHERE event = 'match_invite_sent') e_invite ON e_invite.session_id = e_start.session_id
    GROUP BY hook
    ORDER BY sessions DESC
  `).all();

  // 2. Overall funnel totals
  const totals = db.prepare(`
    SELECT event, COUNT(*) AS total, COUNT(DISTINCT session_id) AS sessions
    FROM analytics_events
    WHERE event LIKE 'match_%'
    GROUP BY event
    ORDER BY total DESC
  `).all();

  // 3. Person B conversion (viral loop)
  const personB = db.prepare(`
    SELECT
      COUNT(DISTINCT CASE WHEN event = 'match_splash' THEN session_id END) AS b_started,
      COUNT(DISTINCT CASE WHEN event = 'match_your_schedule' THEN session_id END) AS b_scheduled,
      COUNT(DISTINCT CASE WHEN event = 'match_result' THEN session_id END) AS b_completed
    FROM analytics_events
    WHERE json_extract(props, '$.role') = 'person_b'
  `).get();

  // 4. Device breakdown
  const devices = db.prepare(`
    SELECT
      json_extract(props, '$.device') AS device,
      COUNT(DISTINCT session_id) AS sessions
    FROM analytics_events
    WHERE event = 'match_splash' AND json_extract(props, '$.device') IS NOT NULL
    GROUP BY device
  `).all();

  // 5. Daily sessions
  const daily = db.prepare(`
    SELECT date(created_at) AS day, COUNT(DISTINCT session_id) AS sessions
    FROM analytics_events
    WHERE event = 'match_splash'
    GROUP BY day ORDER BY day
  `).all();

  // 6. UTM source breakdown
  const sources = db.prepare(`
    SELECT
      json_extract(props, '$.utm_source') AS source,
      COUNT(DISTINCT session_id) AS sessions
    FROM analytics_events
    WHERE event = 'match_splash' AND json_extract(props, '$.utm_source') IS NOT NULL
    GROUP BY source ORDER BY sessions DESC
  `).all();

  // 7. Step timing (median time between steps)
  const timing = db.prepare(`
    SELECT event,
      AVG(json_extract(props, '$.elapsed_ms')) AS avg_ms,
      MIN(json_extract(props, '$.elapsed_ms')) AS min_ms,
      MAX(json_extract(props, '$.elapsed_ms')) AS max_ms,
      COUNT(*) AS n
    FROM analytics_events
    WHERE json_extract(props, '$.elapsed_ms') IS NOT NULL
      AND event LIKE 'match_%'
    GROUP BY event
  `).all();

  res.json({ funnel, totals, personB, devices, daily, sources, timing });
});

// DELETE /api/admin/analytics — reset all analytics data
router.delete('/admin/analytics', (req, res) => {
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken || req.query.token !== adminToken) return res.status(403).end();

  db.prepare('DELETE FROM analytics_events').run();
  res.json({ cleared: true });
});

module.exports = router;
