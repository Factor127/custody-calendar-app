'use strict';
const { randomUUID } = require('crypto');
const db = require('../db');
const { unfurlUrl } = require('./unfurl');

// ── Category mapping from activity chips to opportunity categories ─────────
const CHIP_TO_CAT = {
  coffee:      ['food','cafe'],
  drinks:      ['nightlife','food'],
  restaurants: ['food'],
  walks:       ['outdoors'],
  events:      ['music','arts','entertainment'],
  sports:      ['sports','outdoors'],
  notsure:     []
};

// ── Guess type from signals ───────────────────────────────────────────────
function guessType(url, title, desc, hasSpecificTime, jsonLdType) {
  // 1. JSON-LD @type - most reliable signal. May be a string or an array
  // (e.g. museumofillusions returns ["LocalBusiness","Organization"]).
  if (jsonLdType) {
    const t = (Array.isArray(jsonLdType) ? jsonLdType.join(' ') : String(jsonLdType)).toLowerCase();
    if (/restaurant|food|cafe|coffee|bar|pub|nightclub|lodging|localbusiness|museum|park|attraction|place/.test(t)) return 'venue';
    if (/event|concert|festival|musicev|socialev/.test(t)) return 'event';
  }

  // 2. Has a specific start_time → event
  if (hasSpecificTime) return 'event';

  let domain = '', path = '/';
  try { const u = new URL(url); domain = u.hostname.replace(/^www\./, ''); path = u.pathname; } catch(e) {}

  // 3. Known event platform domains → always event
  if (/vibez\.io|selector\.org|eventbrite\.|ra\.co$|dice\.fm|ticketmaster\.|bandsintown\.|songkick\.|fever\.plus|lu\.ma|universe\.com|resident-advisor\./.test(domain)) return 'event';

  // 4. URL path contains event patterns (e.g. /events/123, /tickets/, /e/abc)
  if (/\/events?\/|\/tickets?\/|\/shows?\/|\/gigs?\/|\/concerts?\//.test(path)) return 'event';

  // 5. Content keyword signals - title + desc only (not URL, to avoid false matches on domain names)
  const text = `${title} ${desc}`.toLowerCase();
  if (/restaurant|cafe|coffee|bistro|\bbar\b|\bpub\b|nightclub|lounge|rooftop|eatery|diner/.test(text)) return 'venue';
  if (/festival|concert|\bgig\b|\bshow\b|party|happening|exhibition|class|workshop|\blive\b|tickets?/.test(text)) return 'event';

  // 6. Homepage URL (path is just "/" or empty) with no event signals → it's a place/venue
  if (!path || path === '/' || path.replace(/\//g,'').length < 3) return 'venue';

  // 7. Default → event (a URL with a real path that has no venue signals is most likely an event listing)
  return 'event';
}

// ── Price tier helper ─────────────────────────────────────────────────────
// Returns 'free' | 'low' | 'medium' | 'high' | null. null means UNKNOWN —
// distinct from 'free'. This matters because we don't want events with
// unscrapable prices (e.g. selector.org.il hides them behind JS) to be
// tagged as free; that would skew price filtering and discovery.
//
// 'free' is reserved for explicit zero (numeric 0 or string "0").
function priceTier(priceVal) {
  if (priceVal == null || priceVal === '') return null;          // unknown
  if (priceVal === 0 || priceVal === '0') return 'free';         // explicit zero
  const n = parseFloat(String(priceVal).replace(/[^0-9.]/g, ''));
  if (isNaN(n)) return null;                                     // unparseable → unknown
  if (n === 0)  return 'free';
  if (n < 15)   return 'low';
  if (n < 50)   return 'medium';
  return 'high';
}

// ── Main: fetch URL and return parsed opportunity draft ────────────────────
//
// Stage 3 migration: this used to do its own HTML extraction inline. Now it
// delegates to services/unfurl.js (the shared parser also used by /api/unfurl
// and the sandbox) and just maps the rich result into the opportunity draft
// shape that the DB expects.
//
// What we still do here that unfurl.js doesn't:
//   - Deterministic guessType (URL pattern + venue/event keywords)
//   - guessCategory (music/food/sports/arts/etc.)
//   - priceTier bucketing (free/low/medium/high)
//
// Why no separate Claude enrichment call: unfurl's `allowAiFallback: true`
// already invokes Haiku for sparse SPA pages to fill missing title/date/time/
// venue. Adding a second call here would be redundant and double-charge.
async function fetchAndParse(url) {
  let r;
  try {
    r = await unfurlUrl(url, { timeoutMs: 10000, allowAiFallback: true });
  } catch (e) {
    throw new Error(`Could not fetch URL: ${e.message}`);
  }

  const title = (r.title || 'Untitled').slice(0, 200);
  const desc  = r.description || '';

  // Confidence score based on which extraction tier gave us the data
  const confidenceByTier = { 'json-ld': 0.85, 'next-data': 0.75, 'meta-only': 0.45 };
  const confidence_score = confidenceByTier[r.extraction_source] ?? 0.5;

  // Pick the best price source for tier bucketing. price_range[0] is the min
  // (when chase succeeded); otherwise raw price string from JSON-LD/NEXT.
  const priceForTier = (r.price_range && r.price_range.length) ? r.price_range[0] : r.price;

  return {
    title,
    type:          guessType(url, title, desc, !!r.start_iso, r.json_ld_type),
    category:      guessCategory(title, desc),
    tags:          [],
    start_time:    r.start_iso || null,
    end_time:      r.end_iso   || null,
    // Prefer combined "name, address" when both available so the DB row is
    // self-contained; fall back to whichever side we got.
    location_name: [r.location_name, r.location_address].filter(Boolean).join(', ') || null,
    location_lat:  null,
    location_lng:  null,
    price_tier:    priceTier(priceForTier),
    image_url:     r.image || null,
    source_type:   'user_submitted',
    source_domain: r.domain,
    source_url:    r.url,
    confidence_score,
  };
}

// ── Guess category from text ──────────────────────────────────────────────
function guessCategory(title, desc) {
  const text = `${title} ${desc}`.toLowerCase();
  if (/music|gig|concert|band|dj|festival|live/.test(text)) return 'music';
  if (/comedy|stand.?up|improv/.test(text))                  return 'arts';
  if (/food|restaurant|dinner|brunch|cafe|coffee/.test(text))return 'food';
  if (/sport|football|tennis|yoga|gym|run|cycle/.test(text)) return 'sports';
  if (/walk|hike|park|garden|outdoor/.test(text))            return 'outdoors';
  if (/art|gallery|exhibit|museum|theatre|theater/.test(text))return 'arts';
  if (/club|bar|drinks|nightlife|pub/.test(text))            return 'nightlife';
  return 'entertainment';
}

// ── Deduplication ─────────────────────────────────────────────────────────
function findDuplicate(draft) {
  if (draft.source_url) {
    const byUrl = db.findDuplicateByUrl(draft.source_url);
    if (byUrl) return byUrl.id;
  }
  if (draft.title && draft.start_time) {
    const byTitleDate = db.findDuplicateByTitleDate(`%${draft.title.slice(0,40)}%`, draft.start_time);
    if (byTitleDate) return byTitleDate.id;
  }
  return null;
}

// ── Create opportunity from draft ─────────────────────────────────────────
function createOpportunity(draft, createdBy = null) {
  const id = randomUUID();
  db.createOpportunity(
    id, draft.title, draft.type, draft.category,
    JSON.stringify(draft.tags || []),
    draft.start_time || null, draft.end_time || null,
    draft.location_name || null, draft.location_lat || null, draft.location_lng || null,
    draft.price_tier || null,
    draft.source_type || 'manual',
    draft.source_domain || null,
    draft.source_url || null,
    draft.confidence_score || 0.5,
    draft.visibility || 'public',
    createdBy
  );
  // Save image_url if extracted
  if (draft.image_url) {
    try { db.db.prepare('UPDATE opportunities SET image_url = ? WHERE id = ?').run(draft.image_url, id); } catch(e) {}
  }
  return id;
}

// ── Full submission pipeline ──────────────────────────────────────────────
async function submitUrl(url, userId) {
  const subId = randomUUID();

  // Parse
  let draft;
  try {
    draft = await fetchAndParse(url);
  } catch(e) {
    db.createSubmission(subId, null, userId, url, null, 'rejected');
    throw e;
  }

  // Deduplicate
  const dupId = findDuplicate(draft);
  if (dupId) {
    db.createSubmission(subId, dupId, userId, url, JSON.stringify(draft), 'duplicate');
    return { submission_id: subId, opportunity_id: dupId, duplicate: true, draft };
  }

  // Create opportunity
  const oppId = createOpportunity(draft, userId);
  db.createSubmission(subId, oppId, userId, url, JSON.stringify(draft), 'accepted');

  return { submission_id: subId, opportunity_id: oppId, duplicate: false, draft };
}

// ── Ticketmaster ingestion ────────────────────────────────────────────────
async function ingestTicketmaster({ city = 'London', countryCode = 'GB', size = 20 } = {}) {
  const key = process.env.TICKETMASTER_API_KEY;
  if (!key) return { ingested: 0, error: 'No TICKETMASTER_API_KEY' };

  const url = `https://app.ticketmaster.com/discovery/v2/events.json?city=${encodeURIComponent(city)}&countryCode=${countryCode}&size=${size}&apikey=${key}&sort=date,asc`;

  let events;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return { ingested: 0, error: `TM HTTP ${res.status}` };
    const data = await res.json();
    events = data._embedded?.events || [];
  } catch(e) {
    return { ingested: 0, error: e.message };
  }

  let ingested = 0;
  for (const ev of events) {
    const sourceUrl = ev.url || null;
    if (sourceUrl && db.findDuplicateByUrl(sourceUrl)) continue;

    const venue = ev._embedded?.venues?.[0];
    const seg   = ev.classifications?.[0]?.segment?.name?.toLowerCase() || 'entertainment';
    const genre = ev.classifications?.[0]?.genre?.name?.toLowerCase() || '';

    const category = seg.includes('music') ? 'music'
      : seg.includes('sport') ? 'sports'
      : seg.includes('art')   ? 'arts'
      : seg.includes('film')  ? 'entertainment'
      : seg.includes('family')? 'community'
      : 'entertainment';

    const tags = [seg, genre].filter(Boolean).filter(t => t !== 'undefined');

    const priceMin = ev.priceRanges?.[0]?.min;
    const draft = {
      title:          ev.name,
      type:           'event',
      category,
      tags,
      start_time:     ev.dates?.start?.dateTime || ev.dates?.start?.localDate || null,
      end_time:       null,
      location_name:  venue ? `${venue.name}, ${venue.city?.name || ''}`.trim() : null,
      location_lat:   parseFloat(venue?.location?.latitude)  || null,
      location_lng:   parseFloat(venue?.location?.longitude) || null,
      price_tier:     priceTier(priceMin),
      source_type:    'api',
      source_domain:  'ticketmaster.com',
      source_url:     sourceUrl,
      confidence_score: 0.90,
      visibility:     'public'
    };

    createOpportunity(draft);
    ingested++;
  }
  return { ingested };
}

// ── Google Places ingestion ───────────────────────────────────────────────
async function ingestGooglePlaces({ query = 'bars restaurants London', limit = 20 } = {}) {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return { ingested: 0, error: 'No GOOGLE_PLACES_API_KEY' };

  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${key}`;

  let results;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return { ingested: 0, error: `Places HTTP ${res.status}` };
    const data = await res.json();
    results = (data.results || []).slice(0, limit);
  } catch(e) {
    return { ingested: 0, error: e.message };
  }

  let ingested = 0;
  for (const place of results) {
    // Dedup by name+lat/lng approximate
    const existing = db.findDuplicateByTitleDate(`%${place.name.slice(0,30)}%`, null);
    if (existing) continue;

    const types  = place.types || [];
    const category = types.includes('bar') || types.includes('night_club') ? 'nightlife'
      : types.includes('restaurant') || types.includes('cafe') || types.includes('food') ? 'food'
      : types.includes('museum') || types.includes('art_gallery') ? 'arts'
      : types.includes('park') || types.includes('natural_feature') ? 'outdoors'
      : 'entertainment';

    const priceLevel = place.price_level; // 0-4
    const price_tier = priceLevel === 0 ? 'free'
      : priceLevel <= 1 ? 'low'
      : priceLevel <= 2 ? 'medium'
      : 'high';

    const draft = {
      title:          place.name,
      type:           'venue',
      category,
      tags:           types.slice(0, 5),
      start_time:     null,
      end_time:       null,
      location_name:  place.formatted_address || place.vicinity || null,
      location_lat:   place.geometry?.location?.lat || null,
      location_lng:   place.geometry?.location?.lng || null,
      price_tier:     price_tier || 'low',
      source_type:    'api',
      source_domain:  'google.com/maps',
      source_url:     null,
      confidence_score: 0.85,
      visibility:     'public'
    };

    createOpportunity(draft);
    ingested++;
  }
  return { ingested };
}

module.exports = { fetchAndParse, submitUrl, createOpportunity, findDuplicate, ingestTicketmaster, ingestGooglePlaces, CHIP_TO_CAT };
