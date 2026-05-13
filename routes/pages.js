const express = require('express');
const router = express.Router();
const path = require('path');
const { q } = require('../db');
const { setSessionCookie } = require('./auth');

const PUBLIC = path.join(__dirname, '..', 'public');

// Cookie first (P2-Server), then ?token= for back-compat with bookmarks
// and the redirect leg of magic-link verify. Returns null if neither present.
function pageToken(req) {
  return (req.cookies && req.cookies.spontany_session) || req.query.token || null;
}

// Resolve the requesting user from cookie/query and, if the token came in
// only via the legacy query string, swap it onto the standard cookie session
// so subsequent API calls don't need ?token= in the URL. Returns the user
// row or null.
function resolveUserAndBridge(req, res) {
  const token = pageToken(req);
  if (!token) return null;
  const user = q.getUserByToken.get(token);
  if (!user) return null;
  const cookieToken = req.cookies && req.cookies.spontany_session;
  if (!cookieToken) setSessionCookie(res, token);
  return user;
}

// Admin panel. Gated to a single allowlisted email (env ADMIN_EMAIL) so the
// admin UI structure isn't visible to ordinary signed-in users. The API
// endpoints under /api/admin/* enforce the same session + ADMIN_EMAIL check
// (see requireAdmin in routes/admin.js), so the cookie is the one credential.
router.get('/admin', (req, res) => {
  const token = pageToken(req);
  if (!token) return res.status(403).send('<h2>Access denied</h2>');
  const user = q.getUserByToken.get(token);
  if (!user) return res.status(403).send('<h2>Access denied</h2>');
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) return res.status(503).send('<h2>Admin not configured</h2><p>Set ADMIN_EMAIL on the server.</p>');
  if ((user.email || '').toLowerCase() !== adminEmail.toLowerCase()) {
    return res.status(403).send('<h2>Access denied</h2>');
  }
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

  const continueUrl = param
    ? '/calendar.html?shareUrl=' + encodeURIComponent(param)
    : '/calendar.html';
  return res.redirect(302, continueUrl);
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
  // Preserve deep-link params (e.g. openEvent) through login redirect
  const openEvent = req.query.openEvent;
  const loginUrl = openEvent ? `/login?next=${encodeURIComponent('/calendar?openEvent=' + openEvent)}` : '/login';
  if (!resolveUserAndBridge(req, res)) return res.redirect(loginUrl);
  res.sendFile(path.join(PUBLIC, 'calendar.html'));
});

// Profile management
router.get('/profile', (req, res) => {
  if (!resolveUserAndBridge(req, res)) return res.redirect('/login');
  res.sendFile(path.join(PUBLIC, 'profile.html'));
});

// Connections management page
router.get('/connections', (req, res) => {
  if (!resolveUserAndBridge(req, res)) return res.redirect('/login');
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
  if (!resolveUserAndBridge(req, res)) return res.redirect('/login');
  res.sendFile(path.join(PUBLIC, 'kids-export.html'));
});

// Legacy partner route - redirect to unified calendar. We never echo the
// token into the URL anymore — auth is the httpOnly session cookie. A
// legacy ?token=… visit verifies that token is valid first (otherwise the
// /calendar GET would just bounce them back to /login).
router.get('/partner', (req, res) => {
  const cookieToken = req.cookies && req.cookies.spontany_session;
  if (cookieToken) return res.redirect('/calendar');
  const token = req.query.token;
  if (!token) return res.redirect('/login');
  const user = q.getUserByToken.get(token);
  if (!user) return res.redirect('/login');
  // Legacy bookmark — convert the URL-based token into the standard cookie
  // session so the user lands on /calendar with no token in the URL.
  setSessionCookie(res, token);
  return res.redirect('/calendar');
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
