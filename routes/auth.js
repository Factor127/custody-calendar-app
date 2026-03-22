const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { q } = require('../db');

// Lazy-load Resend so the app still starts if the package isn't installed yet
let resend = null;
function getResend() {
  if (resend) return resend;
  try {
    const { Resend } = require('resend');
    if (process.env.RESEND_API_KEY) {
      resend = new Resend(process.env.RESEND_API_KEY);
    }
  } catch(e) { /* package not installed */ }
  return resend;
}

// ── POST /api/auth/request ────────────────────────────────────────────────────
// Send a magic login/signup link to the given email address.
// If email is already registered → login link (existing user).
// If email is new → setup link (will create account on first use).
router.post('/auth/request', async (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  const normalEmail = email.trim().toLowerCase();
  const user = q.getUserByEmail.get(normalEmail);

  // Create a magic link valid for 24 hours (gives enough time to complete setup wizard)
  const linkToken = uuidv4();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  q.createMagicLink.run(linkToken, normalEmail, user?.id || null, expiresAt);

  const BASE_URL = req.app.locals.BASE_URL;
  const FROM_EMAIL = process.env.FROM_EMAIL || 'onboarding@resend.dev';
  const verifyUrl = `${BASE_URL}/api/auth/verify/${linkToken}`;

  const isNew = !user;
  const subject = isNew ? 'Set up your Spontany calendar' : 'Your Spontany login link';
  const html = `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#202124;">
      <h1 style="font-size:22px;font-weight:800;margin:0 0 4px;">📅 Spontany</h1>
      <p style="color:#5f6368;margin:0 0 28px;font-size:14px;">Shared custody calendar</p>

      <p style="margin:0 0 20px;">
        ${isNew
          ? 'Someone (hopefully you!) asked to set up a Spontany custody calendar with this email address.'
          : 'Click below to log in to your custody calendar — no password needed.'}
      </p>

      <a href="${verifyUrl}"
         style="display:inline-block;background:#1a73e8;color:white;padding:13px 28px;border-radius:8px;
                text-decoration:none;font-weight:700;font-size:15px;margin-bottom:24px;">
        ${isNew ? 'Set up my calendar →' : 'Open my calendar →'}
      </a>

      <p style="color:#5f6368;font-size:13px;margin:0;">
        This link expires in 24 hours and can only be used once.<br>
        If you didn't request this, you can safely ignore this email.
      </p>
    </div>
  `;

  const client = getResend();
  if (client) {
    try {
      await client.emails.send({ from: FROM_EMAIL, to: normalEmail, subject, html });
    } catch(err) {
      console.error('Resend error:', err?.message || err);
      return res.status(500).json({ error: 'Failed to send email. Please try again.' });
    }
  } else {
    // Dev/local fallback: print the link to the server console
    console.log(`\n📧 MAGIC LINK (email not configured — copy this into your browser):`);
    console.log(`   ${verifyUrl}\n`);
  }

  res.json({ sent: true });
});

// ── GET /api/auth/verify/:token ───────────────────────────────────────────────
// Validates the magic link and redirects the user to the right page.
router.get('/auth/verify/:token', (req, res) => {
  const link = q.getMagicLink.get(req.params.token);

  if (!link) {
    return res.status(410).send(`
      <!DOCTYPE html><html><head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <title>Link expired</title>
        <link rel="stylesheet" href="/styles.css">
      </head><body style="text-align:center;padding:60px 24px;">
        <div style="font-size:48px;margin-bottom:16px;">⏰</div>
        <h2>This link has expired or already been used</h2>
        <p style="color:#5f6368;">Magic links are single-use and expire after 24 hours.</p>
        <a href="/login" class="btn btn-primary" style="display:inline-flex;margin-top:8px;">
          Request a new link →
        </a>
      </body></html>
    `);
  }

  if (!link.user_id) {
    // New email — pass the magic token to setup; DON'T mark used yet.
    // It will be consumed by POST /api/users/setup when the user completes the wizard.
    return res.redirect(
      `/setup?magic=${req.params.token}&email=${encodeURIComponent(link.email)}`
    );
  }

  // Existing user — mark link used and issue a fresh session token
  q.useMagicLink.run(req.params.token);
  const newToken = uuidv4();
  q.updateUserToken.run(newToken, link.user_id);

  const user = q.getUserById.get(link.user_id);
  return res.redirect(
    user.role === 'owner'
      ? `/calendar?token=${newToken}`
      : `/partner?token=${newToken}`
  );
});

module.exports = router;
