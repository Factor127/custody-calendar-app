'use strict';

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const router  = express.Router();
const { db }  = require('../db');
const { sendEmail } = require('../utils/email');

// LP registry — single source of truth for the A/B test.
// Keep in sync with AB_VARIANTS in server.js (which reads from here).
const LPs = [
  { id: 'timeback-v1',     type: 'hero',          label: 'You got your time back',     active: true,  file: 'public/lp/timeback-v1/index.html' },
  { id: 'friends-demo-v1', type: 'demo',          label: 'Align friends\' schedules',  active: true,  file: 'public/lp/friends-demo-v1/index.html' },
  { id: 'why-v1',          type: 'explainer',     label: 'Why Spontany exists',        active: true,  file: 'public/lp/why-v1/index.html' },
  { id: 'serious-v1',      type: 'teaser-share',  label: 'Let him show he\'s serious', active: true,  file: 'public/lp/serious-v1/index.html' },
];

function getActiveLPs() { return LPs.filter(lp => lp.active); }
function findLP(id)     { return LPs.find(lp => lp.id === id); }

// ── GET /lp/_signup — shared signup landing after CTA ─────────────────────
// Must come BEFORE /lp/:id so the param route doesn't swallow it.
router.get('/lp/_signup', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'lp', '_shared', 'signup.html'));
});

// ── Preview a specific LP, bypassing A/B assignment ────────────────────────
// Used for internal review. No cookie set, no variant injection beyond the
// forced one. Each preview renders the same HTML as real traffic would see.
router.get('/lp/:id', (req, res, next) => {
  const lp = findLP(req.params.id);
  if (!lp) return next(); // fall through to 404

  const filePath = path.join(__dirname, '..', lp.file);
  let html;
  try { html = fs.readFileSync(filePath, 'utf8'); }
  catch(e) {
    console.error('[lp preview] failed to read', lp.file, e.message);
    return res.status(500).send('LP file missing');
  }

  const inject = `<script>
window.__LP_ID='${lp.id}';
window.__LP_TYPE='${lp.type}';
window.__LP_PREVIEW=true;
sessionStorage.setItem('sa_variant','${lp.id}');
</script>
<script src="/sa.js"></script>
<script src="/lp/_shared/lp-tracker.js"></script>`;

  html = html.replace('</head>', inject + '\n</head>');
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.send(html);
});

// ── LP preview index — list all LPs with preview links + live stats ───────
router.get('/lp', (req, res) => {
  const rows = LPs.map(lp => {
    const stats = db.prepare(`
      SELECT
        COUNT(DISTINCT CASE WHEN event='lp_view'        THEN session_id END) AS views,
        COUNT(DISTINCT CASE WHEN event='lp_cta_click'   THEN session_id END) AS cta_clicks,
        COUNT(DISTINCT CASE WHEN event='signup_submit'  THEN session_id END) AS signups,
        COUNT(DISTINCT CASE WHEN event='nudge_scheduled'THEN session_id END) AS nudges
      FROM analytics_events
      WHERE json_extract(props, '$.variant') = ?
    `).get(lp.id) || {};
    return { ...lp, ...stats };
  });

  res.set('Content-Type', 'text/html');
  res.send(`<!doctype html>
<html><head><meta charset="utf-8"><title>LP Index — Spontany</title>
<style>
  body { font-family: system-ui, sans-serif; background: #0a0a0a; color: #fff; margin: 0; padding: 40px; }
  h1 { margin: 0 0 24px; font-size: 22px; }
  table { width: 100%; border-collapse: collapse; background: #111; border-radius: 8px; overflow: hidden; }
  th, td { padding: 12px 16px; text-align: left; border-bottom: 1px solid #222; font-size: 14px; }
  th { background: #1a1a1a; font-weight: 600; color: #aaa; text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px; }
  tr:last-child td { border-bottom: 0; }
  a { color: #c4d630; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .inactive { opacity: 0.4; }
  .pill { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px; background: #222; color: #aaa; }
  .pill.hero     { background: #1a2638; color: #7dd3fc; }
  .pill.demo     { background: #1f2d1a; color: #a3e635; }
  .pill.explainer{ background: #2a1f38; color: #c4b5fd; }
  .pill.teaser-share { background: #381a2a; color: #fda4af; }
</style></head><body>
<h1>Spontany LP test — active: ${getActiveLPs().length}/${LPs.length}</h1>
<table>
<thead><tr><th>ID</th><th>Label</th><th>Type</th><th>Views</th><th>CTA%</th><th>Signup%</th><th>Nudges</th><th>Preview</th></tr></thead>
<tbody>
${rows.map(r => {
  const ctr     = r.views > 0 ? ((r.cta_clicks / r.views) * 100).toFixed(1) : '—';
  const convert = r.views > 0 ? ((r.signups / r.views) * 100).toFixed(1) : '—';
  return `<tr class="${r.active ? '' : 'inactive'}">
    <td><code>${r.id}</code></td>
    <td>${r.label}</td>
    <td><span class="pill ${r.type}">${r.type}</span></td>
    <td>${r.views || 0}</td>
    <td>${ctr}${ctr !== '—' ? '%' : ''}</td>
    <td>${convert}${convert !== '—' ? '%' : ''}</td>
    <td>${r.nudges || 0}</td>
    <td><a href="/lp/${r.id}" target="_blank">open →</a></td>
  </tr>`;
}).join('')}
</tbody></table>
</body></html>`);
});

// ── POST /api/lp/signup ───────────────────────────────────────────────────
// Unified signup endpoint — captures email + name, logs variant, funnels
// into the existing waitlist flow so approval/onboarding stays consistent.
router.post('/api/lp/signup', async (req, res) => {
  const b = req.body || {};
  const email = (b.email || '').trim().toLowerCase();
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'invalid_email' });

  const first_name = (b.first_name || '').trim().slice(0, 40) || null;

  // Track signup in dedicated table (survives analytics resets + has UTM attribution)
  try {
    db.prepare(`
      INSERT INTO lp_signups (session_id, variant, email, first_name, utm_source, utm_campaign, utm_content)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      b.session_id || null,
      b.variant || null,
      email,
      first_name,
      b.utm_source || null,
      b.utm_campaign || null,
      b.utm_content || null,
    );
  } catch(e) {
    console.error('[lp signup] insert failed:', e.message);
  }

  // Fold into existing waitlist (same gated-beta flow)
  try {
    db.prepare('INSERT OR IGNORE INTO waitlist (email) VALUES (?)').run(email);
  } catch(e) {
    console.error('[lp signup] waitlist insert failed:', e.message);
  }

  res.json({ ok: true });
});

module.exports = router;
module.exports.LPs = LPs;
module.exports.getActiveLPs = getActiveLPs;
module.exports.findLP = findLP;
