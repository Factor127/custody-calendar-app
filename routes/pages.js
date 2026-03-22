const express = require('express');
const router = express.Router();
const path = require('path');
const { q } = require('../db');

const PUBLIC = path.join(__dirname, '..', 'public');

// First-time setup page
router.get('/setup', (req, res) => {
  const owner = q.ownerExists.get();
  if (owner) return res.redirect('/');
  res.sendFile(path.join(PUBLIC, 'setup.html'));
});

// R's main calendar
router.get('/calendar', (req, res) => {
  const token = req.query.token;
  if (!token) return res.redirect('/');
  const user = q.getUserByToken.get(token);
  if (!user || user.role !== 'owner') return res.redirect('/');
  res.sendFile(path.join(PUBLIC, 'calendar.html'));
});

// Partner onboarding
router.get('/invite/:token', (req, res) => {
  const invite = q.getInvite.get(req.params.token);
  if (!invite) {
    return res.status(404).send('<h2>This invite link is invalid or has expired.</h2><p>Ask your partner to generate a new one.</p>');
  }
  if (invite.used_by) {
    // If already registered, redirect to partner's calendar
    const partner = q.getUserById.get(invite.used_by);
    if (partner) return res.redirect(`/partner?token=${partner.access_token}`);
    return res.status(410).send('<h2>This invite has already been used.</h2>');
  }
  res.sendFile(path.join(PUBLIC, 'onboard.html'));
});

// Partner's calendar view
router.get('/partner', (req, res) => {
  const token = req.query.token;
  if (!token) return res.redirect('/');
  const user = q.getUserByToken.get(token);
  if (!user || user.role !== 'partner') return res.redirect('/');
  res.sendFile(path.join(PUBLIC, 'partner.html'));
});

module.exports = router;
