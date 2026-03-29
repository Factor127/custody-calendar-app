'use strict';
const { randomUUID } = require('crypto');
const db = require('../db');

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
  // 1. JSON-LD @type — most reliable signal
  if (jsonLdType) {
    const t = jsonLdType.toLowerCase();
    if (/restaurant|food|cafe|coffee|bar|pub|nightclub|lodging|localbusiness/.test(t)) return 'venue';
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

  // 5. Content keyword signals — title + desc only (not URL, to avoid false matches on domain names)
  const text = `${title} ${desc}`.toLowerCase();
  if (/restaurant|cafe|coffee|bistro|\bbar\b|\bpub\b|nightclub|lounge|rooftop|eatery|diner/.test(text)) return 'venue';
  if (/festival|concert|\bgig\b|\bshow\b|party|happening|exhibition|class|workshop|\blive\b|tickets?/.test(text)) return 'event';

  // 6. Homepage URL (path is just "/" or empty) with no event signals → it's a place/venue
  if (!path || path === '/' || path.replace(/\//g,'').length < 3) return 'venue';

  // 7. Default → event (a URL with a real path that has no venue signals is most likely an event listing)
  return 'event';
}

// ── Metadata extraction from HTML ─────────────────────────────────────────
function extractMetadata(html, url) {
  const get = (pattern) => { const m = html.match(pattern); return m ? m[1] : null; };

  // JSON-LD — handle both Event and Venue/Business types
  let jsonLd = null;
  let jsonLdType = null;
  const ldMatch = html.match(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i);
  if (ldMatch) {
    try {
      const parsed = JSON.parse(ldMatch[1]);
      const ev = Array.isArray(parsed) ? parsed[0] : parsed;
      jsonLdType = ev['@type'] || null;
      const isEvent   = /Event/.test(jsonLdType || '');
      const isVenue   = /Restaurant|FoodEstablishment|CafeOrCoffeeShop|BarOrPub|NightClub|LocalBusiness|LodgingBusiness|Store/.test(jsonLdType || '');
      if (isEvent || isVenue) {
        jsonLd = {
          title:        ev.name,
          start_time:   ev.startDate || null,
          end_time:     ev.endDate   || null,
          location_name: isVenue
            ? (ev.address?.streetAddress || ev.address?.addressLocality || null)
            : (ev.location?.name || ev.location?.address?.streetAddress || null),
          description:  ev.description || null,
          price:        ev.offers?.price || null,
          currency:     ev.offers?.priceCurrency || 'ILS'
        };
      }
    } catch(e) {}
  }

  const ogTitle    = get(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i)
                  || get(/<meta[^>]+content="([^"]+)"[^>]+property="og:title"/i);
  const ogDesc     = get(/<meta[^>]+property="og:description"[^>]+content="([^"]+)"/i)
                  || get(/<meta[^>]+content="([^"]+)"[^>]+property="og:description"/i);
  const metaTitle  = get(/<title[^>]*>([^<]+)<\/title>/i);
  const metaDesc   = get(/<meta[^>]+name="description"[^>]+content="([^"]+)"/i);

  const title      = jsonLd?.title || ogTitle || metaTitle || 'Untitled';
  const domain     = (() => { try { return new URL(url).hostname.replace(/^www\./,''); } catch(e) { return ''; } })();

  return {
    title:        title.trim().slice(0, 200),
    description:  jsonLd?.description || ogDesc || metaDesc || '',
    start_time:   jsonLd?.start_time  || null,
    end_time:     jsonLd?.end_time    || null,
    location_name:jsonLd?.location_name || null,
    price_raw:    jsonLd?.price || null,
    source_url:   url,
    source_domain:domain,
    jsonLdType,
    confidence_score: jsonLd ? 0.80 : 0.40
  };
}

// ── Price tier helper ─────────────────────────────────────────────────────
function priceTier(priceVal) {
  if (!priceVal || priceVal === '0' || priceVal === 0) return 'free';
  const n = parseFloat(String(priceVal).replace(/[^0-9.]/g,''));
  if (isNaN(n)) return 'low';
  if (n === 0) return 'free';
  if (n < 15)  return 'low';
  if (n < 50)  return 'medium';
  return 'high';
}

// ── Optional Claude enrichment via REST API ───────────────────────────────
async function enrichWithClaude(rawMeta, htmlSnippet) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  try {
    const prompt = `Extract structured event data from this web content and return ONLY valid JSON with these fields:
{
  "title": string,
  "type": "event" | "venue" | "activity_template",
  "category": one of: music|food|outdoors|sports|arts|nightlife|entertainment|wellness|education|community,
  "tags": [string, ...],
  "start_time": ISO8601 or null,
  "end_time": ISO8601 or null,
  "location_name": string or null,
  "price_tier": "free"|"low"|"medium"|"high" or null
}

Title hint: ${rawMeta.title}
Description: ${(rawMeta.description || '').slice(0, 500)}
HTML snippet: ${htmlSnippet.slice(0, 2000)}`;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 512,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = data.content?.[0]?.text || '';
    const jsonMatch = text.match(/\{[\s\S]+\}/);
    if (!jsonMatch) return null;
    return JSON.parse(jsonMatch[0]);
  } catch(e) {
    return null;
  }
}

// ── Main: fetch URL and return parsed opportunity draft ────────────────────
async function fetchAndParse(url) {
  let html = '';
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Spontany/1.0 (+https://spontany.club)' },
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    html = await res.text();
  } catch(e) {
    throw new Error(`Could not fetch URL: ${e.message}`);
  }

  const raw = extractMetadata(html, url);

  // Try Claude enrichment
  const enriched = await enrichWithClaude(raw, html.slice(0, 8000));

  const result = {
    title:         (enriched?.title  || raw.title).slice(0, 200),
    type:           enriched?.type   || guessType(url, raw.title, raw.description, !!raw.start_time, raw.jsonLdType),
    category:       enriched?.category || guessCategory(raw.title, raw.description),
    tags:           enriched?.tags   || [],
    start_time:     enriched?.start_time || raw.start_time || null,
    end_time:       enriched?.end_time   || raw.end_time   || null,
    location_name:  enriched?.location_name || raw.location_name || null,
    location_lat:   null,
    location_lng:   null,
    price_tier:     enriched?.price_tier || priceTier(raw.price_raw),
    source_type:    'user_submitted',
    source_domain:  raw.source_domain,
    source_url:     url,
    confidence_score: enriched ? 0.85 : raw.confidence_score
  };

  return result;
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
