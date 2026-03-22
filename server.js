const express = require('express');
const path = require('path');
const { q } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

app.set('trust proxy', 1);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Make BASE_URL available to routes
app.locals.BASE_URL = BASE_URL;

// ── Routes ────────────────────────────────────────────────────────────────────
const apiRouter = require('./routes/api');
const pagesRouter = require('./routes/pages');

app.use('/api', apiRouter);
app.use('/', pagesRouter);

// ── Root redirect ─────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  const owner = q.getOwner.get();
  if (!owner) {
    return res.redirect('/setup');
  }
  // If owner exists but no token in URL, redirect with owner's token
  return res.redirect(`/calendar?token=${owner.access_token}`);
});

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).send('<h2>Page not found</h2><a href="/">Go home</a>');
});

app.listen(PORT, () => {
  console.log(`\n✓ Custody Calendar running at http://localhost:${PORT}`);
  const owner = q.getOwner.get();
  if (!owner) {
    console.log('  → First time? Open that URL to complete setup.\n');
  } else {
    console.log(`  → Your calendar: http://localhost:${PORT}/calendar?token=${owner.access_token}\n`);
  }
});
