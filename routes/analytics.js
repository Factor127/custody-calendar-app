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

  // 2. Overall funnel totals (all events, not just match_*)
  const totals = db.prepare(`
    SELECT event, COUNT(*) AS total, COUNT(DISTINCT session_id) AS sessions
    FROM analytics_events
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

  // 8. Screen-level funnel (from screen_view events)
  const screenFunnel = db.prepare(`
    SELECT
      json_extract(props, '$.screen') as screen,
      COUNT(DISTINCT session_id) as visitors
    FROM analytics_events
    WHERE event = 'screen_view'
    GROUP BY json_extract(props, '$.screen')
    ORDER BY visitors DESC
  `).all();

  // 9. Where users exit
  const exitScreens = db.prepare(`
    SELECT
      json_extract(props, '$.last_screen') as screen,
      COUNT(DISTINCT session_id) as visitors
    FROM analytics_events
    WHERE event = 'page_exit'
    GROUP BY json_extract(props, '$.last_screen')
    ORDER BY visitors DESC
  `).all();

  // 10. A/B variant funnel (legacy events — kept for historical compatibility)
  const variantFunnel = db.prepare(`
    SELECT
      json_extract(props, '$.variant') AS variant,
      COUNT(DISTINCT CASE WHEN event='lp_view' THEN session_id END) AS views,
      COUNT(DISTINCT CASE WHEN event='lp_cta_click' THEN session_id END) AS cta_clicks,
      COUNT(DISTINCT CASE WHEN event='lp_demo_start' THEN session_id END) AS demo_starts,
      COUNT(DISTINCT CASE WHEN event='lp_demo_complete' THEN session_id END) AS demo_completes,
      COUNT(DISTINCT CASE WHEN event='lp_signup' THEN session_id END) AS signups,
      COUNT(DISTINCT CASE WHEN event='lp_invite_sent' THEN session_id END) AS invites
    FROM analytics_events
    WHERE event IN ('lp_view','lp_cta_click','lp_demo_start','lp_demo_complete','lp_signup','lp_invite_sent')
      AND json_extract(props, '$.variant') IS NOT NULL
    GROUP BY variant
  `).all();

  // 11. LP framework funnel — the new canonical metrics.
  // Pulls LP metadata (label, type) from routes/lp.js so the UI can show
  // type pills + fair comparisons.
  let lpFunnel = [];
  try {
    const { LPs } = require('./lp');
    lpFunnel = LPs.map(lp => {
      const row = db.prepare(`
        SELECT
          COUNT(DISTINCT CASE WHEN event='lp_view'           THEN session_id END) AS views,
          COUNT(DISTINCT CASE WHEN event='lp_cta_click'      THEN session_id END) AS cta_clicks,
          COUNT(DISTINCT CASE WHEN event='lp_cta_float_click'THEN session_id END) AS cta_float_clicks,
          COUNT(DISTINCT CASE WHEN event='demo_step'         THEN session_id END) AS demo_any_step,
          COUNT(DISTINCT CASE WHEN event='demo_complete'     THEN session_id END) AS demo_completes,
          COUNT(DISTINCT CASE WHEN event='nudge_open'        THEN session_id END) AS nudge_opens,
          COUNT(DISTINCT CASE WHEN event='nudge_scheduled'   THEN session_id END) AS nudges_scheduled,
          COUNT(DISTINCT CASE WHEN event='signup_view'       THEN session_id END) AS signup_views,
          COUNT(DISTINCT CASE WHEN event='signup_submit'     THEN session_id END) AS signups,
          COUNT(DISTINCT CASE WHEN event='share_sent'        THEN session_id END) AS shares
        FROM analytics_events
        WHERE json_extract(props, '$.variant') = ?
      `).get(lp.id) || {};
      return {
        id: lp.id,
        label: lp.label,
        type: lp.type,
        active: lp.active,
        ...row,
      };
    });
  } catch(e) { /* lp registry may not be available */ }

  // 12. Nudge pipeline status
  const nudgeStatus = db.prepare(`
    SELECT status, COUNT(*) AS cnt FROM nudges GROUP BY status
  `).all();

  res.json({ funnel, totals, personB, devices, daily, sources, timing, screenFunnel, exitScreens, variantFunnel, lpFunnel, nudgeStatus });
});

// DELETE /api/admin/analytics — archive then reset analytics data
router.delete('/admin/analytics', (req, res) => {
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken || req.query.token !== adminToken) return res.status(403).end();

  // Copy everything to permanent archive before clearing
  db.prepare(`
    INSERT INTO analytics_archive (user_id, session_id, event, props, page, created_at)
    SELECT user_id, session_id, event, props, page, created_at FROM analytics_events
  `).run();

  const { changes } = db.prepare('DELETE FROM analytics_events').run();
  res.json({ cleared: true, archived: changes });
});

module.exports = router;
