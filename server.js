const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// ── A/B Testing Variants ─────────────────────────────────────────────────────
// Source of truth: routes/lp.js exports the LPs registry. We mirror the
// shape the rotator needs here. To add/retire LPs, edit routes/lp.js.
const AB_VARIANTS = (() => {
  try {
    const { LPs } = require('./routes/lp');
    return LPs.filter(lp => lp.active).map(lp => ({ id: lp.id, file: lp.file, active: true, lpType: lp.type }));
  } catch (e) {
    console.error('[ab] failed to load LP registry, falling back to legacy variants:', e.message);
    return [
      { id: 'control',   file: 'public/match.html',      active: true },
      { id: 'lp1-match', file: 'mockups/lp1-match.html', active: true },
      { id: 'believe',   file: 'public/believe.html',    active: true },
    ];
  }
})();

app.set('trust proxy', 1);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── A/B intercept for /match and /match.html (ad traffic entry point) ──────
// Must be registered BEFORE express.static and the pages router so we can
// inject variant tracking. Both paths are used in ad URLs (docs reference
// /match without the extension; some links still use /match.html).
app.get(['/match', '/match.html'], (req, res) => {
  const cookies = parseCookies(req);
  if (req.query.utm_source || req.query.utm_campaign) {
    res.cookie('sa_access', '1', { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: true, sameSite: 'lax' });
  }
  const variant = assignVariant(cookies, req.query, req);
  serveVariant(req, res, variant);
});

// Serve static files - HTML never cached so deploys are instant
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
    // Service worker must be served with no-cache and full-scope header
    if (filePath.endsWith('sw.js')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Service-Worker-Allowed', '/');
    }
  }
}));

// Public opportunities endpoint (needed by A/B variant pages)
// Optional ?region=dallas narrows to DFW-area location_name patterns so
// demos aimed at the Dallas audience don't surface Israel-seeded venues
// that the founder added while testing.
const REGION_PATTERNS = {
  dallas: ['Dallas','DFW','Fort Worth','Plano','Irving','Frisco','McKinney',
           'Arlington','Garland','Mesquite','Richardson','Grand Prairie',
           'Addison','Turtle Creek','Deep Ellum','Uptown','Highland Park',
           'Trinity Groves',' TX',', TX','Texas'],
};
app.get('/api/public/opportunities', (req, res) => {
  const db = require('./db');
  try {
    let rows = db.searchOpportunities({});
    const region = String(req.query.region || '').toLowerCase();
    const patterns = REGION_PATTERNS[region];
    if (patterns) {
      rows = rows.filter(o => {
        const loc = o.location_name || '';
        return patterns.some(p => loc.includes(p));
      });
    }
    const opps = rows.map(o => ({
      title: o.title,
      category: o.category,
      tags: JSON.parse(o.tags || '[]'),
      location_name: o.location_name,
      price_tier: o.price_tier,
      type: o.type,
      source_url: o.source_url || null,
      image_url: o.image_url || null,
    }));
    res.json({ opportunities: opps });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Serve mockups directory in development
if (process.env.NODE_ENV !== 'production') {
  app.use('/mockups', express.static(path.join(__dirname, 'mockups'), {
    setHeaders(res) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }));
}

// Make BASE_URL available to routes
app.locals.BASE_URL = BASE_URL;

// ── Routes ────────────────────────────────────────────────────────────────────
const authRouter        = require('./routes/auth');
const apiRouter         = require('./routes/api');
const adminRouter       = require('./routes/admin');
const pagesRouter       = require('./routes/pages');
const smartSuggestRouter = require('./routes/smart-suggest');
const pushRouter         = require('./routes/push');
const { startSequenceProcessor, markOpened } = require('./utils/emailSequence');

app.use('/api', authRouter);   // magic link endpoints at /api/auth/...
app.use('/', authRouter);      // Google OAuth at /auth/google, /auth/google/callback
app.use('/api', adminRouter);
app.use('/api', apiRouter);
const opportunitiesRouter  = require('./routes/opportunities');
const contributionsRouter  = require('./routes/contributions');
const matchRouter          = require('./routes/match');
const analyticsRouter      = require('./routes/analytics');
const nudgeRouter          = require('./routes/nudge');
const lpRouter             = require('./routes/lp');
const shareRouter          = require('./routes/share');
// routes/sandbox is local-only (gitignored). Optional require so prod doesn't
// crash when the file isn't present — see .gitignore for why.
let sandboxRouter = null;
try { sandboxRouter = require('./routes/sandbox'); } catch(e) { /* not present in prod */ }
app.use('/api', opportunitiesRouter);
app.use('/api', contributionsRouter);
app.use('/api', smartSuggestRouter);
app.use('/api', pushRouter);
app.use('/api', matchRouter);
app.use('/api', analyticsRouter);
app.use('/api', nudgeRouter);
if (sandboxRouter) app.use('/api', sandboxRouter);
app.use('/', lpRouter);
app.use('/', shareRouter);
app.use('/', pagesRouter);

// ── Waitlist API (public + admin) ─────────────────────────────────────────────
const { db: _db } = require('./db');
const { sendEmail } = require('./utils/email');

app.post('/api/waitlist', (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email required' });
  try {
    _db.prepare('INSERT OR IGNORE INTO waitlist (email) VALUES (?)').run(email);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to save' });
  }
});

app.get('/api/admin/waitlist', (req, res) => {
  const token = req.query.token || req.headers['x-admin-token'];
  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) return res.status(403).json({ error: 'Forbidden' });
  const rows = _db.prepare('SELECT * FROM waitlist ORDER BY created_at DESC').all();
  res.json({ waitlist: rows });
});

app.put('/api/admin/waitlist/:id/approve', async (req, res) => {
  const token = req.query.token || req.headers['x-admin-token'];
  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) return res.status(403).json({ error: 'Forbidden' });
  const row = _db.prepare('SELECT * FROM waitlist WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.status === 'approved') return res.json({ ok: true, already: true });

  const accessToken = require('crypto').randomUUID();
  _db.prepare('UPDATE waitlist SET status = ?, access_token = ?, approved_at = datetime(\'now\') WHERE id = ?')
    .run('approved', accessToken, req.params.id);

  // Send approval email
  const accessLink = `${BASE_URL}/?access=${accessToken}`;
  const FROM_EMAIL = process.env.FROM_EMAIL || 'onboarding@resend.dev';
  await sendEmail({
    from: FROM_EMAIL,
    to: row.email,
    subject: "You're in! Welcome to Spontany",
    html: `<div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;background:#0a0a0a;color:#ffffff;padding:40px;border-radius:12px;">
      <h1 style="font-size:24px;margin:0 0 16px;">You're off the waitlist!</h1>
      <p style="color:rgba(255,255,255,0.7);line-height:1.6;margin:0 0 24px;">Great news - your early access to Spontany is ready. Click below to get started.</p>
      <a href="${accessLink}" style="display:inline-block;background:#c4d630;color:#1a1a1a;padding:14px 28px;border-radius:50px;text-decoration:none;font-weight:700;font-size:15px;">Get early access &rarr;</a>
      <p style="color:rgba(255,255,255,0.4);font-size:12px;margin-top:32px;">Spontany - finds your moments before they slip away.</p>
    </div>`,
    bodyText: `You're off the waitlist! Visit ${accessLink} to get started.`
  });

  res.json({ ok: true });
});

// ── Root: landing page with A/B testing ──────────────────────────────────────
function parseCookies(req) {
  const raw = req.headers.cookie || '';
  const out = {};
  raw.split(';').forEach(c => {
    const [k, ...v] = c.split('=');
    if (k) out[k.trim()] = decodeURIComponent(v.join('=').trim());
  });
  return out;
}

function assignVariant(cookies, query, req) {
  const active = AB_VARIANTS.filter(v => v.active);
  if (active.length === 0) return AB_VARIANTS[0]; // fallback

  // Query param override (e.g. /?variant=lp1-match) - used for cross-variant links
  if (query.variant) {
    const forced = active.find(v => v.id === query.variant);
    if (forced) { recordAssignment(forced.id, req); return forced; }
  }

  // Honor existing cookie if variant is still active (sticky per user)
  const existing = cookies.sa_variant;
  if (existing) {
    const match = active.find(v => v.id === existing);
    if (match) return match; // don't re-record — sticky revisits aren't new assignments
  }

  // Least-assigned balancing using the variant_assignments table, which is
  // written server-side immediately (no client-event race).
  let pick;
  try {
    const counts = _db.prepare(`
      SELECT variant, COUNT(*) AS cnt FROM variant_assignments GROUP BY variant
    `).all();
    const countMap = {};
    counts.forEach(r => { countMap[r.variant] = r.cnt; });

    let min = Infinity;
    pick = active[0];
    for (const v of active) {
      const c = countMap[v.id] || 0;
      if (c < min) { min = c; pick = v; }
    }
  } catch(e) {
    pick = active[Math.floor(Math.random() * active.length)];
  }

  recordAssignment(pick.id, req);
  return pick;
}

// Record a fresh variant assignment. Fingerprint is a lightweight dedupe
// hint (IP + UA hash) so repeat load tests from one box don't pollute counts
// too badly — but it's intentionally non-authoritative, just best-effort.
function recordAssignment(variantId, req) {
  try {
    const ip = (req && (req.headers['x-forwarded-for'] || req.ip)) || '';
    const ua = (req && req.headers['user-agent']) || '';
    const fp = require('crypto').createHash('sha1').update(ip + '|' + ua).digest('hex').slice(0, 16);
    _db.prepare('INSERT INTO variant_assignments (variant, fingerprint) VALUES (?, ?)').run(variantId, fp);
  } catch(e) { /* never block the request on a count-write failure */ }
}

function serveVariant(req, res, variant) {
  const filePath = path.join(__dirname, variant.file);
  let html;
  try {
    html = fs.readFileSync(filePath, 'utf8');
  } catch(e) {
    console.error(`A/B: failed to read ${variant.file}:`, e.message);
    return res.sendFile(path.join(__dirname, 'public', 'landing.html'));
  }

  // Set variant cookie (readable by client JS)
  res.cookie('sa_variant', variant.id, { maxAge: 30 * 24 * 60 * 60 * 1000, sameSite: 'lax' });

  // Auto-inject tracking before </head>
  // Wrap sa() to always include variant - works even with old cached sa.js
  const lpType = variant.lpType || '';
  const variantScript = `<script>
sessionStorage.setItem('sa_variant','${variant.id}');
window.__SA_VARIANT='${variant.id}';
window.__LP_ID='${variant.id}';
window.__LP_TYPE='${lpType}';
(function(){var _sa=window.sa;if(_sa){window.sa=function(e,p){p=p||{};if(!p.variant)p.variant='${variant.id}';return _sa(e,p);};}})();
</script>`;

  // Only inject sa.js if not already present (check for actual script tag)
  if (html.includes('src="/sa.js"') || html.includes("src='/sa.js'")) {
    html = html.replace('</head>', variantScript + '\n</head>');
  } else {
    html = html.replace('</head>', `<script src="/sa.js"></script>\n` + variantScript + '\n</head>');
  }

  // LP variants get the SDK auto-injected (floating CTA + nudge panel)
  if (lpType && !html.includes('/lp/_shared/lp-tracker.js')) {
    html = html.replace('</head>', `<script src="/lp/_shared/lp-tracker.js"></script>\n</head>`);
  }

  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.send(html);
}

app.get('/', (req, res) => {
  // Waitlist approval email (/?access=<token>) still sets the access cookie
  // so downstream gated pages work; then we fall through to login.
  if (req.query.access) {
    const row = _db.prepare("SELECT id FROM waitlist WHERE access_token = ? AND status = 'approved'").get(req.query.access);
    if (row) {
      res.cookie('sa_access', '1', { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: true, sameSite: 'lax' });
    }
  }
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));

// ── Email sequence: open tracking pixel ──────────────────────────────────────
app.get('/api/email/open', (req, res) => {
  const { u: userId, s: step } = req.query;
  if (userId && step) {
    try { markOpened(userId, parseInt(step)); } catch(e) { /* non-critical */ }
  }
  // Return a 1×1 transparent GIF
  const GIF = Buffer.from('R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==', 'base64');
  res.set({ 'Content-Type': 'image/gif', 'Cache-Control': 'no-store', 'Content-Length': GIF.length });
  res.end(GIF);
});

// ── Email sequence: unsubscribe ───────────────────────────────────────────────
app.get('/api/email/unsubscribe', (req, res) => {
  const { token } = req.query;
  if (token) {
    try {
      const { db } = require('./db');
      const user = db.prepare('SELECT id, name FROM users WHERE access_token = ?').get(token);
      if (user) {
        db.prepare('UPDATE users SET unsubscribed = 1 WHERE id = ?').run(user.id);
        return res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Unsubscribed</title>
          <style>body{font-family:-apple-system,sans-serif;background:#0a0a0a;color:#eeeef8;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;}
          .box{text-align:center;max-width:400px;padding:40px;} h1{font-size:24px;margin-bottom:12px;} p{color:rgba(238,238,248,0.6);font-size:14px;line-height:1.6;}
          a{color:#e6f952;text-decoration:none;}</style></head>
          <body><div class="box">
            <h1>You're unsubscribed.</h1>
            <p>We'll stop sending you email updates, ${user.name.split(' ')[0]}.</p>
            <p style="margin-top:20px;"><a href="/">Back to Spontany</a></p>
          </div></body></html>`);
      }
    } catch(e) { /* non-critical */ }
  }
  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Unsubscribed</title>
    <style>body{font-family:-apple-system,sans-serif;background:#0a0a0a;color:#eeeef8;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;}
    .box{text-align:center;max-width:400px;padding:40px;} h1{font-size:24px;margin-bottom:12px;} p{color:rgba(238,238,248,0.6);font-size:14px;}</style></head>
    <body><div class="box"><h1>Unsubscribed.</h1><p>You won't receive further emails from us.</p></div></body></html>`);
});

// ── PWA icon PNGs - generated from icon-source.png via sharp ─────────────────
const _iconCache = {};
app.get('/icon-:size.png', async (req, res) => {
  const size = parseInt(req.params.size);
  if (![192, 512].includes(size)) return res.status(404).end();
  try {
    if (!_iconCache[size]) {
      const sharp = require('sharp');
      const srcBuf = fs.readFileSync(path.join(__dirname, 'public', 'icon-source.png'));
      _iconCache[size] = await sharp(srcBuf).resize(size, size).png().toBuffer();
    }
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=604800'); // 1 week
    res.send(_iconCache[size]);
  } catch (e) {
    console.error('Icon generation failed:', e.message);
    res.status(500).end();
  }
});

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).send('<h2>Page not found</h2><a href="/">Go home</a>');
});

app.listen(PORT, () => {
  console.log(`\n✓ Spontany running at ${BASE_URL}`);
  console.log(`  → New users: ${BASE_URL}/login\n`);
  console.log('ENV CHECK:',
    'GOOGLE_CLIENT_ID:', process.env.GOOGLE_CLIENT_ID ? '✓ set' : '✗ MISSING',
    '| GOOGLE_CLIENT_SECRET:', process.env.GOOGLE_CLIENT_SECRET ? '✓ set' : '✗ MISSING',
    '| BASE_URL:', process.env.BASE_URL || '(using default)'
  );

  // ── Weekly digest scheduler ──────────────────────────────────────────────
  // Fires every Friday at 08:00 UTC. No external cron service needed.
  if (process.env.CRON_SECRET && process.env.RESEND_API_KEY) {
    scheduleWeeklyDigest();
    console.log('  → Weekly digest scheduler: active (fires Fridays 08:00 UTC)');
  } else {
    console.log('  → Weekly digest: disabled (set CRON_SECRET + RESEND_API_KEY to enable)');
  }

  // ── Welcome email sequence processor ─────────────────────────────────────
  if (process.env.RESEND_API_KEY) {
    startSequenceProcessor();
  } else {
    console.log('  → Email sequence: disabled (set RESEND_API_KEY to enable)');
  }

  // ── Nudge worker (polls every 60s for due SMS nudges) ────────────────────
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    nudgeRouter.startNudgeWorker();
    console.log('  → Nudge worker: active (polls every 60s)');
  } else {
    console.log('  → Nudge worker: disabled (set TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN to enable)');
  }
});

function scheduleWeeklyDigest() {
  function msUntilNextFriday8am() {
    const now = new Date();
    const next = new Date(now);
    // Advance to next Friday
    const dayOfWeek = now.getUTCDay(); // 0=Sun, 5=Fri
    const daysUntilFriday = (5 - dayOfWeek + 7) % 7 || 7; // always at least 1 week if already Friday
    next.setUTCDate(now.getUTCDate() + daysUntilFriday);
    next.setUTCHours(8, 0, 0, 0);
    return next - now;
  }

  function runDigest() {
    const url = `http://localhost:${PORT}/api/cron/weekly-digest`;
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Cron-Secret': process.env.CRON_SECRET }
    })
      .then(r => r.json())
      .then(d => console.log(`[digest] Sent ${d.emails_sent} emails (${d.connections_checked} connections checked)`))
      .catch(e => console.error('[digest] Error:', e.message));

    // Schedule next run in exactly 7 days
    setTimeout(runDigest, 7 * 24 * 60 * 60 * 1000);
  }

  // First run: wait until next Friday 08:00 UTC
  setTimeout(runDigest, msUntilNextFriday8am());
}
