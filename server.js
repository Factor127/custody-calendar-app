const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

app.set('trust proxy', 1);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
// Serve static files — HTML never cached so deploys are instant
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

// Make BASE_URL available to routes
app.locals.BASE_URL = BASE_URL;

// ── Routes ────────────────────────────────────────────────────────────────────
const authRouter        = require('./routes/auth');
const apiRouter         = require('./routes/api');
const adminRouter       = require('./routes/admin');
const pagesRouter       = require('./routes/pages');
const smartSuggestRouter = require('./routes/smart-suggest');
const pushRouter         = require('./routes/push');

app.use('/api', authRouter);   // magic link endpoints at /api/auth/...
app.use('/', authRouter);      // Google OAuth at /auth/google, /auth/google/callback
app.use('/api', adminRouter);
app.use('/api', apiRouter);
const opportunitiesRouter  = require('./routes/opportunities');
const contributionsRouter  = require('./routes/contributions');
app.use('/api', opportunitiesRouter);
app.use('/api', contributionsRouter);
app.use('/api', smartSuggestRouter);
app.use('/api', pushRouter);
app.use('/', pagesRouter);

// ── Root: serve login/home page directly ──────────────────────────────────────
app.get('/', (req, res) => res.sendFile(require('path').join(__dirname, 'public', 'login.html')));

// ── PWA icon PNGs — generated from icon.svg via sharp ────────────────────────
const _iconCache = {};
app.get('/icon-:size.png', async (req, res) => {
  const size = parseInt(req.params.size);
  if (![192, 512].includes(size)) return res.status(404).end();
  try {
    if (!_iconCache[size]) {
      const sharp = require('sharp');
      const svgBuf = fs.readFileSync(path.join(__dirname, 'public', 'icon.svg'));
      _iconCache[size] = await sharp(svgBuf).resize(size, size).png().toBuffer();
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
