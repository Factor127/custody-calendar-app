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

// Login page (served at root; /login kept as alias)
router.get('/login', (req, res) => {
  res.redirect('/');
});

// First-time setup page
// Multi-tenant: any verified email can set up — requires ?magic= from auth flow
router.get('/setup', (req, res) => {
  if (!req.query.magic) return res.redirect('/login');
  res.sendFile(path.join(PUBLIC, 'setup.html'));
});

// Unified calendar — works for all authenticated users
router.get('/calendar', (req, res) => {
  const token = req.query.token;
  if (!token) return res.redirect('/');
  const user = q.getUserByToken.get(token);
  if (!user) return res.redirect('/');
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
  if (!token) return res.redirect('/');
  const user = q.getUserByToken.get(token);
  if (!user) return res.redirect('/');
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
    // If already registered, redirect to partner's calendar
    const partner = q.getUserById.get(invite.used_by);
    if (partner) return res.redirect(`/calendar?token=${partner.access_token}`);
    return res.status(410).send('<h2>This invite has already been used.</h2>');
  }
  res.sendFile(path.join(PUBLIC, 'onboard.html'));
});

// Kids month export (clean printable single-month view)
router.get('/kids-export', (req, res) => {
  const token = req.query.token;
  if (!token) return res.redirect('/');
  const user = q.getUserByToken.get(token);
  if (!user) return res.redirect('/');
  res.sendFile(path.join(PUBLIC, 'kids-export.html'));
});

// Legacy partner route — redirect to unified calendar
router.get('/partner', (req, res) => {
  const token = req.query.token;
  if (!token) return res.redirect('/');
  return res.redirect(token ? `/calendar?token=${token}` : '/');
});

router.get('/privacy', (req, res) => {
  res.sendFile(path.join(PUBLIC, 'privacy.html'));
});

module.exports = router;
