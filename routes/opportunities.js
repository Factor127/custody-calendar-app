'use strict';
const express  = require('express');
const router   = express.Router();
const db       = require('../db');
const { submitUrl, ingestTicketmaster, ingestGooglePlaces, createOpportunity } = require('../services/opportunityIngestion');
const { matchForUser } = require('../services/opportunityMatcher');

// ── Auth helper (local copy — requireToken not exported from api.js) ──────
function requireToken(req, res) {
  const token = req.query.token || req.body?.token;
  if (!token) { res.status(401).json({ error: 'Missing token' }); return null; }
  const user = db.getUserByToken(token);
  if (!user)  { res.status(401).json({ error: 'Invalid token' }); return null; }
  return user;
}

// ── GET /api/opportunities/search?q= — text search internal DB ───────────
router.get('/opportunities/search', (req, res) => {
  const user = requireToken(req, res); if (!user) return;
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ results: [] });
  const rows = db.textSearchOpportunities(q);
  res.json({ results: rows.map(o => ({ ...o, tags: JSON.parse(o.tags || '[]') })) });
});

// ── GET /api/places/autocomplete?q= — Google Places proxy ────────────────
router.get('/places/autocomplete', async (req, res) => {
  const user = requireToken(req, res); if (!user) return;
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ predictions: [] });
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return res.json({ predictions: [], error: 'no_key' });
  try {
    const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(q)}&types=establishment&key=${key}`;
    const r   = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return res.json({ predictions: [] });
    const data = await r.json();
    const predictions = (data.predictions || []).slice(0, 5).map(p => ({
      place_id:    p.place_id,
      name:        p.structured_formatting?.main_text || p.description,
      address:     p.structured_formatting?.secondary_text || '',
      description: p.description,
      types:       p.types || []
    }));
    res.json({ predictions });
  } catch(e) {
    res.json({ predictions: [] });
  }
});

// ── GET /api/opportunities/matches — personalized matches ─────────────────
router.get('/opportunities/matches', async (req, res) => {
  const user = requireToken(req, res); if (!user) return;
  const { category, type, limit = 20 } = req.query;
  try {
    const matches = await matchForUser(user.id, { category, type, limit: parseInt(limit) });
    res.json({ matches });
  } catch(e) {
    console.error('[opportunities/matches]', e);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/opportunities — browse all public opportunities ──────────────
router.get('/opportunities', (req, res) => {
  const user = requireToken(req, res); if (!user) return;
  const { category, type } = req.query;
  try {
    const rows = db.searchOpportunities({ category: category || null, type: type || null });
    const opps = rows.map(o => ({ ...o, tags: JSON.parse(o.tags || '[]') }));
    res.json({ opportunities: opps });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/opportunities/direct — save a venue/event directly (no URL fetch) ──
// Used when a user picks a Google Places result or types a plain venue name
router.post('/opportunities/direct', (req, res) => {
  const user = requireToken(req, res); if (!user) return;
  const { title, type, category, location_name, location_lat, location_lng,
          price_tier, tags, start_time, end_time, source_url, place_id, confidence_score } = req.body;
  if (!title) return res.status(400).json({ error: 'title required' });

  // Check for duplicate by place_id (Google Place) or by title+location
  if (place_id) {
    const existing = db.db.prepare(
      "SELECT id FROM opportunities WHERE source_url LIKE ? OR location_name = ?"
    ).get(`%${place_id}%`, location_name || '');
    if (existing) return res.json({ id: existing.id, ok: true, duplicate: true });
  }

  const { randomUUID } = require('crypto');
  const id = randomUUID();
  createOpportunity(
    id,
    title.slice(0, 200),
    type || 'venue',
    category || null,
    JSON.stringify(tags || []),
    start_time || null,
    end_time   || null,
    location_name  || null,
    location_lat   || null,
    location_lng   || null,
    price_tier     || null,
    'manual',                  // source_type
    null,                      // source_domain
    source_url     || null,    // source_url
    confidence_score ?? 0.70,  // confidence_score
    'public',                  // visibility
    user.id                    // created_by
  );
  res.json({ id, ok: true });
});

// ── POST /api/opportunities/submit — submit a URL ─────────────────────────
router.post('/opportunities/submit', async (req, res) => {
  const user = requireToken(req, res); if (!user) return;
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url required' });
  try {
    const result = await submitUrl(url, user.id);
    res.json(result);
  } catch(e) {
    res.status(422).json({ error: e.message });
  }
});

// ── GET /api/opportunities/:id — fetch single opportunity ────────────────
router.get('/opportunities/:id', (req, res) => {
  const user = requireToken(req, res); if (!user) return;
  const opp  = db.getOpportunityById(req.params.id);
  if (!opp) return res.status(404).json({ error: 'not found' });
  res.json({ ...opp, tags: JSON.parse(opp.tags || '[]') });
});

// ── PUT /api/opportunities/:id — edit an opportunity ──────────────────────
router.put('/opportunities/:id', (req, res) => {
  const user = requireToken(req, res); if (!user) return;
  const { id } = req.params;
  const opp = db.getOpportunityById(id);
  if (!opp) return res.status(404).json({ error: 'not found' });
  // Only creator or admin can edit
  if (opp.created_by && opp.created_by !== user.id) return res.status(403).json({ error: 'forbidden' });
  const { title, type, category, tags, start_time, end_time, location_name,
          location_lat, location_lng, price_tier, confidence_score, visibility } = req.body;
  db.updateOpportunity(
    title || opp.title,
    type  || opp.type,
    category || opp.category,
    JSON.stringify(tags || JSON.parse(opp.tags || '[]')),
    start_time !== undefined ? start_time : opp.start_time,
    end_time   !== undefined ? end_time   : opp.end_time,
    location_name || opp.location_name,
    location_lat  ?? opp.location_lat,
    location_lng  ?? opp.location_lng,
    price_tier || opp.price_tier,
    confidence_score ?? opp.confidence_score,
    visibility || opp.visibility,
    id
  );
  res.json({ ok: true });
});

// ── GET /api/opportunities/submissions — user's submissions ───────────────
router.get('/opportunities/submissions', (req, res) => {
  const user = requireToken(req, res); if (!user) return;
  const subs = db.getSubmissionsByUser(user.id);
  res.json({ submissions: subs.map(s => ({ ...s, parsed_data: s.parsed_data ? JSON.parse(s.parsed_data) : null })) });
});

// ── POST /api/opportunities/sync — trigger API sync (admin) ──────────────
router.post('/opportunities/sync', async (req, res) => {
  const user = requireToken(req, res); if (!user) return;
  const { source = 'ticketmaster', city, query } = req.body;
  try {
    let result;
    if (source === 'ticketmaster') result = await ingestTicketmaster({ city });
    else if (source === 'places')  result = await ingestGooglePlaces({ query });
    else return res.status(400).json({ error: 'unknown source' });
    res.json(result);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── DELETE /api/opportunities/:id — remove an opportunity ────────────────
router.delete('/opportunities/:id', (req, res) => {
  const user = requireToken(req, res); if (!user) return;
  const result = db.deleteOpportunity(req.params.id, user.id);
  if (result.changes === 0) return res.status(404).json({ error: 'not found or not yours' });
  res.json({ ok: true });
});

// ── POST /api/plans — save a plan for a date ──────────────────────────────
router.post('/plans', (req, res) => {
  const user = requireToken(req, res); if (!user) return;
  const { date, opportunity_id, note } = req.body;
  if (!date) return res.status(400).json({ error: 'date required' });
  const { randomUUID } = require('crypto');
  const id = randomUUID();
  db.createPlan(id, user.id, date, opportunity_id || null, note || null);
  // ── Contribution tracking ─────────────────────────────────────────────
  if (opportunity_id) {
    db.trackOppEvent(opportunity_id, user.id, 'plan_created');
    db.incOppCounter('incOppPlans', opportunity_id);
  }
  res.json({ ok: true, plan_id: id });
});

// ── DELETE /api/plans/:id — remove a plan ────────────────────────────────
router.delete('/plans/:id', (req, res) => {
  const user = requireToken(req, res); if (!user) return;
  db.deletePlan(req.params.id, user.id);
  res.json({ ok: true });
});

// ── GET /api/plans — plans for a date range ───────────────────────────────
router.get('/plans', (req, res) => {
  const user = requireToken(req, res); if (!user) return;
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from and to required' });
  const plans = db.getPlansForUser(user.id, from, to);
  res.json({ plans });
});

// ── GET /api/plans/dates — date → count map (for calendar dots) ───────────
router.get('/plans/dates', (req, res) => {
  const user = requireToken(req, res); if (!user) return;
  const rows = db.getPlansDateCounts(user.id);
  const map = {};
  for (const r of rows) map[r.date] = r.count;
  res.json({ dates: map });
});

module.exports = router;
