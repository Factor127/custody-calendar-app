const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { q } = require('../db');

// ── Google OAuth helpers ──────────────────────────────────────────────────────
const GOOGLE_AUTH_URL  = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USER_URL  = 'https://www.googleapis.com/oauth2/v3/userinfo';

function googleRedirectUri(req) {
  const base = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
  return `${base}/auth/google/callback`;
}

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
      <img src="${(process.env.BASE_URL||'')+'/icon-192.png'}" width="48" height="48" alt="Spontany" style="border-radius:12px;display:block;margin:0 0 10px;">
      <h1 style="font-size:22px;font-weight:800;margin:0 0 4px;color:#0c0c15;">Spontany</h1>
      <p style="color:#5f6368;margin:0 0 28px;font-size:14px;">Finds your moments — before they slip away.</p>

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
        <a href="/" class="btn btn-primary" style="display:inline-flex;margin-top:8px;">
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

// ── GET /auth/google/contacts ─────────────────────────────────────────────────
// Initiates a Google OAuth flow specifically for reading contacts.
// Requires the user to already be logged in (token in query).
router.get('/auth/google/contacts', (req, res) => {
  const token = req.query.token;
  if (!token) return res.redirect('/login');
  const user = q.getUserByToken.get(token);
  if (!user) return res.redirect('/login');

  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return res.status(500).send('Google is not configured.');

  const base = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
  const redirectUri = `${base}/auth/google/contacts/callback`;

  const params = new URLSearchParams({
    client_id:     clientId,
    redirect_uri:  redirectUri,
    response_type: 'code',
    scope:         'https://www.googleapis.com/auth/contacts.readonly',
    access_type:   'offline',
    prompt:        'consent',          // force refresh_token to be returned
    state:         token,              // carry user token through the flow
  });

  res.redirect(`${GOOGLE_AUTH_URL}?${params}`);
});

// ── GET /auth/google/contacts/callback ───────────────────────────────────────
router.get('/auth/google/contacts/callback', async (req, res) => {
  const { code, state: userToken, error } = req.query;
  if (error || !code || !userToken) return res.redirect('/connections?contacts_error=1');

  const user = q.getUserByToken.get(userToken);
  if (!user) return res.redirect('/login');

  try {
    const base = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
    const redirectUri = `${base}/auth/google/contacts/callback`;

    // Exchange code for tokens
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id:     process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri:  redirectUri,
        grant_type:    'authorization_code',
      }),
    });
    const tokens = await tokenRes.json();
    if (!tokens.access_token) throw new Error('No access token');

    const expiry = new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString();
    q.updateGoogleTokens.run(
      tokens.access_token,
      tokens.refresh_token || user.google_refresh_token || null,
      expiry,
      user.id
    );

    res.redirect(`/connections?token=${userToken}&contacts_imported=1`);
  } catch(e) {
    console.error('Contacts OAuth error:', e.message);
    res.redirect(`/connections?token=${userToken}&contacts_error=1`);
  }
});

// ── GET /auth/google ──────────────────────────────────────────────────────────
// Redirect user to Google's consent screen
router.get('/auth/google', (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return res.status(500).send('Google login is not configured.');

  const params = new URLSearchParams({
    client_id:     clientId,
    redirect_uri:  googleRedirectUri(req),
    response_type: 'code',
    scope:         'openid email profile',
    prompt:        'select_account',   // always show account picker
  });

  res.redirect(`${GOOGLE_AUTH_URL}?${params}`);
});

// ── GET /auth/google/callback ─────────────────────────────────────────────────
// Google redirects here with ?code=... after the user approves
router.get('/auth/google/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) return res.redirect('/?error=google_denied');

  try {
    // 1. Exchange code for tokens
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id:     process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri:  googleRedirectUri(req),
        grant_type:    'authorization_code',
      }),
    });
    const tokens = await tokenRes.json();
    if (!tokens.access_token) throw new Error('No access token from Google');

    // 2. Get user profile
    const userRes = await fetch(GOOGLE_USER_URL, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const gUser = await userRes.json();
    const googleId = gUser.sub;
    const email    = (gUser.email || '').toLowerCase();
    const name     = gUser.name || gUser.given_name || 'User';

    if (!email) throw new Error('No email returned from Google');

    // 3. Find or create user
    let user = q.getUserByGoogleId.get(googleId)     // returning Google user
            || q.getUserByEmail.get(email);           // previously magic-linked

    if (user) {
      // Link Google ID if not already stored
      if (!user.google_id) q.updateGoogleId.run(googleId, user.id);

      // Issue a fresh session token
      const newToken = uuidv4();
      q.updateUserToken.run(newToken, user.id);

      return res.redirect(
        user.role === 'owner'
          ? `/calendar?token=${newToken}`
          : `/partner?token=${newToken}`
      );
    }

    // 4. Brand-new user — send to setup with google context pre-filled
    //    We store a one-time magic link so setup can claim it
    const linkToken  = uuidv4();
    const expiresAt  = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 min
    q.createMagicLink.run(linkToken, email, null, expiresAt);

    // Pre-store google_id so it gets linked when they complete setup
    // We pass it as a URL param; setup route will include it in POST /api/users/setup
    return res.redirect(
      `/setup?magic=${linkToken}&email=${encodeURIComponent(email)}&name=${encodeURIComponent(name)}&google_id=${encodeURIComponent(googleId)}`
    );

  } catch(err) {
    console.error('Google OAuth error:', err.message);
    res.redirect('/?error=google_failed');
  }
});

module.exports = router;
