// Uses Node.js 22+ built-in SQLite — no native compilation needed
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = process.env.DATABASE_PATH || path.join(DATA_DIR, 'calendar.db');
const db = new DatabaseSync(DB_PATH);

// Performance + safety pragmas
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

// ── Safe migrations (run on every startup, idempotent) ───────────────────────
try { db.exec('ALTER TABLE users ADD COLUMN email TEXT'); } catch(e) { /* already exists */ }
try { db.exec('ALTER TABLE users ADD COLUMN mobile TEXT'); } catch(e) { /* already exists */ }
try { db.exec('ALTER TABLE users ADD COLUMN coparent_name TEXT'); } catch(e) { /* already exists */ }
try { db.exec('ALTER TABLE users ADD COLUMN coparent_phone TEXT'); } catch(e) { /* already exists */ }
try { db.exec('ALTER TABLE users ADD COLUMN partner_phone TEXT'); } catch(e) { /* already exists */ }
try { db.exec('ALTER TABLE users ADD COLUMN google_id TEXT'); } catch(e) { /* already exists */ }
try { db.exec("ALTER TABLE invites ADD COLUMN relationship_type TEXT NOT NULL DEFAULT 'coparent'"); } catch(e) { /* already exists */ }
try { db.exec("ALTER TABLE connections ADD COLUMN relationship_type TEXT NOT NULL DEFAULT 'coparent'"); } catch(e) { /* already exists */ }
try { db.exec("ALTER TABLE connections ADD COLUMN desired_duration_days INTEGER"); } catch(e) { /* already exists */ }
// Backfill connections.relationship_type from the invite that was used to join
try {
  db.exec(`
    UPDATE connections SET relationship_type = (
      SELECT COALESCE(i.relationship_type, 'coparent')
      FROM invites i
      WHERE i.used_by = connections.requester_id
        AND i.created_by = connections.target_id
      LIMIT 1
    ) WHERE EXISTS (
      SELECT 1 FROM invites i
      WHERE i.used_by = connections.requester_id
        AND i.created_by = connections.target_id
    )
  `);
} catch(e) { /* ignore if column not ready */ }
try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email)'); } catch(e) { /* table may not exist yet on first run */ }

// ── Migrate pattern_data key names from onboarding legacy format ──────────────
// Onboarding used week1_self_days/week2_self_days; canonical is week_a_days/week_b_days
try {
  const rows = db.prepare("SELECT user_id, pattern_data FROM custody_pattern WHERE pattern_type='alternating_weeks'").all();
  const upd  = db.prepare("UPDATE custody_pattern SET pattern_data = ? WHERE user_id = ?");
  for (const row of rows) {
    try {
      const d = JSON.parse(row.pattern_data);
      if (d.week1_self_days !== undefined || d.week2_self_days !== undefined) {
        if (!d.week_a_days) d.week_a_days = d.week1_self_days || [];
        if (!d.week_b_days) d.week_b_days = d.week2_self_days || [];
        delete d.week1_self_days;
        delete d.week2_self_days;
        upd.run(JSON.stringify(d), row.user_id);
      }
    } catch(e) { /* skip malformed row */ }
  }
} catch(e) { /* custody_pattern table may not exist yet */ }

// ── Schema ──────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('owner','partner')),
    access_token TEXT UNIQUE NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS calendar_days (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    date TEXT NOT NULL,
    owner TEXT NOT NULL CHECK(owner IN ('self','coparent')),
    tags TEXT NOT NULL DEFAULT '[]',
    UNIQUE(user_id, date),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS connections (
    id TEXT PRIMARY KEY,
    requester_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK(status IN ('pending','approved','rejected','expired')),
    duration_days INTEGER,
    approved_until TEXT,
    auto_renew INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (requester_id) REFERENCES users(id),
    FOREIGN KEY (target_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS invites (
    id TEXT PRIMARY KEY,
    created_by TEXT NOT NULL,
    used_by TEXT,
    expires_at TEXT,
    relationship_type TEXT NOT NULL DEFAULT 'coparent',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (created_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS custody_pattern (
    user_id TEXT PRIMARY KEY,
    pattern_type TEXT NOT NULL
      CHECK(pattern_type IN ('alternating_weeks','specific_days','custom')),
    pattern_data TEXT NOT NULL DEFAULT '{}',
    anchor_date TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS magic_links (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    user_id TEXT,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS suggestions (
    id TEXT PRIMARY KEY,
    from_user_id TEXT NOT NULL,
    to_user_id TEXT NOT NULL,
    changes TEXT NOT NULL DEFAULT '[]',
    note TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (from_user_id) REFERENCES users(id),
    FOREIGN KEY (to_user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS activities (
    id TEXT PRIMARY KEY,
    from_user_id TEXT NOT NULL,
    to_user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    link TEXT,
    dates TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK(status IN ('pending','accepted','declined','cancelled')),
    created_at TEXT DEFAULT (datetime('now')),
    responded_at TEXT,
    FOREIGN KEY (from_user_id) REFERENCES users(id),
    FOREIGN KEY (to_user_id) REFERENCES users(id)
  );
`);

// Ensure email index exists on the (possibly just-created) users table
try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email)'); } catch(e) { /* ignore */ }

// ── Prepared statements ───────────────────────────────────────────────────────

const q = {
  getUserByToken:      db.prepare('SELECT * FROM users WHERE access_token = ?'),
  getUserById:         db.prepare('SELECT * FROM users WHERE id = ?'),
  getUserByEmail:      db.prepare('SELECT * FROM users WHERE email = ?'),
  getUserByGoogleId:   db.prepare('SELECT * FROM users WHERE google_id = ?'),
  updateGoogleId:      db.prepare('UPDATE users SET google_id = ? WHERE id = ?'),
  // Legacy single-tenant helpers (kept for backward compat)
  getOwner:            db.prepare("SELECT * FROM users WHERE role = 'owner' LIMIT 1"),
  ownerExists:         db.prepare("SELECT 1 AS found FROM users WHERE role = 'owner' LIMIT 1"),
  createUser:          db.prepare('INSERT INTO users (id, name, role, access_token) VALUES (?, ?, ?, ?)'),
  createUserWithEmail: db.prepare('INSERT INTO users (id, name, role, access_token, email) VALUES (?, ?, ?, ?, ?)'),
  updateUserToken:     db.prepare('UPDATE users SET access_token = ? WHERE id = ?'),
  updateUserEmail:     db.prepare('UPDATE users SET email = ? WHERE id = ?'),
  updateUserMobile:      db.prepare('UPDATE users SET mobile = ? WHERE id = ?'),
  updateUserProfile:     db.prepare('UPDATE users SET name = ?, mobile = ? WHERE id = ?'),
  updateCoparentName:    db.prepare('UPDATE users SET coparent_name = ? WHERE id = ?'),

  getDaysForUser: db.prepare(
    'SELECT date, owner, tags FROM calendar_days WHERE user_id = ? ORDER BY date'
  ),
  getDaysForUserInRange: db.prepare(
    'SELECT date, owner, tags FROM calendar_days WHERE user_id = ? AND date >= ? AND date <= ? ORDER BY date'
  ),
  upsertDay: db.prepare(`
    INSERT INTO calendar_days (user_id, date, owner, tags)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, date) DO UPDATE SET owner = excluded.owner, tags = excluded.tags
  `),
  deleteDay: db.prepare('DELETE FROM calendar_days WHERE user_id = ? AND date = ?'),

  getPattern:    db.prepare('SELECT * FROM custody_pattern WHERE user_id = ?'),
  upsertPattern: db.prepare(`
    INSERT INTO custody_pattern (user_id, pattern_type, pattern_data, anchor_date)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      pattern_type = excluded.pattern_type,
      pattern_data = excluded.pattern_data,
      anchor_date  = excluded.anchor_date
  `),

  getInvite:         db.prepare('SELECT * FROM invites WHERE id = ?'),
  getInviteByUsedBy: db.prepare('SELECT * FROM invites WHERE used_by = ? LIMIT 1'),
  createInvite:      db.prepare('INSERT INTO invites (id, created_by, expires_at, relationship_type) VALUES (?, ?, ?, ?)'),
  claimInvite:       db.prepare('UPDATE invites SET used_by = ? WHERE id = ? AND used_by IS NULL'),

  // Magic links (email auth)
  createMagicLink: db.prepare(
    'INSERT INTO magic_links (id, email, user_id, expires_at) VALUES (?, ?, ?, ?)'
  ),
  getMagicLink: db.prepare(
    "SELECT * FROM magic_links WHERE id = ? AND used_at IS NULL AND expires_at > datetime('now')"
  ),
  useMagicLink: db.prepare(
    "UPDATE magic_links SET used_at = datetime('now') WHERE id = ?"
  ),

  getConnectionByRequester: db.prepare(
    'SELECT * FROM connections WHERE requester_id = ? ORDER BY created_at DESC LIMIT 1'
  ),
  getPendingConnections: db.prepare(`
    SELECT c.*, u.name as requester_name
    FROM connections c JOIN users u ON c.requester_id = u.id
    WHERE c.target_id = ? AND c.status = 'pending'
  `),
  getApprovedConnection: db.prepare(`
    SELECT * FROM connections
    WHERE requester_id = ? AND target_id = ? AND status = 'approved'
    LIMIT 1
  `),
  createConnection:  db.prepare('INSERT INTO connections (id, requester_id, target_id) VALUES (?, ?, ?)'),
  approveConnection: db.prepare(`
    UPDATE connections SET
      status         = 'approved',
      duration_days  = ?,
      approved_until = date('now', '+' || ? || ' days'),
      auto_renew     = ?
    WHERE id = ?
  `),
  rejectConnection:  db.prepare("UPDATE connections SET status = 'rejected' WHERE id = ?"),
  updateAutoRenew:   db.prepare('UPDATE connections SET auto_renew = ? WHERE id = ?'),
  getConnectionById: db.prepare('SELECT * FROM connections WHERE id = ?'),
  getAllConnectionsForOwner: db.prepare(`
    SELECT c.*, u.name as requester_name
    FROM connections c
    JOIN users u ON c.requester_id = u.id
    WHERE c.target_id = ?
    ORDER BY c.created_at DESC
  `),
  // Returns all connections for ANY user (both sides), with the other party's name and ID
  getAllConnectionsForUser: db.prepare(`
    SELECT c.*,
      CASE WHEN c.requester_id = ? THEN u_t.name ELSE u_r.name END as other_name,
      CASE WHEN c.requester_id = ? THEN c.target_id ELSE c.requester_id END as other_user_id,
      CASE WHEN c.target_id = ? THEN 1 ELSE 0 END as i_am_target
    FROM connections c
    JOIN users u_r ON c.requester_id = u_r.id
    JOIN users u_t ON c.target_id = u_t.id
    WHERE c.requester_id = ? OR c.target_id = ?
    ORDER BY c.created_at DESC
  `),
  updateConnectionRole:            db.prepare(`UPDATE connections SET relationship_type = ? WHERE id = ?`),
  updateDesiredDuration:           db.prepare(`UPDATE connections SET desired_duration_days = ? WHERE id = ?`),
  renewConnection:  db.prepare("UPDATE connections SET approved_until = ? WHERE id = ?"),
  expireConnection: db.prepare("UPDATE connections SET status = 'expired' WHERE id = ?"),

  // Single day lookup (used when preserving tags during suggestion apply)
  getDay: db.prepare('SELECT * FROM calendar_days WHERE user_id = ? AND date = ?'),

  // Suggestions (co-parent proposes schedule change, owner approves/rejects)
  createSuggestion: db.prepare(
    'INSERT INTO suggestions (id, from_user_id, to_user_id, changes, note) VALUES (?, ?, ?, ?, ?)'
  ),
  getSuggestionById: db.prepare('SELECT * FROM suggestions WHERE id = ?'),
  getPendingSuggestionsForOwner: db.prepare(`
    SELECT s.*, u.name as from_name
    FROM suggestions s JOIN users u ON s.from_user_id = u.id
    WHERE s.to_user_id = ? AND s.status = 'pending'
    ORDER BY s.created_at DESC
  `),
  updateSuggestionStatus: db.prepare("UPDATE suggestions SET status = ? WHERE id = ?"),

  // Activities
  createActivity: db.prepare(
    'INSERT INTO activities (id, from_user_id, to_user_id, title, link, dates) VALUES (?, ?, ?, ?, ?, ?)'
  ),
  getActivitiesForUser: db.prepare(`
    SELECT a.*,
      fu.name as from_name, tu.name as to_name
    FROM activities a
    JOIN users fu ON a.from_user_id = fu.id
    JOIN users tu ON a.to_user_id = tu.id
    WHERE (a.from_user_id = ? OR a.to_user_id = ?)
      AND a.status != 'cancelled'
    ORDER BY a.created_at DESC
  `),
  getActivityById: db.prepare('SELECT * FROM activities WHERE id = ?'),
  updateActivityStatus: db.prepare(
    "UPDATE activities SET status = ?, responded_at = datetime('now') WHERE id = ?"
  ),
  deleteActivity: db.prepare('DELETE FROM activities WHERE id = ?'),
};

// ── Pattern generator ─────────────────────────────────────────────────────────

function generateDaysFromPattern(pattern, startDate, endDate) {
  const days = [];
  const start = new Date(startDate);
  const end   = new Date(endDate);

  if (pattern.pattern_type === 'alternating_weeks') {
    const data   = JSON.parse(pattern.pattern_data);
    const anchor = new Date(pattern.anchor_date);
    const weekMs = 7 * 24 * 60 * 60 * 1000;

    // New format: week_a_days / week_b_days (per-day selection per alternating week)
    // Old compat: first_week = 'self'|'coparent' (whole-week toggle)
    const ALL_DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    // Canonical format: week_a_days / week_b_days
    // Onboarding legacy: week1_self_days / week2_self_days
    // Oldest compat: first_week = 'self'|'coparent'
    const weekADays = data.week_a_days || data.week1_self_days
      || (data.first_week === 'self' ? ALL_DAYS : []);
    const weekBDays = data.week_b_days || data.week2_self_days
      || (data.first_week === 'coparent' ? ALL_DAYS : []);

    const weekANums = weekADays.map(dayNameToNum);
    const weekBNums = weekBDays.map(dayNameToNum);

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const diffWeeks = Math.floor((d - anchor) / weekMs);
      const isWeekA   = ((diffWeeks % 2) + 2) % 2 === 0;
      const dayNums   = isWeekA ? weekANums : weekBNums;
      days.push({ date: toDateStr(d), owner: dayNums.includes(d.getDay()) ? 'self' : 'coparent' });
    }

  } else if (pattern.pattern_type === 'specific_days') {
    const data        = JSON.parse(pattern.pattern_data);
    const selfDayNums = (data.self_days || []).map(dayNameToNum);

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      days.push({
        date:  toDateStr(d),
        owner: selfDayNums.includes(d.getDay()) ? 'self' : 'coparent',
      });
    }
  }
  // 'custom' — days entered manually, no auto-generation

  return days;
}

function dayNameToNum(name) {
  return ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].indexOf(name);
}

function toDateStr(d) {
  return d.toISOString().slice(0, 10);
}

// ── Auto-renew check ──────────────────────────────────────────────────────────

function checkAndRenewConnection(conn) {
  if (conn.status !== 'approved') return conn;

  const today = new Date().toISOString().slice(0, 10);
  if (conn.approved_until && conn.approved_until < today) {
    if (conn.auto_renew) {
      const newUntil = new Date();
      newUntil.setDate(newUntil.getDate() + conn.duration_days);
      const newUntilStr = newUntil.toISOString().slice(0, 10);
      q.renewConnection.run(newUntilStr, conn.id);
      return { ...conn, approved_until: newUntilStr };
    } else {
      q.expireConnection.run(conn.id);
      return { ...conn, status: 'expired' };
    }
  }
  return conn;
}

// ── Bulk upsert with manual transaction ───────────────────────────────────────

function upsertManyDays(userId, days) {
  db.exec('BEGIN');
  try {
    for (const day of days) {
      q.upsertDay.run(userId, day.date, day.owner, JSON.stringify(day.tags || []));
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

module.exports = { db, q, generateDaysFromPattern, checkAndRenewConnection, upsertManyDays, toDateStr };
