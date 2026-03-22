const express = require('express');
const path = require('path');

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
const authRouter  = require('./routes/auth');
const apiRouter   = require('./routes/api');
const pagesRouter = require('./routes/pages');

app.use('/api', authRouter);   // auth first (magic link endpoints)
app.use('/api', apiRouter);
app.use('/', pagesRouter);

// ── Root: redirect to login ───────────────────────────────────────────────────
app.get('/', (req, res) => res.redirect('/login'));

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).send('<h2>Page not found</h2><a href="/login">Go home</a>');
});

app.listen(PORT, () => {
  console.log(`\n✓ Spontany running at ${BASE_URL}`);
  console.log(`  → New users: ${BASE_URL}/login\n`);
});
