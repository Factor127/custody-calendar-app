'use strict';
// ── Shared link extraction (the parser) ─────────────────────────────────────
// Single source of truth used by:
//   - routes/sandbox.js          (paste-to-invite testing lab)
//   - routes/api.js /api/unfurl  (Smart Suggest, Start Create in calendar.html)
//   - services/opportunityIngestion.js (persisting opportunities to DB)
//
// Returns a rich object with ALL fields. Callers that only need a subset can
// ignore the extras. New fields added here automatically become available
// everywhere — but be careful not to break existing field NAMES that the
// frontend already consumes (title, date, time, description, image, etc).
//
// Extraction ladder (each tier fills gaps left by the previous):
//   1. JSON-LD (Event/LocalBusiness/Place; merges multiple matching nodes
//      including @graph wrappers)
//   2. __NEXT_DATA__ / __INITIAL_STATE__ (deep-find for known keys)
//   3. Open Graph + Twitter card meta tags
//   4. Anchor scan (for ticket URLs and price-page hints)
//   5. Price-page chase (fetch a same-domain price/info page when needed)
//   6. Title heuristic ("Artist @ Venue") for venue name
//
// Listicle handling: if the page has no Event/Venue node of its own but
// does have a JSON-LD ItemList, we extract the sub-event URLs and enrich
// the top few in parallel — gives callers a clickable drill-down list.
// ────────────────────────────────────────────────────────────────────────────

// HTML entity decoder — handles the common ones found in OG/meta content.
function decode(s) {
  if (!s) return null;
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

// Build a meta-tag extractor scoped to a single HTML doc.
function makeMetaExtractor(html) {
  return (prop) => {
    const re1 = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"'<>]{1,600})["']`, 'i');
    const re2 = new RegExp(`<meta[^>]+content=["']([^"'<>]{1,600})["'][^>]+(?:property|name)=["']${prop}["']`, 'i');
    return decode((html.match(re1) || html.match(re2))?.[1]?.trim() || null);
  };
}

// Recursively walk a parsed JSON tree, return the first non-empty value
// matching any of the candidate keys. Used to harvest fields from
// __NEXT_DATA__ / hydration blobs that nest data deep.
function deepFind(obj, keys, depth = 0, seen = new WeakSet()) {
  if (depth > 10 || obj == null || typeof obj !== 'object') return null;
  if (seen.has(obj)) return null;
  seen.add(obj);
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const v = deepFind(item, keys, depth + 1, seen);
      if (v != null && v !== '') return v;
    }
    return null;
  }
  for (const k of keys) {
    if (obj[k] != null && obj[k] !== '') return obj[k];
  }
  for (const k of Object.keys(obj)) {
    const v = deepFind(obj[k], keys, depth + 1, seen);
    if (v != null && v !== '') return v;
  }
  return null;
}

// Flatten a parsed JSON-LD payload into individual nodes. Schema.org
// supports single objects, arrays, and {"@graph": [...]} wrapping — we
// normalise to a flat array.
function collectNodes(parsed) {
  if (!parsed) return [];
  if (Array.isArray(parsed)) return parsed.flatMap(collectNodes);
  if (parsed['@graph']) return collectNodes(parsed['@graph']);
  return [parsed];
}

// True if this @type string belongs to something we treat as a primary
// event/venue node (vs. nav, breadcrumbs, organisation boilerplate).
function isEventOrVenue(typeStr) {
  const t = String(typeStr || '').toLowerCase();
  return /event|restaurant|localbusiness|venue|place|foodestab|cafeorcoffee|barorpub|museum|park|attraction|touristattraction/.test(t);
}

// Extract a YYYY-MM-DD from natural-language text like "April 13, 2026",
// "13 April 2026", or numeric "13/04/2026" / "13.04.26" / "13-04-2026".
// For non-US TLDs we assume DD/MM order; if the first number > 12 we know
// it's DD regardless. Two-digit years are expanded (00-49 → 2000s, 50-99 → 1900s).
// Returns null if no plausible date is found.
function parseDateFromText(text, url) {
  if (!text) return null;
  const M = { january:0,february:1,march:2,april:3,may:4,june:5,july:6,august:7,
              september:8,october:9,november:10,december:11,
              jan:0,feb:1,mar:2,apr:3,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
  const r1 = text.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})[\s,]+(\d{4})\b/i);
  const r2 = text.match(/\b(\d{1,2})\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})\b/i);
  let day, mon, year;
  if (r1) { mon = M[r1[1].toLowerCase()]; day = +r1[2]; year = +r1[3]; }
  else if (r2) { day = +r2[1]; mon = M[r2[2].toLowerCase()]; year = +r2[3]; }
  if (mon === undefined) {
    const rn = text.match(/\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})\b/);
    if (rn) {
      const a = +rn[1], b = +rn[2];
      year = +rn[3];
      if (year < 100) year += year < 50 ? 2000 : 1900;
      const isDMY = a > 12 || (a <= 12 && b <= 12 && /\.il|\.co\.il|\.eu|\.uk|\.de|\.fr|\.es|\.it|\.nl|\.au|\.nz/i.test(url || ''));
      if (isDMY) { day = a; mon = b - 1; }
      else       { mon = a - 1; day = b; }
    }
  }
  if (mon === undefined || !day || day > 31 || mon > 11 || year < 2020) return null;
  return `${year}-${String(mon + 1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}

// Extract a "HH:MM" 24-hour time from a free-text snippet. Handles 12h
// "7:30 PM" and 24h "19:30". Avoids false matches on years like "2026".
function parseTimeFromText(text) {
  if (!text) return null;
  const m12 = text.match(/\b(\d{1,2}):?(\d{2})?\s*(AM|PM)\b/i);
  if (m12) {
    let h = parseInt(m12[1], 10);
    const min = m12[2] ? parseInt(m12[2], 10) : 0;
    const ampm = m12[3].toUpperCase();
    if (ampm === 'PM' && h < 12) h += 12;
    if (ampm === 'AM' && h === 12) h = 0;
    return `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}`;
  }
  const m24 = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (m24) return `${m24[1].padStart(2,'0')}:${m24[2]}`;
  return null;
}

// Map free text mentioning a US city to its UTC offset (DST-adjusted, naive).
// Returns null when no recognised city is found. Used to correct natural-
// language dates from US event pages for non-US viewers.
function venueUtcOffset(text) {
  if (!text) return null;
  const t = text.toLowerCase();
  if (/new york|brooklyn|manhattan|bronx|queens|\bnyc\b|boston|miami|atlanta|washington\s*d\.?c|philadelphia|detroit|toronto|montreal|cleveland|pittsburgh|baltimore|charlotte|nashville|orlando|tampa|jacksonville/.test(t)) return -4;
  if (/chicago|dallas|houston|minneapolis|new orleans|kansas city|st[. ]+louis|milwaukee|memphis|oklahoma/.test(t)) return -5;
  if (/denver|salt lake|phoenix|albuquerque|tucson/.test(t)) return -6;
  if (/los angeles|hollywood|san francisco|san jose|san diego|seattle|portland|las vegas|sacramento|anaheim/.test(t)) return -7;
  return null;
}

// Parse a schema.org openingHours string like "Mo-Fr 09:00-17:00" or
// "Monday,Tuesday,Wednesday,Thursday 10:00-17:00" → {days, opens, closes}.
function parseHoursString(str) {
  const tMatch = str.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
  if (!tMatch) return null;
  return {
    days:   str.slice(0, tMatch.index).trim().replace(/,\s*/g, ', '),
    opens:  tMatch[1],
    closes: tMatch[2],
  };
}

// Default request headers. Facebook sniffs the UA and only serves OG tags
// to its own crawler, so we spoof for that domain.
function buildHeaders(url) {
  const isFacebook = /facebook\.com/i.test(url);
  return {
    'User-Agent': isFacebook
      ? 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'
      : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
  };
}

// ── Main entry point ────────────────────────────────────────────────────────
//
// options:
//   timeoutMs        - main fetch timeout (default 10000)
//   enrichListItems  - parallel-fetch sub-URLs from ItemList pages (default true)
//   chasePricePage   - follow same-domain price/info pages when price missing (default true)
//
async function unfurlUrl(url, options = {}) {
  const {
    timeoutMs       = 10000,
    enrichListItems = true,
    chasePricePage  = true,
  } = options;

  const headers = buildHeaders(url);
  const resp = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
  const finalUrl = resp.url || url;
  const html = await resp.text();
  const domain = (() => { try { return new URL(finalUrl).hostname.replace(/^www\./, ''); } catch(e) { return null; } })();
  const meta = makeMetaExtractor(html);

  // ── Title / OG / basic meta ────────────────────────────────────────────────
  let title = meta('og:title') || meta('twitter:title')
           || decode(html.match(/<title[^>]*>([^<]{1,200})<\/title>/i)?.[1]?.trim() || null);
  const tl = (title || '').toLowerCase();
  if (tl === 'facebook' || tl === 'error' || tl.includes('log in') || tl.includes('sign in')) title = null;

  const description = meta('og:description') || meta('description') || null;
  // Resolve image to an absolute URL and reject obvious favicons. Real-world
  // pages (e.g. ticketmaster.co.il) sometimes set og:image="favicon.ico" — a
  // relative path to a 16x16 icon, which renders broken in the app preview.
  // Treat any URL whose final path segment is a known-favicon name (or that
  // points to /favicon.*) as no image rather than passing the bad URL through.
  const image = (() => {
    const raw = meta('og:image') || meta('twitter:image') || null;
    if (!raw) return null;
    let abs;
    try { abs = new URL(raw, finalUrl).toString(); } catch(e) { return null; }
    // Reject favicon-style paths: /favicon.ico, favicon.png, apple-touch-icon, etc.
    if (/(?:^|\/)(?:favicon[._-]?[^\/?#]*|apple-touch-icon[^\/?#]*)(?:\?|#|$)/i.test(abs)) return null;
    return abs;
  })();
  const siteName    = meta('og:site_name') || null;
  const ogType      = meta('og:type') || null;

  // ── JSON-LD: collect ALL Event/Venue nodes, merge shallowly ────────────────
  // Pages like museumofillusions.co.il split info across a Place node (has
  // address) and a LocalBusiness node (has name). Merging in Event >
  // LocalBusiness > Place rank order lets richer nodes' fields win while
  // gaps get filled by simpler ones.
  let jsonLd = null;
  const ldMatches = [...html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)];
  const matchingNodes = [];
  for (const m of ldMatches) {
    try {
      const parsed = JSON.parse(m[1]);
      for (const node of collectNodes(parsed)) {
        const types = Array.isArray(node['@type']) ? node['@type'] : [node['@type']];
        if (types.some(isEventOrVenue)) matchingNodes.push(node);
      }
    } catch(e) { /* skip malformed block */ }
  }
  if (matchingNodes.length) {
    const rank = (node) => {
      const t = Array.isArray(node['@type']) ? node['@type'].join(' ') : String(node['@type'] || '');
      if (/Event/i.test(t)) return 0;
      if (/LocalBusiness|Restaurant|Hotel|Lodg/i.test(t)) return 1;
      return 2;
    };
    matchingNodes.sort((a, b) => rank(a) - rank(b));
    jsonLd = {};
    for (const node of matchingNodes) {
      for (const [k, v] of Object.entries(node)) {
        if (jsonLd[k] == null) jsonLd[k] = v;
      }
    }
  }

  // ── Hydration blobs (Next.js / SPA) ────────────────────────────────────────
  // Many event sites (selector.org.il, some Eventbrite, etc.) ship data via
  // __NEXT_DATA__ instead of JSON-LD. Parse it and use deepFind() to harvest
  // common fields.
  let nextData = null;
  const nextMatch = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (nextMatch) { try { nextData = JSON.parse(nextMatch[1]); } catch(e) {} }
  if (!nextData) {
    const initMatch = html.match(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});/);
    if (initMatch) { try { nextData = JSON.parse(initMatch[1]); } catch(e) {} }
  }

  // ── Date + Time ────────────────────────────────────────────────────────────
  // Extraction ladder (each tier fills gaps left by the previous):
  //   1. JSON-LD Event.startDate  (structured, ISO with timezone)
  //   2. __NEXT_DATA__ deepFind on startDate-ish keys
  //   3. Raw HTML regex for "startDate" (catches embedded JSON not in <script>)
  //   4. Event-specific meta tags (og:updated_time, event:start_time)
  //   5. Natural-language parse on description + title (text_parsed flag set)
  //   6. URL pattern (yyyy/mm/dd or yyyy-mm-dd in path)
  //   7. HTML date class scan (e.g. <span class="event-date">16.04.26</span>)
  //
  // We intentionally do NOT fall back to article:published_time — it's the
  // page's last-published date (common on venue sites like museumofillusions)
  // and has nothing to do with event scheduling.
  let startIso = jsonLd?.startDate
              || deepFind(nextData, ['startDate', 'start_date', 'startTime', 'dateStart'])
              || null;
  let endIso = jsonLd?.endDate
            || deepFind(nextData, ['endDate', 'end_date', 'endTime', 'dateEnd'])
            || null;
  if (!startIso) {
    const jldRaw = html.match(/"startDate"\s*:\s*"([^"]{6,30})"/i);
    if (jldRaw) startIso = jldRaw[1];
  }

  let date = null;
  let time = null;            // 24-hour "HH:MM" (venue-local digits as-is)
  let text_parsed = false;    // true when date came from natural language (no tz info)

  if (startIso) {
    date = String(startIso).slice(0, 10);
    // Extract HH:MM from ISO. Note: this is the *digits* in the timestamp,
    // not converted to UTC — many sources publish venue-local time with a
    // tz offset suffix, so the visible HH:MM IS the local time.
    const tMatch = String(startIso).match(/T(\d{2}):(\d{2})/);
    if (tMatch) time = `${tMatch[1]}:${tMatch[2]}`;
  }

  // Tier 4: event-specific meta tags
  if (!date) {
    const m = meta('event:start_time') || meta('datePublished');
    if (m) {
      const d = new Date(m);
      if (!isNaN(d)) date = d.toISOString().slice(0, 10);
    }
  }

  // Tier 5: natural-language parsing of description / title
  if (!date) {
    const d = parseDateFromText(description, finalUrl) || parseDateFromText(title, finalUrl);
    if (d) { date = d; text_parsed = true; }
  }

  // Tier 6: URL path pattern
  if (!date) {
    const m = finalUrl.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
    if (m) date = `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  }

  // Tier 7: scan elements with date-related classes (e.g. hatarbut.co.il
  // uses <span class="event-date-occurrence">16.04.26</span>)
  if (!date) {
    const dateClassPatterns = [
      /class="[^"]*(?:event-date|occurrence|eo-event)[^"]*"[^>]*>([^<]{4,30})/i,
      /class="[^"]*\bdate\b[^"]*"[^>]*>([^<]{4,30})/i,
    ];
    for (const pat of dateClassPatterns) {
      const m = html.match(pat);
      if (m) {
        const d = parseDateFromText(m[1], finalUrl);
        if (d) { date = d; text_parsed = true; break; }
      }
    }
  }

  // Time fallback ladder when we only had a date but no T-component:
  //   - parseTimeFromText on description / title
  //   - JSON-LD doorTime / startTime fields embedded in HTML
  //   - Body text patterns (doors/gates/show/Hebrew שעה/פתיחת)
  //
  // Body-text scanning runs against `htmlForBodyScan` rather than raw `html`:
  // we strip <!-- comments -->, <script>, <style>, and <noscript> blocks first
  // because Israeli ticket sites (zappa-club, eventim) inject build timestamps
  // like `<!--29.04.2026 23:42:01:842 Generiert vom ...-->` that previously
  // matched the year+time pattern below and produced ghost event times.
  if (!time) time = parseTimeFromText(description) || parseTimeFromText(title);
  if (!time) {
    const doorTime = html.match(/"(?:doorTime|startTime)"\s*:\s*"([^"]{3,20})"/i);
    if (doorTime) time = parseTimeFromText(doorTime[1]);
  }
  if (!time) {
    const htmlForBodyScan = html
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ');
    // Phrases that indicate the matched time is NOT an event start —
    // page-modification timestamps, build stamps, "last edited on …".
    // Wikipedia: "This page was last edited on 7 April 2026, at 22:11".
    // German build comments: "Generiert vom web-pdfe-e02".
    const REJECT_CONTEXT = /last\s+(?:edited|modified|updated)|modified\s+on|updated\s+on|page\s+was|generiert|generated\s+(?:on|at|by)|built\s+at|copyright/i;
    // The (?!:|\d) lookahead rejects `HH:MM:SS` and `HH:MMxx` so build
    // timestamps with seconds/millis don't masquerade as event times.
    const bodyTimePatterns = [
      /class="[^"]*time[^"]*"[^>]*>[^<]*?(\d{1,2}:\d{2}(?:\s*[AP]M)?)(?!:|\d)/i,
      /(?:20[2-3]\d|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec).{0,120}?[>•|\s](\d{1,2}:\d{2}(?:\s*[AP]M)?)(?!:|\d)/i,
      /(?:שעה|פתיחת).{0,20}?(\d{1,2}:\d{2})(?!:|\d)/,
      /(?:doors?|gates?|show|starts?|begins?).{0,30}?(\d{1,2}:\d{2}(?:\s*[AP]M)?)(?!:|\d)/i,
    ];
    for (const pat of bodyTimePatterns) {
      // Iterate matches so we can skip ones with rejection context and try
      // the next occurrence rather than abandoning the whole pattern.
      const gPat = new RegExp(pat.source, pat.flags.includes('g') ? pat.flags : pat.flags + 'g');
      let m;
      while ((m = gPat.exec(htmlForBodyScan)) !== null) {
        const ctx = htmlForBodyScan.slice(Math.max(0, m.index - 80), m.index + m[0].length + 20);
        if (REJECT_CONTEXT.test(ctx)) continue;
        const t = parseTimeFromText(m[1]);
        if (t) { time = t; break; }
      }
      if (time) break;
    }
  }

  // Normalise the date string (strips any time component, validates)
  if (date) {
    const d = new Date(date.length === 10 ? date + 'T00:00:00Z' : date);
    date = isNaN(d) ? null : d.toISOString().slice(0, 10);
  }

  // Optional: text-parsed-date timezone correction.
  // When date came from natural language, it has no tz info and represents
  // the venue's local date. For viewers in different timezones, an evening
  // start in NYC can land on a different calendar date — shift it.
  if (text_parsed && date && options.clientOffsetMin) {
    const venueOffsetHrs = venueUtcOffset(description || title || '');
    if (venueOffsetHrs !== null) {
      const localHour  = 20;                       // 8 PM assumed concert start
      const utcHour    = localHour - venueOffsetHrs;
      const extraDays  = Math.floor(utcHour / 24);
      const utcHourMod = utcHour % 24;
      const utcDate    = new Date(date + 'T00:00:00Z');
      utcDate.setUTCDate(utcDate.getUTCDate() + extraDays);
      utcDate.setUTCHours(utcHourMod, 0, 0, 0);
      const clientMs   = utcDate.getTime() + options.clientOffsetMin * 60 * 1000;
      date = new Date(clientMs).toISOString().slice(0, 10);
    }
  }

  // Past-event check is only meaningful when a real event date exists.
  // Callers further gate this on classification (kind === 'event') so venues
  // with stray dates don't trigger past warnings.
  const today = new Date().toISOString().slice(0, 10);
  const is_past = date ? date < today : null;

  // ── Price ──────────────────────────────────────────────────────────────────
  let price = null, currency = null;
  const offers = jsonLd?.offers;
  if (offers) {
    const firstOffer = Array.isArray(offers) ? offers[0] : offers;
    if (firstOffer?.price != null) price = String(firstOffer.price);
    if (firstOffer?.priceCurrency) currency = firstOffer.priceCurrency;
  }
  if (price == null) {
    const p = deepFind(nextData, ['price', 'minPrice', 'startingPrice', 'ticketPrice']);
    if (p != null) price = String(p);
  }
  if (!currency) {
    currency = deepFind(nextData, ['priceCurrency', 'currency', 'currencyCode']) || null;
  }

  // ── Location (name + address) ──────────────────────────────────────────────
  let location_name = null, location_address = null;
  const loc = jsonLd?.location;
  if (loc) {
    if (typeof loc === 'string') { location_name = loc; }
    else {
      location_name = loc.name || null;
      const addr = loc.address;
      if (addr) {
        if (typeof addr === 'string') location_address = addr;
        else location_address = [addr.streetAddress, addr.addressLocality, addr.addressRegion, addr.addressCountry].filter(Boolean).join(', ') || null;
      }
    }
  }
  // For venues, the JSON-LD root IS the venue, so its name/address are ours.
  const rootTypes = Array.isArray(jsonLd?.['@type']) ? jsonLd['@type'].join(' ') : String(jsonLd?.['@type'] || '');
  const isVenueRoot = /Place|LocalBusiness|Restaurant|Hotel|Museum|Park|Attraction/i.test(rootTypes);
  if (isVenueRoot && !location_name && jsonLd?.name) {
    location_name = jsonLd.name;
  }
  if (!location_address && jsonLd?.address) {
    const addr = jsonLd.address;
    if (typeof addr === 'string') location_address = addr;
    else location_address = [addr.streetAddress, addr.addressLocality, addr.addressRegion, addr.addressCountry].filter(Boolean).join(', ') || null;
  }
  // Hydration-blob fallback
  if (!location_name) {
    location_name = deepFind(nextData, ['venueName', 'placeName']) || null;
    if (!location_name) {
      const venueObj = deepFind(nextData, ['venue', 'place']);
      if (venueObj && typeof venueObj === 'object') location_name = venueObj.name || null;
      else if (typeof venueObj === 'string') location_name = venueObj;
    }
  }
  if (!location_address) {
    const addrRaw = deepFind(nextData, ['address', 'fullAddress', 'formattedAddress']);
    if (typeof addrRaw === 'string') location_address = addrRaw;
    else if (addrRaw && typeof addrRaw === 'object') {
      location_address = [addrRaw.streetAddress || addrRaw.street, addrRaw.addressLocality || addrRaw.city, addrRaw.addressCountry || addrRaw.country].filter(Boolean).join(', ') || null;
    }
  }
  // Last-resort title heuristic: "<artist> @ <venue>" / "<artist> at <venue>"
  if (!location_name && title) {
    const vMatch = title.match(/\s(?:@|at)\s+([^-|·:]+?)(?:\s*[-|·:]|$)/i);
    if (vMatch) location_name = vMatch[1].trim();
  }

  // ── Opening hours (venues) ─────────────────────────────────────────────────
  // Schema.org supports two shapes:
  //   openingHours: "Mo-Fr 09:00-17:00"  or array of such strings
  //   openingHoursSpecification: [{dayOfWeek, opens, closes}, ...]
  let opening_hours = null;
  const rawHours = jsonLd?.openingHours;
  const rawSpec  = jsonLd?.openingHoursSpecification;
  if (rawSpec) {
    const specs = Array.isArray(rawSpec) ? rawSpec : [rawSpec];
    opening_hours = specs.map(s => ({
      days:   Array.isArray(s.dayOfWeek) ? s.dayOfWeek.map(d => String(d).split('/').pop()).join(', ') : String(s.dayOfWeek || ''),
      opens:  s.opens  || null,
      closes: s.closes || null,
    })).filter(x => x.opens && x.closes);
  } else if (rawHours) {
    const arr = Array.isArray(rawHours) ? rawHours : [rawHours];
    opening_hours = arr.map(parseHoursString).filter(Boolean);
  }
  if (!opening_hours || !opening_hours.length) {
    const ndHours = deepFind(nextData, ['openingHours', 'opening_hours', 'hours', 'schedule']);
    if (typeof ndHours === 'string') {
      const parsed = parseHoursString(ndHours);
      if (parsed) opening_hours = [parsed];
    } else if (Array.isArray(ndHours)) {
      opening_hours = ndHours.map(x => typeof x === 'string' ? parseHoursString(x) : null).filter(Boolean);
    }
  }
  if (opening_hours && !opening_hours.length) opening_hours = null;

  // ── Ticket / buy URL ───────────────────────────────────────────────────────
  let ticket_url = null;
  if (offers) {
    const firstOffer = Array.isArray(offers) ? offers[0] : offers;
    if (firstOffer?.url) ticket_url = firstOffer.url;
  }
  if (!ticket_url) {
    ticket_url = deepFind(nextData, ['ticketUrl', 'checkoutUrl', 'buyUrl', 'purchaseUrl']) || null;
  }

  // ── ItemList: detect listicle/category pages ───────────────────────────────
  // Only treated as a list if the page has NO Event/Venue node of its own.
  // Many individual event pages also include a tiny ItemList ("related events")
  // that we don't want to mistake for the primary content.
  let list_items = null;
  let listSourceNode = null;
  if (!jsonLd) {
    for (const m of ldMatches) {
      try {
        const parsed = JSON.parse(m[1]);
        const flat = parsed['@graph'] || (Array.isArray(parsed) ? parsed : [parsed]);
        for (const node of flat) {
          if (node['@type'] === 'ItemList' && Array.isArray(node.itemListElement) && node.itemListElement.length >= 1) {
            listSourceNode = node; break;
          }
        }
        if (listSourceNode) break;
      } catch(e) {}
    }
  }
  if (listSourceNode && enrichListItems) {
    const items = listSourceNode.itemListElement
      .map(el => ({
        position: el.position || null,
        url:      el.url || el['@id'] || (typeof el.item === 'string' ? el.item : el.item?.url) || null,
      }))
      .filter(x => x.url && /^https?:\/\//i.test(x.url));

    const top = items.slice(0, 6);
    const enriched = await Promise.allSettled(top.map(async (item) => {
      try {
        const r = await fetch(item.url, { headers, redirect: 'follow', signal: AbortSignal.timeout(6000) });
        const h = await r.text();
        const ogTitle = h.match(/<meta[^>]+(?:property|name)=["']og:title["'][^>]+content=["']([^"']{1,300})["']/i)?.[1]
                     || h.match(/<title[^>]*>([^<]{1,200})<\/title>/i)?.[1] || null;
        const ogImage = h.match(/<meta[^>]+(?:property|name)=["']og:image["'][^>]+content=["']([^"']{1,500})["']/i)?.[1] || null;
        let startIsoSub = null;
        const lds2 = [...h.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)];
        for (const m2 of lds2) {
          try {
            const p = JSON.parse(m2[1]);
            const flat = p['@graph'] || (Array.isArray(p) ? p : [p]);
            for (const node of flat) {
              if (/Event/i.test(JSON.stringify(node['@type'] || ''))) {
                startIsoSub = node.startDate || null;
                break;
              }
            }
            if (startIsoSub) break;
          } catch(e) {}
        }
        if (!startIsoSub) {
          const m3 = h.match(/"startDate"\s*:\s*"([^"]{6,30})"/i);
          if (m3) startIsoSub = m3[1];
        }
        // Resolve listicle item image to an absolute URL against the item's
        // own page URL, and reject favicons — same fix as the top-level image.
        let resolvedItemImage = null;
        if (ogImage) {
          const decoded = decode(ogImage.trim());
          try {
            const abs = new URL(decoded, item.url).toString();
            if (!/(?:^|\/)(?:favicon[._-]?[^\/?#]*|apple-touch-icon[^\/?#]*)(?:\?|#|$)/i.test(abs)) {
              resolvedItemImage = abs;
            }
          } catch(e) {}
        }
        return {
          ...item,
          title:     decode(ogTitle?.trim()),
          image:     resolvedItemImage,
          start_iso: startIsoSub,
          date:      startIsoSub ? String(startIsoSub).slice(0, 10) : null,
        };
      } catch(e) {
        return { ...item, error: e.message };
      }
    }));
    list_items = enriched.map(r => r.status === 'fulfilled' ? r.value : { error: r.reason?.message });
    if (items.length > 6) list_items.push(...items.slice(6).map(x => ({ ...x, _stub: true })));
  } else if (listSourceNode) {
    // enrichListItems disabled — return URL-only stubs so callers can still see them
    list_items = listSourceNode.itemListElement
      .map(el => ({
        position: el.position || null,
        url:      el.url || el['@id'] || (typeof el.item === 'string' ? el.item : el.item?.url) || null,
        _stub: true,
      }))
      .filter(x => x.url);
    if (!list_items.length) list_items = null;
  }

  // ── Anchor-scan: find ticket URL and same-domain info pages ────────────────
  // Used when structured extraction missed a ticket URL or a price. Captures
  // candidate info pages (/contact, /prices, /tickets) that commonly hold
  // price tables on venue sites like museumofillusions.co.il.
  let price_page_url = null;
  if (!ticket_url || price == null) {
    const baseDomain = domain;
    const anchors = [...html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]{0,200}?)<\/a>/gi)];
    const resolveUrl = (href, base) => {
      try { return new URL(decode(href), base).toString(); } catch(e) { return null; }
    };
    const BOOK_RE  = /ticket|\bbuy\b|book\s*now|checkout|purchase|reserve|כרטיס|להזמ|לקנ|הזמנ/i;
    const PRICE_RE = /\bprice|\bpricing|cost|entrance|entry.fee|admission|מחיר|עלות/i;
    for (const m of anchors) {
      const rawHref = m[1];
      if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('javascript:') || rawHref.startsWith('mailto:') || rawHref.startsWith('tel:')) continue;
      const href = resolveUrl(rawHref, finalUrl);
      if (!href) continue;
      const text = decode(m[2].replace(/<[^>]+>/g, '').trim()) || '';
      const hrefDomain = (() => { try { return new URL(href).hostname.replace(/^www\./, ''); } catch(e) { return null; } })();
      const isExternal = hrefDomain && hrefDomain !== baseDomain;
      const combined = href + ' ' + text;
      if (!ticket_url && BOOK_RE.test(combined) && isExternal) ticket_url = href;
      if (!price_page_url && PRICE_RE.test(combined) && !isExternal) price_page_url = href;
    }
  }

  // ── Price-page chase: fetch the candidate info page and regex for prices ──
  let price_range = null;
  if (chasePricePage && price == null && price_page_url) {
    try {
      const pr = await fetch(price_page_url, { headers, redirect: 'follow', signal: AbortSignal.timeout(8000) });
      const pHtml = await pr.text();
      const text = pHtml.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>|<[^>]+>/g, ' ');
      const hits = [...text.matchAll(/(?:₪|ILS|NIS|\$|USD|€|EUR)\s*(\d{1,5})|(\d{1,5})\s*(?:₪|ILS|NIS|\$|USD|€|שח|ש״ח)/gi)];
      const nums = hits.map(h => parseInt(h[1] || h[2], 10)).filter(n => n >= 10 && n <= 10000);
      if (nums.length) {
        const unique = [...new Set(nums)].sort((a, b) => a - b);
        price_range = unique;
        if (unique.length >= 2) price = `${unique[0]}–${unique[unique.length-1]}`;
        else price = String(unique[0]);
        if (/₪|שח|ש״ח|NIS|ILS/i.test(text)) currency = currency || 'ILS';
        else if (/\$|USD/.test(text)) currency = currency || 'USD';
        else if (/€|EUR/.test(text)) currency = currency || 'EUR';
      }
    } catch(e) { /* ignore chase failures */ }
  }

  // ── Optional AI fallback for sparse SPA pages ──────────────────────────────
  // When deterministic tiers leave the page essentially blank (no title or
  // no date), a small Claude call can squeeze details out of the URL slug
  // and whatever stripped body text exists. Cost: one Haiku call (~$0.0001).
  // Caller opts in via options.allowAiFallback; we no-op without an API key.
  if (options.allowAiFallback && (!date || !title || (title && !date && !image))) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      try {
        const bodyText = html
          .replace(/<script[\s\S]*?<\/script>/gi, ' ')
          .replace(/<style[\s\S]*?<\/style>/gi, ' ')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s{2,}/g, ' ')
          .trim()
          .slice(0, 2000);
        const claudePrompt = `Extract event details from this ticketing page. The page may be a JavaScript SPA so the HTML content is sparse - use the URL structure and any text you can find.

URL: ${finalUrl}
Page title: ${title || '(none)'}
Site: ${siteName || '(unknown)'}
Page text: ${bodyText || '(empty - SPA)'}

Return ONLY valid JSON:
{ "title": "Event/artist name", "date": "YYYY-MM-DD or null", "time": "HH:MM (24h) or null", "venue": "venue name or null" }

Rules:
- The current year is ${new Date().getFullYear()}.
- For Israeli sites (.co.il), dates in DD/MM format are day/month.
- If the URL has a presentationId or prsntId parameter, this is a specific showtime.
- If you cannot determine the date/time, set them to null but still extract the title.
- Do NOT invent data you're not confident about.`;
        const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
          body: JSON.stringify({ model: 'claude-haiku-4-5', max_tokens: 256, messages: [{ role: 'user', content: claudePrompt }] }),
          signal: AbortSignal.timeout(8000),
        });
        if (claudeRes.ok) {
          const cData = await claudeRes.json();
          const cText = cData.content?.[0]?.text || '';
          const cJson = cText.match(/\{[\s\S]+\}/);
          if (cJson) {
            const parsed = JSON.parse(cJson[0]);
            if (parsed.title && !title) title = parsed.title;
            // Replace generic site-shell titles with AI's extracted name
            if (parsed.title && title && /כרטיסים|tickets|comy|booking/i.test(title)) title = parsed.title;
            if (parsed.date && !date) {
              const d = new Date(parsed.date);
              date = isNaN(d) ? null : d.toISOString().slice(0, 10);
              if (date) text_parsed = true;
            }
            if (parsed.time && !time) {
              time = parseTimeFromText(parsed.time) || parsed.time;
            }
            if (parsed.venue && !location_name) location_name = parsed.venue;
          }
        }
      } catch(e) { /* AI fallback non-critical */ }
    }
  }

  return {
    url: finalUrl,
    domain,
    title,
    description: description?.slice(0, 500) || null,
    image,
    site_name: siteName,
    og_type: ogType,
    json_ld_type: jsonLd?.['@type'] || null,
    json_ld_age_range: jsonLd?.typicalAgeRange || null,
    date,
    time,
    text_parsed,
    start_iso: startIso,
    end_iso: endIso,
    is_past,
    extraction_source: jsonLd ? 'json-ld' : (nextData ? 'next-data' : 'meta-only'),
    price,
    currency,
    location_name,
    location_address,
    opening_hours,
    ticket_url,
    price_range,
    price_page_url,
    list_items,
    html_len: html.length,
  };
}

module.exports = {
  unfurlUrl,
  // Helpers exported for downstream callers that need to do partial extraction
  decode,
  deepFind,
  collectNodes,
  isEventOrVenue,
  parseHoursString,
  parseDateFromText,
  parseTimeFromText,
  venueUtcOffset,
};
