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

// Login page — served by server.js directly, skip here to avoid conflicts

// First-time setup page — now served by the unified onboard.html
// Multi-tenant: any verified email can set up — requires ?magic= from auth flow
router.get('/setup', (req, res) => {
  if (!req.query.magic) return res.redirect('/login');
  res.sendFile(path.join(PUBLIC, 'onboard.html'));
});

// Unified calendar — works for all authenticated users
router.get('/calendar', (req, res) => {
  const token = req.query.token;
  if (!token) return res.redirect('/login');
  const user = q.getUserByToken.get(token);
  if (!user) return res.redirect('/login');
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
    // Invite already used — never expose the registered user's token to whoever is clicking.
    // The legitimate partner should log in via their saved URL or the magic-link flow.
    return res.status(410).send(`<!DOCTYPE html><html><head><meta charset="UTF-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <title>Invite already used — Spontany</title>
      <style>
        body{margin:0;background:#0c0c15;color:#eeeef8;font-family:-apple-system,sans-serif;
             display:flex;align-items:center;justify-content:center;min-height:100vh;}
        .box{text-align:center;max-width:400px;padding:40px 24px;}
        h1{font-size:22px;font-weight:800;margin:0 0 12px;}
        p{color:rgba(238,238,248,0.55);font-size:14px;line-height:1.6;margin:0 0 24px;}
        a{display:inline-block;padding:12px 28px;background:#7c5cbf;color:white;
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

// Legacy partner route — redirect to unified calendar
router.get('/partner', (req, res) => {
  const token = req.query.token;
  if (!token) return res.redirect('/login');
  return res.redirect(token ? `/calendar?token=${token}` : '/login');
});

// RSVP landing page — no auth required, rsvp_token in URL
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

// Match tool — public, no auth required. Token is read client-side from URL.
router.get('/match', (req, res) => {
  res.sendFile(path.join(PUBLIC, 'match.html'));
});
router.get('/match/:token', (req, res) => {
  res.sendFile(path.join(PUBLIC, 'match.html'));
});

module.exports = router;
