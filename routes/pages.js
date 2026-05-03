const express = require('express');
const router = express.Router();
const path = require('path');
const { q } = require('../db');

const PUBLIC = path.join(__dirname, '..', 'public');

// Admin panel (protected by ADMIN_TOKEN env var)
router.get('/admin', (req, res) => {
  if (!req.query.token) return res.status(403).send('<h2>Access denied</h2><p>Include ?token= in the URL.</p>');
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(PUBLIC, 'admin.html'));
});

// ── Web Share Target ─────────────────────────────────────────────────────────
// Manifest declares share_target.action = '/share-target'. When the user
// shares a URL (or text containing a URL) from another app — Chrome,
// Instagram, Facebook, etc. — Android dispatches the share here. We pull
// the URL out of either the `url` param or from inside `text` (Chrome
// often puts the URL into text), then bounce to /calendar.html with a
// shareUrl=… query param so calendar.html's init can open the crafter
// pre-filled with the link.
router.get('/share-target', (req, res) => {
  // Pick whichever param actually contains a URL
  const candidates = [req.query.url, req.query.text, req.query.title].filter(Boolean);
  let sharedUrl = null;
  for (const v of candidates) {
    const m = String(v).match(/https?:\/\/[^\s]+/i);
    if (m) { sharedUrl = m[0]; break; }
  }
  const fallback = candidates.find(Boolean) || '';
  const param = sharedUrl || fallback;

  // ── DEBUG MODE ──────────────────────────────────────────────────────────
  // We've been chasing this through 5+ deploys with no resolution. Render
  // a visible page showing EXACTLY what landed on the server, so we can see
  // whether Android is sending the share data at all. The page auto-
  // continues to the calendar after 8 seconds (or click "Continue now").
  // Remove this block once the share chain is verified end-to-end.
  const escape = (s) => String(s ?? '(none)').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
  const logLine = `[share-target] ${new Date().toISOString()} url=${req.query.url||''} text=${req.query.text||''} title=${req.query.title||''} ua=${req.headers['user-agent']||''}`;
  console.log(logLine);
  const continueUrl = param
    ? '/calendar.html?shareUrl=' + encodeURIComponent(param)
    : '/calendar.html';
  return res.send(`<!doctype html><html><head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Share received - Spontany</title>
    <style>
      body { margin:0; font:14px/1.5 -apple-system,system-ui,sans-serif; background:#0c0c15; color:#fff; padding:20px; }
      h1 { font-size:18px; margin:0 0 16px; color:#fbbf24; }
      pre { background:#1a1a2a; padding:12px; border-radius:8px; overflow-x:auto; word-break:break-all; white-space:pre-wrap; font-size:12px; }
      .row { margin:10px 0; }
      .label { color:#8a8aa8; font-size:11px; text-transform:uppercase; letter-spacing:0.5px; }
      .val { word-break:break-all; }
      .empty { color:#55556a; font-style:italic; }
      a.btn { display:inline-block; margin-top:18px; background:#f97316; color:#fff; padding:12px 24px; border-radius:8px; text-decoration:none; font-weight:600; }
      .countdown { color:#8a8aa8; font-size:12px; margin-top:8px; }
    </style>
  </head><body>
    <h1>🔍 /share-target was hit — here's what arrived</h1>

    <div class="row"><div class="label">?url</div><div class="val ${req.query.url ? '' : 'empty'}">${escape(req.query.url)}</div></div>
    <div class="row"><div class="label">?text</div><div class="val ${req.query.text ? '' : 'empty'}">${escape(req.query.text)}</div></div>
    <div class="row"><div class="label">?title</div><div class="val ${req.query.title ? '' : 'empty'}">${escape(req.query.title)}</div></div>
    <div class="row"><div class="label">Extracted URL</div><div class="val ${param ? '' : 'empty'}">${escape(param)}</div></div>
    <div class="row"><div class="label">User-Agent</div><pre>${escape(req.headers['user-agent'])}</pre></div>
    <div class="row"><div class="label">Will redirect to</div><div class="val">${escape(continueUrl)}</div></div>

    <a class="btn" href="${continueUrl}">Continue to calendar →</a>
    <div class="countdown">Auto-continues in <span id="cd">8</span>s</div>

    <script>
      let n = 8;
      const el = document.getElementById('cd');
      const timer = setInterval(() => {
        n--; if (el) el.textContent = n;
        if (n <= 0) { clearInterval(timer); window.location.replace(${JSON.stringify(continueUrl)}); }
      }, 1000);
    </script>
  </body></html>`);
});

// Login page - served by server.js directly, skip here to avoid conflicts

// First-time setup page - now served by the unified onboard.html
// Multi-tenant: any verified email can set up - requires ?magic= from auth flow
router.get('/setup', (req, res) => {
  if (!req.query.magic) return res.redirect('/login');
  res.sendFile(path.join(PUBLIC, 'onboard.html'));
});

// Unified calendar - works for all authenticated users
router.get('/calendar', (req, res) => {
  const token = req.query.token;
  // Preserve deep-link params (e.g. openEvent) through login redirect
  const openEvent = req.query.openEvent;
  const loginUrl = openEvent ? `/login?next=${encodeURIComponent('/calendar?openEvent=' + openEvent)}` : '/login';
  if (!token) return res.redirect(loginUrl);
  const user = q.getUserByToken.get(token);
  if (!user) return res.redirect(loginUrl);
  res.sendFile(path.join(PUBLIC, 'calendar.html'));
});

// Profile management
router.get('/profile', (req, res) => {
  const token = req.query.token;
  if (!token) return res.redirect('/login');
  const user = q.getUserByToken.get(token);
  if (!user) return res.redirect('/login');
  res.sendFile(path.join(PUBLIC, 'profile.html'));
});

// Connections management page
router.get('/connections', (req, res) => {
  const token = req.query.token;
  if (!token) return res.redirect('/login');
  const user = q.getUserByToken.get(token);
  if (!user) return res.redirect('/login');
  res.sendFile(path.join(PUBLIC, 'connections.html'));
});

// Partner onboarding
router.get('/invite/:token', (req, res) => {
  // Guard against literal "undefined" being passed as a token
  if (!req.params.token || req.params.token === 'undefined') {
    return res.status(404).send('<h2>This invite link is invalid.</h2><p>Ask your partner to generate a new one.</p>');
  }
  const invite = q.getInvite.get(req.params.token);
  if (!invite) {
    return res.status(404).send('<h2>This invite link is invalid or has expired.</h2><p>Ask your partner to generate a new one.</p>');
  }
  if (invite.used_by) {
    // Invite already used - never expose the registered user's token to whoever is clicking.
    // The legitimate partner should log in via their saved URL or the magic-link flow.
    return res.status(410).send(`<!DOCTYPE html><html><head><meta charset="UTF-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <title>Invite already used - Spontany</title>
      <style>
        body{margin:0;background:#0a0a0a;color:#eeeef8;font-family:-apple-system,sans-serif;
             display:flex;align-items:center;justify-content:center;min-height:100vh;}
        .box{text-align:center;max-width:400px;padding:40px 24px;}
        h1{font-size:22px;font-weight:800;margin:0 0 12px;}
        p{color:rgba(238,238,248,0.55);font-size:14px;line-height:1.6;margin:0 0 24px;}
        a{display:inline-block;padding:12px 28px;background:#e6f952;color:white;
          border-radius:50px;text-decoration:none;font-size:14px;font-weight:700;}
      </style></head>
      <body><div class="box">
        <h1>This invite has already been used.</h1>
        <p>If you're the person who registered with this link, log in to access your account.</p>
        <a href="/login">Log in to Spontany</a>
      </div></body></html>`);
  }
  res.sendFile(path.join(PUBLIC, 'onboard.html'));
});

// Kids month export (clean printable single-month view)
router.get('/kids-export', (req, res) => {
  const token = req.query.token;
  if (!token) return res.redirect('/login');
  const user = q.getUserByToken.get(token);
  if (!user) return res.redirect('/login');
  res.sendFile(path.join(PUBLIC, 'kids-export.html'));
});

// Legacy partner route - redirect to unified calendar
router.get('/partner', (req, res) => {
  const token = req.query.token;
  if (!token) return res.redirect('/login');
  return res.redirect(token ? `/calendar?token=${token}` : '/login');
});

// RSVP landing page - no auth required, rsvp_token in URL
router.get('/rsvp/:token', (req, res) => {
  res.sendFile(path.join(PUBLIC, 'rsvp.html'));
});

router.get('/privacy', (req, res) => {
  res.sendFile(path.join(PUBLIC, 'privacy.html'));
});

router.get('/privacy-policy', (req, res) => {
  res.sendFile(path.join(PUBLIC, 'privacy-policy.html'));
});

router.get('/terms', (req, res) => {
  res.sendFile(path.join(PUBLIC, 'terms-of-service.html'));
});
router.get('/terms-of-service', (req, res) => {
  res.sendFile(path.join(PUBLIC, 'terms-of-service.html'));
});

// Match tool - public, no auth required. Token is read client-side from URL.
router.get('/match', (req, res) => {
  res.sendFile(path.join(PUBLIC, 'match.html'));
});
router.get('/match/:token', (req, res) => {
  res.sendFile(path.join(PUBLIC, 'match.html'));
});
router.get('/date/:token', (req, res) => {
  res.sendFile(path.join(PUBLIC, 'date-invite.html'));
});

module.exports = router;
