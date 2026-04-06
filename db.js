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
try { db.exec('ALTER TABLE users ADD COLUMN work_schedule TEXT'); } catch(e) { /* already exists */ }
try { db.exec('ALTER TABLE users ADD COLUMN age INTEGER'); } catch(e) { /* already exists */ }
try { db.exec('ALTER TABLE users ADD COLUMN relationship_status TEXT'); } catch(e) { /* already exists */ }
try { db.exec('ALTER TABLE users ADD COLUMN photo TEXT'); } catch(e) { /* already exists */ }
try { db.exec('ALTER TABLE users ADD COLUMN google_access_token TEXT'); } catch(e) { /* already exists */ }
try { db.exec('ALTER TABLE users ADD COLUMN google_refresh_token TEXT'); } catch(e) { /* already exists */ }
try { db.exec('ALTER TABLE users ADD COLUMN google_token_expiry TEXT'); } catch(e) { /* already exists */ }
try { db.exec('ALTER TABLE users ADD COLUMN city TEXT'); } catch(e) { /* already exists */ }
try { db.exec('ALTER TABLE users ADD COLUMN city_place_id TEXT'); } catch(e) { /* already exists */ }

// ── Email sequence tracking ────────────────────────────────────────────────────
try { db.exec('ALTER TABLE users ADD COLUMN email_seq_step INTEGER DEFAULT 0'); } catch(e) {}
try { db.exec('ALTER TABLE users ADD COLUMN email_seq_started TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE users ADD COLUMN email_seq_last_sent TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE users ADD COLUMN email_seq_opened TEXT DEFAULT \'[]\''); } catch(e) {}
try { db.exec('ALTER TABLE users ADD COLUMN email_seq_2b_sent INTEGER DEFAULT 0'); } catch(e) {}
try { db.exec('ALTER TABLE users ADD COLUMN unsubscribed INTEGER DEFAULT 0'); } catch(e) {}
try { db.exec('ALTER TABLE outings ADD COLUMN venue_place_id TEXT'); } catch(e) { /* already exists */ }
try { db.exec('ALTER TABLE outings ADD COLUMN venue_address TEXT'); } catch(e) { /* already exists */ }
try { db.exec('ALTER TABLE outings ADD COLUMN opportunity_id TEXT'); } catch(e) { /* already exists */ }
try { db.exec('ALTER TABLE outings ADD COLUMN image_url TEXT'); } catch(e) { /* already exists */ }
try { db.exec('ALTER TABLE outing_invitees ADD COLUMN rsvp_token TEXT'); } catch(e) { /* already exists */ }
try { db.exec('ALTER TABLE outing_invitees ADD COLUMN decline_note TEXT'); } catch(e) { /* already exists */ }
try { db.exec('ALTER TABLE outings ADD COLUMN title TEXT'); } catch(e) { /* already exists */ }

// ── Push subscriptions ────────────────────────────────────────────────────────
db.exec(`CREATE TABLE IF NOT EXISTS push_subscriptions (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  endpoint     TEXT NOT NULL UNIQUE,
  p256dh       TEXT NOT NULL,
  auth         TEXT NOT NULL,
  created_at   TEXT DEFAULT (datetime('now'))
)`);
// ── Gamification / contribution tracking ──────────────────────────────────────
try { db.exec('ALTER TABLE opportunities ADD COLUMN view_count INTEGER DEFAULT 0'); } catch(e) {}
try { db.exec('ALTER TABLE opportunities ADD COLUMN save_count INTEGER DEFAULT 0'); } catch(e) {}
try { db.exec('ALTER TABLE opportunities ADD COLUMN plan_count INTEGER DEFAULT 0'); } catch(e) {}
try { db.exec('ALTER TABLE opportunities ADD COLUMN outing_count INTEGER DEFAULT 0'); } catch(e) {}
// ── Community contributions ─────────────────────────────────────────────────
try { db.exec('ALTER TABLE opportunities ADD COLUMN contributor_note TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE opportunities ADD COLUMN shared_to_community INTEGER DEFAULT 0'); } catch(e) {}
try {
  db.exec(`CREATE TABLE IF NOT EXISTS opportunity_events (
    id             TEXT PRIMARY KEY,
    opportunity_id TEXT NOT NULL,
    actor_user_id  TEXT,
    event_type     TEXT NOT NULL,
    created_at     TEXT DEFAULT (datetime('now'))
  )`);
} catch(e) {}
try { db.exec("ALTER TABLE invites ADD COLUMN relationship_type TEXT NOT NULL DEFAULT 'coparent'"); } catch(e) { /* already exists */ }
try { db.exec("ALTER TABLE connections ADD COLUMN relationship_type TEXT NOT NULL DEFAULT 'coparent'"); } catch(e) { /* already exists */ }
try { db.exec("ALTER TABLE connections ADD COLUMN desired_duration_days INTEGER"); } catch(e) { /* already exists */ }
try { db.exec('ALTER TABLE connections ADD COLUMN requester_share_until TEXT'); } catch(e) { /* already exists */ }
try { db.exec('ALTER TABLE connections ADD COLUMN target_share_until TEXT'); } catch(e) { /* already exists */ }
try { db.exec('ALTER TABLE connections ADD COLUMN requester_duration_days INTEGER'); } catch(e) { /* already exists */ }
// Backfill connections.relationship_type from the invite that was used to join.
// Only runs on connections still at the default 'coparent' value — never overwrites
// a relationship_type that was manually set (e.g. changed via the badge toggle).
try {
  db.exec(`
    UPDATE connections SET relationship_type = (
      SELECT COALESCE(i.relationship_type, 'coparent')
      FROM invites i
      WHERE i.used_by = connections.requester_id
        AND i.created_by = connections.target_id
      LIMIT 1
    ) WHERE relationship_type = 'coparent'
      AND EXISTS (
        SELECT 1 FROM invites i
        WHERE i.used_by = connections.requester_id
          AND i.created_by = connections.target_id
          AND i.relationship_type != 'coparent'
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

db.exec(`CREATE TABLE IF NOT EXISTS outings (
  id TEXT PRIMARY KEY,
  created_by TEXT NOT NULL,
  date TEXT NOT NULL,
  message TEXT,
  status TEXT DEFAULT 'pending',
  venue TEXT,
  event_time TEXT,
  created_at TEXT DEFAULT (datetime('now'))
)`);

db.exec(`CREATE TABLE IF NOT EXISTS outing_invitees (
  id TEXT PRIMARY KEY,
  outing_id TEXT NOT NULL,
  user_id TEXT,
  name TEXT NOT NULL,
  phone TEXT,
  status TEXT DEFAULT 'pending'
)`);

// Ensure email index exists on the (possibly just-created) users table
try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email)'); } catch(e) { /* ignore */ }

db.exec(`CREATE TABLE IF NOT EXISTS connection_preferences (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL,
  connection_id  TEXT NOT NULL,
  activity_types TEXT NOT NULL DEFAULT '[]',
  confidence     INTEGER DEFAULT 0,
  skipped_at     TEXT,
  last_updated   TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, connection_id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (connection_id) REFERENCES connections(id)
)`);

db.exec(`CREATE TABLE IF NOT EXISTS opportunities (
  id             TEXT PRIMARY KEY,
  title          TEXT NOT NULL,
  type           TEXT NOT NULL CHECK(type IN ('event','venue','activity_template')),
  category       TEXT,
  tags           TEXT NOT NULL DEFAULT '[]',
  start_time     TEXT,
  end_time       TEXT,
  location_name  TEXT,
  location_lat   REAL,
  location_lng   REAL,
  price_tier     TEXT CHECK(price_tier IN ('free','low','medium','high')),
  source_type    TEXT NOT NULL CHECK(source_type IN ('api','user_submitted','manual')),
  source_domain  TEXT,
  source_url     TEXT,
  confidence_score REAL NOT NULL DEFAULT 0.5,
  visibility     TEXT NOT NULL DEFAULT 'public' CHECK(visibility IN ('private','group','public')),
  created_by     TEXT,
  created_at     TEXT DEFAULT (datetime('now'))
)`);

db.exec(`CREATE TABLE IF NOT EXISTS opportunity_submissions (
  id             TEXT PRIMARY KEY,
  opportunity_id TEXT,
  submitted_by   TEXT NOT NULL,
  raw_url        TEXT,
  raw_html       TEXT,
  parsed_data    TEXT,
  status         TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','parsed','accepted','rejected','duplicate')),
  duplicate_of   TEXT,
  created_at     TEXT DEFAULT (datetime('now'))
)`);

db.exec(`CREATE TABLE IF NOT EXISTS plans (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL,
  date           TEXT NOT NULL,
  opportunity_id TEXT,
  note           TEXT,
  created_at     TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
)`);

db.exec(`CREATE TABLE IF NOT EXISTS outing_messages (
  id TEXT PRIMARY KEY,
  outing_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  message TEXT NOT NULL,
  is_private INTEGER DEFAULT 0,
  message_type TEXT DEFAULT 'chat',
  suggestion_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
)`);

db.exec(`CREATE TABLE IF NOT EXISTS outing_suggestions (
  id TEXT PRIMARY KEY,
  outing_id TEXT NOT NULL,
  suggester_id TEXT NOT NULL,
  suggested_time TEXT,
  suggested_place TEXT,
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now'))
)`);

// ── Match requests ────────────────────────────────────────────────────────────
db.exec(`CREATE TABLE IF NOT EXISTS match_requests (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  token           TEXT UNIQUE NOT NULL,
  person_a_name   TEXT,
  person_a_email  TEXT,
  person_a_schedule TEXT,
  person_b_name   TEXT,
  person_b_email  TEXT,
  person_b_schedule TEXT,
  status          TEXT DEFAULT 'pending',
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at    DATETIME
)`);

db.exec(`CREATE TABLE IF NOT EXISTS match_invites (
  id              TEXT PRIMARY KEY,
  token           TEXT UNIQUE NOT NULL,
  match_token     TEXT,
  sender_name     TEXT NOT NULL,
  sender_email    TEXT,
  recipient_name  TEXT,
  opportunity_id  TEXT,
  opportunity_title TEXT,
  opportunity_vibe TEXT,
  date_label      TEXT,
  message         TEXT,
  response        TEXT,
  response_message TEXT,
  responded_at    TEXT,
  created_at      TEXT DEFAULT (datetime('now'))
)`);

// ── Prepared statements ───────────────────────────────────────────────────────

const q = {
  getUserByToken:      db.prepare('SELECT * FROM users WHERE access_token = ?'),
  getUserById:         db.prepare('SELECT * FROM users WHERE id = ?'),
  getUserByEmail:      db.prepare('SELECT * FROM users WHERE email = ?'),
  getUserByGoogleId:   db.prepare('SELECT * FROM users WHERE google_id = ?'),
  getUserByPhone:      db.prepare("SELECT id, name, photo, mobile FROM users WHERE REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(mobile,' ',''),'-',''),'(',''),')',''),'.','') = ?"),
  updateGoogleId:      db.prepare('UPDATE users SET google_id = ? WHERE id = ?'),
  updateGoogleTokens:  db.prepare('UPDATE users SET google_access_token = ?, google_refresh_token = ?, google_token_expiry = ? WHERE id = ?'),
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
  getAllApprovedConnections: db.prepare(`
    SELECT c.id,
           c.requester_id, u1.name AS req_name, u1.email AS req_email, u1.work_schedule AS req_ws, u1.access_token AS req_token,
           c.target_id,   u2.name AS tgt_name, u2.email AS tgt_email, u2.work_schedule AS tgt_ws, u2.access_token AS tgt_token
    FROM connections c
    JOIN users u1 ON u1.id = c.requester_id
    JOIN users u2 ON u2.id = c.target_id
    WHERE c.status = 'approved'
  `),
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
  createConnection:       db.prepare('INSERT INTO connections (id, requester_id, target_id) VALUES (?, ?, ?)'),
  createFriendConnection: db.prepare("INSERT INTO connections (id, requester_id, target_id, relationship_type) VALUES (?, ?, ?, 'friend')"),
  getConnectionBetween:   db.prepare(`
    SELECT * FROM connections
    WHERE (requester_id = ? AND target_id = ?) OR (requester_id = ? AND target_id = ?)
    ORDER BY created_at DESC LIMIT 1
  `),
  approveConnection: db.prepare(`
    UPDATE connections SET
      status             = 'approved',
      duration_days      = ?,
      approved_until     = date('now', '+' || ? || ' days'),
      target_share_until = date('now', '+' || ? || ' days'),
      auto_renew         = ?
    WHERE id = ?
  `),
  rejectConnection:  db.prepare("UPDATE connections SET status = 'rejected' WHERE id = ?"),
  deleteConnection:  db.prepare('DELETE FROM connections WHERE id = ?'),
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
      CASE WHEN c.requester_id = ? THEN u_t.name  ELSE u_r.name  END as other_name,
      CASE WHEN c.requester_id = ? THEN u_t.photo ELSE u_r.photo END as other_photo,
      CASE WHEN c.requester_id = ? THEN c.target_id ELSE c.requester_id END as other_user_id,
      CASE WHEN c.target_id = ? THEN 1 ELSE 0 END as i_am_target,
      u_r.mobile AS requester_mobile,
      u_t.mobile AS target_mobile
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
  setRequesterShare: db.prepare('UPDATE connections SET requester_share_until = ?, requester_duration_days = ? WHERE id = ?'),
  setTargetShare:    db.prepare('UPDATE connections SET target_share_until = ?, duration_days = ?, approved_until = ? WHERE id = ?'),

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

  createOuting:          db.prepare('INSERT INTO outings (id, created_by, date, message, venue, venue_address, venue_place_id, opportunity_id, image_url, status, event_time, title) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'),
  getOutingsForUser:     db.prepare('SELECT * FROM outings WHERE created_by = ? ORDER BY date ASC'),
  getOutingById:         db.prepare('SELECT * FROM outings WHERE id = ?'),
  updateOutingDetails:   db.prepare('UPDATE outings SET venue = ?, event_time = ?, status = ?, venue_place_id = ?, venue_address = ? WHERE id = ?'),
  createOutingInvitee:   db.prepare('INSERT INTO outing_invitees (id, outing_id, user_id, name, phone, rsvp_token) VALUES (?, ?, ?, ?, ?, ?)'),
  getInviteeByRsvpToken: db.prepare(`
    SELECT oi.*, o.date, o.message, o.venue, o.event_time, o.venue_address,
           o.opportunity_id, u.name AS inviter_name,
           opp.title AS opp_title, opp.location_name AS opp_location,
           opp.source_url AS opp_url, opp.start_time AS opp_start_time
    FROM outing_invitees oi
    JOIN outings o ON o.id = oi.outing_id
    JOIN users u ON u.id = o.created_by
    LEFT JOIN opportunities opp ON opp.id = o.opportunity_id
    WHERE oi.rsvp_token = ?
  `),
  updateInviteeStatus:   db.prepare('UPDATE outing_invitees SET status = ? WHERE id = ?'),
  getOutingInvitees:     db.prepare('SELECT * FROM outing_invitees WHERE outing_id = ?'),

  // Push subscriptions
  upsertPushSub:         db.prepare(`INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth)
                           VALUES (?, ?, ?, ?, ?)
                           ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id, p256dh=excluded.p256dh, auth=excluded.auth`),
  deletePushSub:         db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?'),
  getPushSubsForUser:    db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?'),
  getOutingsAsInvitee:   db.prepare(`
    SELECT o.*, oi.id AS invitee_record_id, oi.status AS my_invitee_status
    FROM outings o
    JOIN outing_invitees oi ON oi.outing_id = o.id
    WHERE oi.user_id = ?
    ORDER BY o.date ASC
  `),
  deleteOutingInvitees:  db.prepare('DELETE FROM outing_invitees WHERE outing_id = ?'),
  deleteOuting:          db.prepare('DELETE FROM outings WHERE id = ?'),

  // ── Connection preferences ──────────────────────────────────────────────
  upsertConnectionPrefs: db.prepare(`
    INSERT INTO connection_preferences (id, user_id, connection_id, activity_types, confidence, skipped_at, last_updated)
    VALUES (?, ?, ?, ?, 1, NULL, datetime('now'))
    ON CONFLICT(user_id, connection_id) DO UPDATE SET
      activity_types = excluded.activity_types,
      confidence     = 1,
      skipped_at     = NULL,
      last_updated   = datetime('now')
  `),
  skipConnectionPrefs: db.prepare(`
    INSERT INTO connection_preferences (id, user_id, connection_id, activity_types, confidence, skipped_at, last_updated)
    VALUES (?, ?, ?, '[]', 0, datetime('now'), datetime('now'))
    ON CONFLICT(user_id, connection_id) DO UPDATE SET
      skipped_at   = datetime('now'),
      last_updated = datetime('now')
  `),
  getConnectionPrefs:     db.prepare('SELECT * FROM connection_preferences WHERE user_id = ? AND connection_id = ?'),
  getAllPrefsForUser:      db.prepare('SELECT * FROM connection_preferences WHERE user_id = ?'),

  // Opportunities
  createOpportunity: db.prepare(`
    INSERT INTO opportunities
      (id,title,type,category,tags,start_time,end_time,
       location_name,location_lat,location_lng,
       price_tier,source_type,source_domain,source_url,
       confidence_score,visibility,created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `),
  updateOpportunity: db.prepare(`
    UPDATE opportunities SET
      title=?,type=?,category=?,tags=?,start_time=?,end_time=?,
      location_name=?,location_lat=?,location_lng=?,
      price_tier=?,confidence_score=?,visibility=?
    WHERE id=?
  `),
  shareOpportunity: db.prepare(`
    UPDATE opportunities SET visibility='public', shared_to_community=1, contributor_note=?
    WHERE id=?
  `),
  unshareOpportunity: db.prepare(`
    UPDATE opportunities SET visibility='private', shared_to_community=0
    WHERE id=?
  `),
  getOpportunityById: db.prepare('SELECT * FROM opportunities WHERE id=?'),
  searchOpportunities: db.prepare(`
    SELECT * FROM opportunities
    WHERE visibility='public'
      AND (:category IS NULL OR category=:category)
      AND (:type IS NULL OR type=:type)
    ORDER BY start_time ASC, created_at DESC
    LIMIT 50
  `),
  getOpportunitiesForMatching: db.prepare(`
    SELECT * FROM opportunities WHERE visibility='public'
    AND (start_time IS NULL OR start_time >= :from_date)
    ORDER BY start_time ASC
    LIMIT 200
  `),
  textSearchOpportunities: db.prepare(`
    SELECT * FROM opportunities
    WHERE visibility='public'
      AND (title LIKE ? OR location_name LIKE ? OR category LIKE ?)
    ORDER BY confidence_score DESC, created_at DESC
    LIMIT 8
  `),
  findDuplicateByUrl: db.prepare('SELECT id FROM opportunities WHERE source_url=? LIMIT 1'),
  findDuplicateByTitleDate: db.prepare(`
    SELECT id FROM opportunities
    WHERE title LIKE ? AND DATE(start_time)=DATE(?) LIMIT 1
  `),
  createSubmission: db.prepare(`
    INSERT INTO opportunity_submissions
      (id,opportunity_id,submitted_by,raw_url,parsed_data,status)
    VALUES (?,?,?,?,?,?)
  `),
  updateSubmission: db.prepare(`
    UPDATE opportunity_submissions
    SET opportunity_id=?,status=?,duplicate_of=? WHERE id=?
  `),
  getSubmissionsByUser: db.prepare(`
    SELECT s.*, o.title AS opp_title
    FROM opportunity_submissions s
    LEFT JOIN opportunities o ON o.id=s.opportunity_id
    WHERE s.submitted_by=?
    ORDER BY s.created_at DESC
  `),
  getUserActivityPrefs: db.prepare(`
    SELECT activity_types FROM connection_preferences
    WHERE user_id=? AND confidence>0
  `),

  // Plans
  createPlan: db.prepare(`
    INSERT INTO plans (id, user_id, date, opportunity_id, note)
    VALUES (?, ?, ?, ?, ?)
  `),
  deletePlan: db.prepare('DELETE FROM plans WHERE id=? AND user_id=?'),
  deleteOpportunity: db.prepare('DELETE FROM opportunities WHERE id=? AND (created_by=? OR created_by IS NULL)'),
  getPlansForUser: db.prepare(`
    SELECT p.*, o.title AS opp_title, o.type AS opp_type, o.source_url AS opp_url,
           o.location_name AS opp_location, o.price_tier AS opp_price_tier
    FROM plans p
    LEFT JOIN opportunities o ON o.id = p.opportunity_id
    WHERE p.user_id=? AND p.date >= ? AND p.date <= ?
    ORDER BY p.date ASC
  `),
  getPlansForUserAllDates: db.prepare(`
    SELECT p.date, COUNT(*) as count FROM plans p WHERE p.user_id=? GROUP BY p.date
  `),

  // ── Contribution / gamification ─────────────────────────────────────────
  trackOppEvent:   db.prepare('INSERT INTO opportunity_events (id, opportunity_id, actor_user_id, event_type) VALUES (?, ?, ?, ?)'),
  incOppViews:     db.prepare('UPDATE opportunities SET view_count   = view_count   + 1 WHERE id = ?'),
  incOppSaves:     db.prepare('UPDATE opportunities SET save_count   = save_count   + 1 WHERE id = ?'),
  incOppPlans:     db.prepare('UPDATE opportunities SET plan_count   = plan_count   + 1 WHERE id = ?'),
  incOppOutings:   db.prepare('UPDATE opportunities SET outing_count = outing_count + 1 WHERE id = ?'),
  getMyContributions: db.prepare(`
    SELECT id, title, type, category, source_url, created_at,
           view_count, save_count, plan_count, outing_count, visibility
    FROM opportunities
    WHERE created_by = ?
    ORDER BY (plan_count + outing_count) DESC, created_at DESC
  `),
  getRecentWins: db.prepare(`
    SELECT oe.event_type, oe.created_at, o.title, o.category, o.id AS opp_id
    FROM opportunity_events oe
    JOIN opportunities o ON o.id = oe.opportunity_id
    WHERE o.created_by = ?
      AND oe.actor_user_id IS NOT NULL AND oe.actor_user_id != ?
      AND oe.event_type IN ('plan_created','outing_created','rsvp_accepted')
    ORDER BY oe.created_at DESC
    LIMIT 15
  `),
  getReputationStats: db.prepare(`
    SELECT category,
           SUM(plan_count)   AS total_plans,
           SUM(outing_count) AS total_outings,
           COUNT(id)         AS opp_count
    FROM opportunities
    WHERE created_by = ?
    GROUP BY category
    ORDER BY (SUM(plan_count) + SUM(outing_count)) DESC
  `),
  getNewWinsCount: db.prepare(`
    SELECT COUNT(*) AS count
    FROM opportunity_events oe
    JOIN opportunities o ON o.id = oe.opportunity_id
    WHERE o.created_by = ?
      AND oe.actor_user_id IS NOT NULL AND oe.actor_user_id != ?
      AND oe.event_type IN ('plan_created','outing_created')
      AND oe.created_at > ?
  `),

  // ── Outing detail + chat + suggestions ─────────────────────────────────
  getOutingWithInvitees: db.prepare(`
    SELECT o.*,
      u.name AS creator_name, u.photo AS creator_photo
    FROM outings o
    JOIN users u ON u.id = o.created_by
    WHERE o.id = ?
  `),
  getOutingInviteesWithUsers: db.prepare(`
    SELECT oi.*, u.name AS user_name, u.photo AS user_photo
    FROM outing_invitees oi
    LEFT JOIN users u ON u.id = oi.user_id
    WHERE oi.outing_id = ?
  `),
  getOutingMessages: db.prepare(`
    SELECT om.*, u.name AS sender_name, u.photo AS sender_photo
    FROM outing_messages om
    JOIN users u ON u.id = om.sender_id
    WHERE om.outing_id = ?
    ORDER BY om.created_at ASC
  `),
  createOutingMessage: db.prepare(`
    INSERT INTO outing_messages (id, outing_id, sender_id, message, is_private, message_type, suggestion_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `),
  createOutingSuggestion: db.prepare(`
    INSERT INTO outing_suggestions (id, outing_id, suggester_id, suggested_time, suggested_place)
    VALUES (?, ?, ?, ?, ?)
  `),
  getOutingSuggestion: db.prepare('SELECT * FROM outing_suggestions WHERE id = ?'),
  acceptOutingSuggestion: db.prepare("UPDATE outing_suggestions SET status = 'accepted' WHERE id = ?"),
  updateOutingRsvp: db.prepare('UPDATE outing_invitees SET status = ?, decline_note = ? WHERE id = ?'),
  updateOutingFull: db.prepare(`
    UPDATE outings SET title = ?, venue = ?, event_time = ?, venue_address = ?
    WHERE id = ? AND created_by = ?
  `),
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
  // Use target_share_until if set (Phase 2), else fall back to approved_until
  const effectiveUntil = conn.target_share_until || conn.approved_until;
  if (effectiveUntil && effectiveUntil < today) {
    if (conn.auto_renew) {
      const newUntil = new Date();
      newUntil.setDate(newUntil.getDate() + conn.duration_days);
      const newUntilStr = newUntil.toISOString().slice(0, 10);
      q.renewConnection.run(newUntilStr, conn.id);
      db.prepare('UPDATE connections SET target_share_until = ? WHERE id = ?').run(newUntilStr, conn.id);
      return { ...conn, approved_until: newUntilStr, target_share_until: newUntilStr };
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

// ── Opportunity convenience wrappers (used by services/) ─────────────────────

function createOpportunity(id, title, type, category, tags, start_time, end_time,
    location_name, location_lat, location_lng, price_tier, source_type,
    source_domain, source_url, confidence_score, visibility, created_by) {
  return q.createOpportunity.run(id, title, type, category, tags, start_time, end_time,
    location_name, location_lat, location_lng, price_tier, source_type,
    source_domain, source_url, confidence_score, visibility, created_by);
}

function updateOpportunity(title, type, category, tags, start_time, end_time,
    location_name, location_lat, location_lng, price_tier, confidence_score, visibility, id) {
  return q.updateOpportunity.run(title, type, category, tags, start_time, end_time,
    location_name, location_lat, location_lng, price_tier, confidence_score, visibility, id);
}

function getOpportunityById(id) {
  return q.getOpportunityById.get(id);
}

function shareOpportunity(id, note) {
  return q.shareOpportunity.run(note || null, id);
}

function unshareOpportunity(id) {
  return q.unshareOpportunity.run(id);
}

function searchOpportunities({ category, type } = {}) {
  return q.searchOpportunities.all({ category: category || null, type: type || null });
}

function textSearchOpportunities(q_text) {
  const like = `%${q_text}%`;
  return q.textSearchOpportunities.all(like, like, like);
}

function getOpportunitiesForMatching({ from_date } = {}) {
  return q.getOpportunitiesForMatching.all({ from_date: from_date || new Date().toISOString().slice(0,10) });
}

function findDuplicateByUrl(url) {
  return q.findDuplicateByUrl.get(url);
}

function findDuplicateByTitleDate(titleLike, date) {
  return q.findDuplicateByTitleDate.get(titleLike, date);
}

function createSubmission(id, opportunity_id, submitted_by, raw_url, parsed_data, status) {
  return q.createSubmission.run(id, opportunity_id, submitted_by, raw_url, parsed_data, status);
}

function updateSubmission(opportunity_id, status, duplicate_of, id) {
  return q.updateSubmission.run(opportunity_id, status, duplicate_of, id);
}

function getSubmissionsByUser(userId) {
  return q.getSubmissionsByUser.all(userId);
}

function getUserActivityPrefs(userId) {
  return q.getUserActivityPrefs.all(userId);
}

function createPlan(id, userId, date, opportunityId, note) {
  return q.createPlan.run(id, userId, date, opportunityId || null, note || null);
}

function deletePlan(id, userId) {
  return q.deletePlan.run(id, userId);
}

function deleteOpportunity(id, userId) {
  return q.deleteOpportunity.run(id, userId);
}

function getPlansForUser(userId, from, to) {
  return q.getPlansForUser.all(userId, from, to);
}

function getPlansDateCounts(userId) {
  return q.getPlansForUserAllDates.all(userId);
}

// ── Contribution event helpers ────────────────────────────────────────────────
const { randomUUID: _uuid } = require('crypto');

function trackOppEvent(opportunityId, actorUserId, eventType) {
  try { q.trackOppEvent.run(_uuid(), opportunityId, actorUserId || null, eventType); } catch(e) {}
}
function incOppCounter(field, opportunityId) {
  try { q[field].run(opportunityId); } catch(e) {}
}
function getMyContributions(userId) {
  return q.getMyContributions.all(userId);
}
function getRecentWins(userId) {
  return q.getRecentWins.all(userId, userId);
}
function getReputationStats(userId) {
  return q.getReputationStats.all(userId);
}
function getNewWinsCount(userId, since) {
  return (q.getNewWinsCount.get(userId, userId, since) || {}).count || 0;
}

// Normalise a phone number to digits + leading + only (for matching)
function normalizePhone(raw) {
  if (!raw) return null;
  const s = raw.trim();
  // Keep leading + if present, strip everything else that isn't a digit
  const prefix = s.startsWith('+') ? '+' : '';
  return prefix + s.replace(/\D/g, '');
}

module.exports = {
  db, q,
  normalizePhone,
  generateDaysFromPattern, checkAndRenewConnection, upsertManyDays, toDateStr,
  // Opportunity helpers
  createOpportunity, updateOpportunity, getOpportunityById, shareOpportunity, unshareOpportunity,
  searchOpportunities, textSearchOpportunities, getOpportunitiesForMatching,
  findDuplicateByUrl, findDuplicateByTitleDate,
  createSubmission, updateSubmission, getSubmissionsByUser,
  getUserActivityPrefs,
  // Plan helpers
  createPlan, deletePlan, getPlansForUser, getPlansDateCounts,
  deleteOpportunity,
  // Contribution / gamification helpers
  trackOppEvent, incOppCounter,
  getMyContributions, getRecentWins, getReputationStats, getNewWinsCount,
  // Re-export core user/calendar helpers for convenience in services
  getDaysForUserInRange: (userId, from, to) => q.getDaysForUserInRange.all(userId, from, to),
  getUserByToken: (token) => q.getUserByToken.get(token),
};
