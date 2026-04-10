const express = require('express');
const router  = express.Router();
const { db }  = require('../db');
const crypto  = require('crypto');

// Lazy-load Resend for email notifications
let _resend = null;
function getResend() {
  if (_resend) return _resend;
  try {
    const { Resend } = require('resend');
    if (process.env.RESEND_API_KEY) _resend = new Resend(process.env.RESEND_API_KEY);
  } catch(e) {}
  return _resend;
}

const CATEGORY_ICON = { food:'🍽', nightlife:'🍷', music:'🎵', arts:'🎭', entertainment:'🎬', coffee:'☕', drinks:'🍷', restaurants:'🍽', walks:'🌳', events:'🎫', sports:'⚽', outdoors:'🌳', wellness:'🧘', education:'📚', community:'👥' };

// POST /api/match/create  — Person A submits their schedule
// If partner_schedule is also provided (manual entry path), auto-complete the match
router.post('/match/create', (req, res) => {
  const { name, email, schedule, partner_schedule, utm_source, utm_medium, utm_campaign, utm_content, referrer, device } = req.body;
  if (!schedule) return res.status(400).json({ error: 'Schedule is required' });

  const token = crypto.randomUUID();
  const scheduleStr = typeof schedule === 'string' ? schedule : JSON.stringify(schedule);

  if (partner_schedule) {
    const partnerStr = typeof partner_schedule === 'string' ? partner_schedule : JSON.stringify(partner_schedule);
    db.prepare(`
      INSERT INTO match_requests (token, person_a_name, person_a_email, person_a_schedule,
        person_b_schedule, status, completed_at, utm_source, utm_medium, utm_campaign, utm_content, referrer, device)
      VALUES (?, ?, ?, ?, ?, 'completed', datetime('now'), ?, ?, ?, ?, ?, ?)
    `).run(token, name || null, email || null, scheduleStr, partnerStr,
           utm_source || null, utm_medium || null, utm_campaign || null, utm_content || null, referrer || null, device || null);
  } else {
    db.prepare(`
      INSERT INTO match_requests (token, person_a_name, person_a_email, person_a_schedule,
        utm_source, utm_medium, utm_campaign, utm_content, referrer, device)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(token, name || null, email || null, scheduleStr,
           utm_source || null, utm_medium || null, utm_campaign || null, utm_content || null, referrer || null, device || null);
  }

  res.json({ token, match_url: `/match/${token}` });
});

// ── GET /api/match/suggestions — context-aware opportunities per day ─────────
// Weekend days get events, walks, sports, restaurants; weekday evenings get
// coffee, drinks, restaurants — with a shuffle so each day feels different.
const WEEKEND_DAYS = new Set(['fri','sat','sun']);
const WEEKEND_CATS = new Set(['events','restaurants','walks','sports','entertainment','music','arts','outdoors']);
const WEEKDAY_CATS = new Set(['coffee','drinks','restaurants','nightlife','food','entertainment']);

router.get('/match/suggestions', (req, res) => {
  const daysParam = (req.query.days || '').toLowerCase();
  const days = daysParam.split(',').filter(Boolean);
  if (!days.length) return res.json({ suggestions: {} });

  const suggestions = {};

  try {
    const rows = db.prepare(`
      SELECT id, title, category, location_name, price_tier, contributor_note, confidence_score, outing_count, image_url
      FROM opportunities
      WHERE visibility = 'public'
        AND tags NOT LIKE '%kid%' AND tags NOT LIKE '%family%'
      ORDER BY confidence_score DESC, outing_count DESC
      LIMIT 50
    `).all();

    const weekendPool = rows.filter(r => WEEKEND_CATS.has(r.category) || !r.category);
    const weekdayPool = rows.filter(r => WEEKDAY_CATS.has(r.category) || !r.category);

    function shuffle(arr) {
      const a = [...arr];
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    }

    const usedIds = new Set();

    days.forEach(day => {
      const isWeekend = WEEKEND_DAYS.has(day);
      const primary = shuffle(isWeekend ? weekendPool : weekdayPool);
      const secondary = shuffle(isWeekend ? weekdayPool : weekendPool);
      const combined = [...primary, ...secondary];

      const picked = [];
      for (const r of combined) {
        if (usedIds.has(r.id)) continue;
        picked.push({
          id: r.id,
          title: r.title,
          category: r.category,
          vibe: [r.category, r.location_name?.split(',')[0]].filter(Boolean).join(' · ') || 'Evening out',
          contributor_note: r.contributor_note || null,
          icon: CATEGORY_ICON[r.category] || '✨',
          image_url: r.image_url || null,
        });
        usedIds.add(r.id);
        if (picked.length >= 1) break;
      }

      if (picked.length) suggestions[day] = picked;
    });
  } catch(e) {
    console.error('[match/suggestions]', e.message);
  }

  res.json({ suggestions });
});

// GET /api/match/suggestions/search?q= — public text search for match invite sheet
router.get('/match/suggestions/search', (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q || q.length < 2) return res.json({ results: [] });
  const like = `%${q}%`;
  try {
    const rows = db.prepare(`
      SELECT id, title, category, location_name, image_url
      FROM opportunities
      WHERE visibility = 'public'
        AND (title LIKE ? OR category LIKE ? OR location_name LIKE ?)
      ORDER BY confidence_score DESC
      LIMIT 6
    `).all(like, like, like);
    const results = rows.map(r => ({
      id: r.id,
      title: r.title,
      category: r.category,
      vibe: [r.category, r.location_name?.split(',')[0]].filter(Boolean).join(' · ') || '',
      icon: CATEGORY_ICON[r.category] || '✨',
      image_url: r.image_url || null,
    }));
    res.json({ results });
  } catch(e) {
    res.json({ results: [] });
  }
});

// GET /api/match/:token  — status + person A name (safe to expose)
router.get('/match/:token', (req, res) => {
  const row = db.prepare('SELECT * FROM match_requests WHERE token = ?').get(req.params.token);
  if (!row) return res.status(404).json({ error: 'Match not found' });

  const resp = {
    status:         row.status,
    person_a_name:  row.person_a_name,
  };

  // Only expose schedules once both parties have submitted
  if (row.status === 'completed') {
    resp.person_a_schedule = row.person_a_schedule;
    resp.person_b_schedule = row.person_b_schedule;
    resp.person_b_name     = row.person_b_name;
    // don't expose emails ever
  }

  res.json(resp);
});

// POST /api/match/:token/complete  — Person B submits their schedule
router.post('/match/:token/complete', async (req, res) => {
  const { name, email, schedule } = req.body;
  const { token } = req.params;

  const row = db.prepare('SELECT * FROM match_requests WHERE token = ?').get(token);
  if (!row)                    return res.status(404).json({ error: 'Match not found' });
  if (row.status === 'completed') return res.status(409).json({ error: 'Already completed' });

  const scheduleStr = typeof schedule === 'string' ? schedule : JSON.stringify(schedule);

  db.prepare(`
    UPDATE match_requests
    SET person_b_name     = ?,
        person_b_email    = ?,
        person_b_schedule = ?,
        status            = 'completed',
        completed_at      = datetime('now')
    WHERE token = ?
  `).run(name || null, email || null, scheduleStr, token);

  // Notify Person A via email
  if (row.person_a_email) {
    const client = getResend();
    const FROM_EMAIL = process.env.FROM_EMAIL || 'onboarding@resend.dev';
    const BASE_URL = req.app?.locals?.BASE_URL || process.env.BASE_URL || '';
    const bName = name || 'Your match';
    const matchUrl = `${BASE_URL}/match/${token}`;
    if (client) {
      try {
        await client.emails.send({
          from: FROM_EMAIL,
          to: row.person_a_email,
          subject: `${bName} filled in their schedule!`,
          html: `
            <div style="font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#202124;">
              <img src="${BASE_URL}/logo.svg" width="48" height="48" alt="Spontany" style="border-radius:12px;display:block;margin:0 0 10px;">
              <h1 style="font-size:22px;font-weight:800;margin:0 0 4px;color:#0a0a0a;">Spontany</h1>
              <p style="margin:0 0 24px;font-size:18px;font-weight:700;">${bName} just completed the match!</p>
              <p style="margin:0 0 20px;">Their schedule is in. Tap below to see your overlap and find out when you're both free.</p>
              <a href="${matchUrl}" style="display:inline-block;background:#1a73e8;color:white;padding:13px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;">See your result →</a>
            </div>
          `
        });
      } catch(e) { console.error('Match notification error:', e?.message || e); }
    }
  }

  res.json({ status: 'completed' });
});

// ── POST /api/match/invite — create a date invite (no auth required) ────────
router.post('/match/invite', (req, res) => {
  const { sender_name, sender_email, recipient_name, opportunity_id,
          opportunity_title, opportunity_vibe, date_label, message, match_token } = req.body;
  if (!sender_name) return res.status(400).json({ error: 'sender_name required' });

  const id = crypto.randomUUID();
  const token = crypto.randomUUID();

  db.prepare(`
    INSERT INTO match_invites (id, token, match_token, sender_name, sender_email, recipient_name,
      opportunity_id, opportunity_title, opportunity_vibe, date_label, message)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, token, match_token || null, sender_name, sender_email || null,
    recipient_name || null, opportunity_id || null,
    (opportunity_title || '').slice(0, 200), (opportunity_vibe || '').slice(0, 200),
    date_label || null, (message || '').slice(0, 200));

  res.json({ invite_token: token, invite_url: `/date/${token}` });
});

// ── GET /api/match/invite/:token — fetch invite data (public) ───────────────
router.get('/match/invite/:token', (req, res) => {
  const row = db.prepare('SELECT * FROM match_invites WHERE token = ?').get(req.params.token);
  if (!row) return res.status(404).json({ error: 'Invite not found' });
  res.json({
    sender_name: row.sender_name,
    recipient_name: row.recipient_name,
    opportunity_title: row.opportunity_title,
    opportunity_vibe: row.opportunity_vibe,
    date_label: row.date_label,
    message: row.message,
    response: row.response,
    responded_at: row.responded_at,
  });
});

// ── POST /api/match/invite/:token/respond — recipient responds (public) ─────
router.post('/match/invite/:token/respond', async (req, res) => {
  const { response, message } = req.body;
  if (!response || !['in', 'not_this_time'].includes(response)) {
    return res.status(400).json({ error: 'response must be "in" or "not_this_time"' });
  }

  const row = db.prepare('SELECT * FROM match_invites WHERE token = ?').get(req.params.token);
  if (!row) return res.status(404).json({ error: 'Invite not found' });

  db.prepare(`
    UPDATE match_invites SET response = ?, response_message = ?, responded_at = datetime('now')
    WHERE token = ?
  `).run(response, (message || '').slice(0, 200) || null, req.params.token);

  // Notify sender via email if they provided one
  if (row.sender_email) {
    const client = getResend();
    const FROM_EMAIL = process.env.FROM_EMAIL || 'onboarding@resend.dev';
    const recipientLabel = row.recipient_name || 'Your date';
    const BASE_URL = req.app?.locals?.BASE_URL || process.env.BASE_URL || '';
    if (client) {
      try {
        const isIn = response === 'in';
        await client.emails.send({
          from: FROM_EMAIL,
          to: row.sender_email,
          subject: isIn ? `${recipientLabel} is in! 🎉` : `${recipientLabel} responded to your invite`,
          html: `
            <div style="font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#202124;">
              <img src="${BASE_URL}/logo.svg" width="48" height="48" alt="Spontany" style="border-radius:12px;display:block;margin:0 0 10px;">
              <h1 style="font-size:22px;font-weight:800;margin:0 0 4px;color:#0a0a0a;">Spontany</h1>
              <p style="margin:0 0 24px;font-size:18px;font-weight:700;">
                ${isIn ? `${recipientLabel} is in! 🎉` : `${recipientLabel} can't make this one.`}
              </p>
              ${row.opportunity_title ? `<p style="margin:0 0 8px;"><strong>${row.opportunity_title}</strong>${row.date_label ? ' · ' + row.date_label : ''}</p>` : ''}
              ${message ? `<p style="color:#5f6368;font-style:italic;">"${message}"</p>` : ''}
              <p style="color:#5f6368;font-size:13px;margin-top:24px;">
                ${isIn ? 'Time to plan the details!' : 'No worries - there\'s always next time.'}
              </p>
            </div>
          `
        });
      } catch(e) { console.error('Match invite notification error:', e?.message || e); }
    }
  }

  res.json({ ok: true, sender_name: row.sender_name });
});

module.exports = router;
