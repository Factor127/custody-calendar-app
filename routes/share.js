'use strict';

// Share flow for the "serious" teaser-share LP.
// Thin entrypoint: she gives her name + his phone → match_request is created
// with a token → she fills her schedule at /share/:token/me → he fills his
// at /share/:token → report page serves overlap + venue proposals.

const express  = require('express');
const path     = require('path');
const crypto   = require('crypto');
const router   = express.Router();
const { db }   = require('../db');
const { sendSMS, toE164, isValidE164 } = require('../utils/sms');

// ── Helpers ───────────────────────────────────────────────────────────────
function getMatch(token) {
  return db.prepare('SELECT * FROM match_requests WHERE token = ?').get(token);
}

function isOptedOut(phone) {
  return !!db.prepare('SELECT 1 FROM sms_opt_outs WHERE phone = ?').get(phone);
}

function baseUrl(req) {
  return process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
}

// Compute overlap between two date sets (arrays of YYYY-MM-DD).
function computeOverlap(a, b) {
  const set = new Set(a);
  return (b || []).filter(d => set.has(d)).sort();
}

// Map a YYYY-MM-DD date string → weekday key (mon, tue, etc.) for opportunity lookup.
function dayKey(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return ['sun','mon','tue','wed','thu','fri','sat'][d.getDay()];
}

// ── POST /api/share/create ────────────────────────────────────────────────
// Body: { person_a_name, person_b_phone, mode: 'text'|'copy', variant,
//         session_id, utm_* }
router.post('/api/share/create', async (req, res) => {
  const b = req.body || {};
  const name  = (b.person_a_name || '').trim().slice(0, 60);
  const phone = toE164(b.person_b_phone);
  const mode  = b.mode === 'copy' ? 'copy' : 'text';

  if (!name)  return res.status(400).json({ error: 'name_required' });
  if (!phone) return res.status(400).json({ error: 'invalid_phone' });

  const token = crypto.randomUUID();

  db.prepare(`
    INSERT INTO match_requests
      (token, person_a_name, person_b_phone, status,
       utm_source, utm_campaign, utm_content)
    VALUES (?, ?, ?, 'pending', ?, ?, ?)
  `).run(
    token, name, phone,
    b.utm_source || null,
    b.utm_campaign || null,
    b.utm_content || null,
  );

  // If 'text' mode, fire SMS to B with the share link. 'copy' mode: caller
  // will surface the link in the LP UI for the user to share manually.
  const shareUrl = `${baseUrl(req)}/share/${token}`;
  if (mode === 'text' && !isOptedOut(phone)) {
    const body = `${name} wants to see when you two are both free. Tap to pick your kid-free nights (no signup): ${shareUrl}  Reply STOP to opt out.`;
    // Fire-and-forget; the record is already saved, SMS failure shouldn't block.
    sendSMS(phone, body, { event: 'share_invite', token }).catch(() => {});
  }

  res.json({ ok: true, token, share_url: shareUrl, mode });
});

// ── POST /api/share/:token/submit-a ───────────────────────────────────────
// Body: { schedule: [YYYY-MM-DD,...], phone?: string (for result notify) }
router.post('/api/share/:token/submit-a', (req, res) => {
  const m = getMatch(req.params.token);
  if (!m) return res.status(404).json({ error: 'not_found' });

  const schedule = Array.isArray(req.body.schedule) ? req.body.schedule : [];
  const phone    = req.body.phone ? toE164(req.body.phone) : null;

  db.prepare(`
    UPDATE match_requests SET person_a_schedule = ?, person_a_phone = COALESCE(?, person_a_phone)
    WHERE token = ?
  `).run(JSON.stringify(schedule), phone, req.params.token);

  // If B already submitted, this completes the match → SMS A.
  const after = getMatch(req.params.token);
  if (after.person_a_schedule && after.person_b_schedule && after.status !== 'completed') {
    db.prepare("UPDATE match_requests SET status = 'completed', completed_at = datetime('now') WHERE token = ?").run(req.params.token);
    notifyAOnComplete(after, req);
  }

  res.json({ ok: true });
});

// ── POST /api/share/:token/submit-b ───────────────────────────────────────
// Body: { name?, schedule: [YYYY-MM-DD,...] }
router.post('/api/share/:token/submit-b', (req, res) => {
  const m = getMatch(req.params.token);
  if (!m) return res.status(404).json({ error: 'not_found' });

  const schedule = Array.isArray(req.body.schedule) ? req.body.schedule : [];
  const bName    = (req.body.name || '').trim().slice(0, 60) || null;

  db.prepare(`
    UPDATE match_requests SET person_b_schedule = ?, person_b_name = COALESCE(?, person_b_name)
    WHERE token = ?
  `).run(JSON.stringify(schedule), bName, req.params.token);

  // If A already submitted, this completes → SMS A.
  const after = getMatch(req.params.token);
  if (after.person_a_schedule && after.person_b_schedule && after.status !== 'completed') {
    db.prepare("UPDATE match_requests SET status = 'completed', completed_at = datetime('now') WHERE token = ?").run(req.params.token);
    notifyAOnComplete(after, req);
  }

  res.json({ ok: true });
});

function notifyAOnComplete(match, req) {
  if (!match.person_a_phone || isOptedOut(match.person_a_phone)) return;
  const url = `${baseUrl(req)}/share/${match.token}/report`;
  const bName = match.person_b_name ? match.person_b_name : 'They';
  const body = `Spontany: ${bName} just filled in their schedule. See when you're both free → ${url}  Reply STOP to opt out.`;
  sendSMS(match.person_a_phone, body, { event: 'share_result', token: match.token }).catch(() => {});
}

// ── GET /api/share/:token/status ──────────────────────────────────────────
// Public-safe: returns which parties have filled + overlap if completed.
// Never exposes phones / emails.
router.get('/api/share/:token/status', (req, res) => {
  const m = getMatch(req.params.token);
  if (!m) return res.status(404).json({ error: 'not_found' });

  const aSchedule = m.person_a_schedule ? JSON.parse(m.person_a_schedule) : null;
  const bSchedule = m.person_b_schedule ? JSON.parse(m.person_b_schedule) : null;
  const complete  = !!(aSchedule && bSchedule);
  const overlap   = complete ? computeOverlap(aSchedule, bSchedule) : null;

  res.json({
    ok: true,
    token: m.token,
    person_a_name: m.person_a_name,
    person_b_name: m.person_b_name,
    a_done: !!aSchedule,
    b_done: !!bSchedule,
    complete,
    overlap,
  });
});

// ── GET /api/share/:token/report ──────────────────────────────────────────
// Returns overlap + venue proposals. Only callable once both sides submitted.
router.get('/api/share/:token/report', (req, res) => {
  const m = getMatch(req.params.token);
  if (!m) return res.status(404).json({ error: 'not_found' });

  const aSchedule = m.person_a_schedule ? JSON.parse(m.person_a_schedule) : [];
  const bSchedule = m.person_b_schedule ? JSON.parse(m.person_b_schedule) : [];
  const overlap   = computeOverlap(aSchedule, bSchedule);

  // Venue pool: pull from existing Opportunities. Bias toward weekday/weekend
  // based on the overlap days of week. Take up to 6 with images.
  const dayTags = [...new Set(overlap.map(dayKey))];
  let opps = [];
  try {
    // Prefer opportunities with images, but don't require them — fall back to
    // category-emoji thumbnails client-side when image_url is missing.
    opps = db.prepare(`
      SELECT id, title, category, tags, location_name, price_tier, image_url, source_url,
             CASE WHEN image_url IS NOT NULL AND image_url != '' THEN 1 ELSE 0 END AS has_img
      FROM opportunities
      ORDER BY has_img DESC, confidence_score DESC, RANDOM()
      LIMIT 18
    `).all();
  } catch(e) { console.error('[share] opp query:', e.message); }

  // Prioritize any opportunity whose tags mention an overlap weekday
  function score(o) {
    const t = (o.tags || '').toLowerCase();
    let s = 0;
    dayTags.forEach(d => { if (t.includes(d)) s += 2; });
    return s;
  }
  const venues = opps
    .map(o => ({ ...o, _score: score(o) }))
    .sort((a,b) => b._score - a._score)
    .slice(0, 6);

  res.json({
    ok: true,
    person_a_name: m.person_a_name,
    person_b_name: m.person_b_name,
    overlap,
    venues,
  });
});

// ── Page routes — serve the share-flow HTML pages ────────────────────────
router.get('/share/:token/me', (req, res, next) => {
  if (!getMatch(req.params.token)) return next();
  res.sendFile(path.join(__dirname, '..', 'public', 'share', 'input-a.html'));
});

router.get('/share/:token/report', (req, res, next) => {
  if (!getMatch(req.params.token)) return next();
  res.sendFile(path.join(__dirname, '..', 'public', 'share', 'report.html'));
});

router.get('/share/:token', (req, res, next) => {
  if (!getMatch(req.params.token)) return next();
  res.sendFile(path.join(__dirname, '..', 'public', 'share', 'input-b.html'));
});

module.exports = router;
