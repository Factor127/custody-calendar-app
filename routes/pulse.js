'use strict';

// Pulse: a personal save-for-later feed of venues and dated events the user
// found interesting but hasn't actioned yet. Append-only by design — past
// events stay so the collection becomes a vibe fingerprint over time.

const express = require('express');
const crypto  = require('crypto');
const router  = express.Router();
const db      = require('../db');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

// ── Auth helper ──────────────────────────────────────────────────────────────
function requireToken(req, res) {
  const token = req.query.token || req.body?.token;
  if (!token) { res.status(401).json({ error: 'missing_token' }); return null; }
  const user = db.getUserByToken(token);
  if (!user)  { res.status(401).json({ error: 'invalid_token' }); return null; }
  return user;
}

// ── URL helpers ──────────────────────────────────────────────────────────────
function safeDomain(u) {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return null; }
}

function absolutize(maybeRel, base) {
  if (!maybeRel) return null;
  if (/^https?:\/\//i.test(maybeRel)) return maybeRel;
  try { return new URL(maybeRel, base).href; } catch (e) { return null; }
}

function decodeEntities(s) {
  if (!s) return s;
  return String(s)
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

// ── OG / metadata extraction ─────────────────────────────────────────────────
// Pulls title, description, image, site_name, and best-effort event date from
// schema.org/Event JSON-LD blocks. Tolerates messy markup; never throws.
async function fetchMetadata(url) {
  const out = { url, title: null, description: null, image_url: null,
                source_domain: safeDomain(url), event_date: null, event_time: null,
                site_name: null };
  let html;
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*' },
      signal: AbortSignal.timeout(7000),
      redirect: 'follow',
    });
    if (!resp.ok) return out;
    html = await resp.text();
  } catch (e) {
    return out;
  }

  const get = (re) => { const m = html.match(re); return m ? decodeEntities(m[1]) : null; };

  out.title = get(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
           || get(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)
           || get(/<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i)
           || get(/<title[^>]*>([^<]+)<\/title>/i);

  out.description = get(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)
                 || get(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i)
                 || get(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
                 || get(/<meta[^>]+name=["']twitter:description["'][^>]+content=["']([^"']+)["']/i);

  let img = get(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
         || get(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)
         || get(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i);
  out.image_url = absolutize(img, url);

  out.site_name = get(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i);

  // JSON-LD: look for schema.org Event with startDate.
  try {
    const ldRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = ldRe.exec(html)) !== null) {
      let parsed;
      try { parsed = JSON.parse(m[1].trim()); } catch (e) { continue; }
      const nodes = Array.isArray(parsed) ? parsed
                  : (parsed['@graph'] && Array.isArray(parsed['@graph'])) ? parsed['@graph']
                  : [parsed];
      for (const n of nodes) {
        if (!n || typeof n !== 'object') continue;
        const t = n['@type'];
        const isEvent = (typeof t === 'string' && /Event/i.test(t))
                     || (Array.isArray(t) && t.some(x => /Event/i.test(String(x))));
        if (!isEvent) continue;
        const start = n.startDate || n.startTime;
        if (start) {
          const dateMatch = String(start).match(/^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?/);
          if (dateMatch) {
            out.event_date = dateMatch[1];
            if (dateMatch[2]) out.event_time = dateMatch[2];
          }
        }
        break;
      }
      if (out.event_date) break;
    }
  } catch (e) { /* ignore */ }

  return out;
}

// ── GET /api/pulse — list current user's items ───────────────────────────────
// Returns events ordered by event_date asc, then venues by created_at desc.
// Past events still included (append-only).
router.get('/pulse', (req, res) => {
  const user = requireToken(req, res); if (!user) return;
  const rows = db.db.prepare(`
    SELECT id, kind, url, title, description, image_url, source_domain,
           event_date, event_time, location_name, category, price_tier,
           raw_text, notes, created_at
      FROM pulse_items
     WHERE user_id = ?
     ORDER BY
       CASE WHEN event_date IS NULL THEN 1 ELSE 0 END,
       event_date ASC,
       created_at DESC
  `).all(user.id);
  res.json({ items: rows });
});

// ── POST /api/pulse — create an item ─────────────────────────────────────────
// Body may include url/title/description/image_url/event_date/notes/etc.
// kind is inferred: if event_date is present → 'event', else 'venue'.
// If a url is given but no metadata, server fetches OG before insert.
router.post('/pulse', async (req, res) => {
  const user = requireToken(req, res); if (!user) return;
  const b = req.body || {};

  let { url, title, description, image_url, source_domain,
        event_date, event_time, location_name, category, price_tier,
        raw_text, notes, kind } = b;

  // If a URL is provided but title/image are missing, attempt to enrich.
  if (url && (!title || !image_url)) {
    try {
      const meta = await fetchMetadata(url);
      title         = title         || meta.title;
      description   = description   || meta.description;
      image_url     = image_url     || meta.image_url;
      source_domain = source_domain || meta.source_domain;
      event_date    = event_date    || meta.event_date;
      event_time    = event_time    || meta.event_time;
    } catch (e) { /* best-effort */ }
  }
  if (url && !source_domain) source_domain = safeDomain(url);

  if (!kind) kind = event_date ? 'event' : 'venue';
  if (kind !== 'event' && kind !== 'venue') {
    return res.status(400).json({ error: 'invalid_kind' });
  }

  // Need *something* identifying — at minimum a url, title, or raw_text.
  if (!url && !title && !raw_text) {
    return res.status(400).json({ error: 'empty_item' });
  }

  // Validate event_date format if given
  if (event_date && !/^\d{4}-\d{2}-\d{2}$/.test(event_date)) {
    return res.status(400).json({ error: 'invalid_event_date' });
  }
  if (price_tier && !['free','low','medium','high'].includes(price_tier)) {
    return res.status(400).json({ error: 'invalid_price_tier' });
  }

  const id = crypto.randomUUID();
  db.db.prepare(`
    INSERT INTO pulse_items
      (id, user_id, kind, url, title, description, image_url, source_domain,
       event_date, event_time, location_name, category, price_tier, raw_text, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, user.id, kind,
    url || null, title || null, description || null, image_url || null, source_domain || null,
    event_date || null, event_time || null, location_name || null,
    category || null, price_tier || null,
    raw_text || null, notes || null
  );

  const row = db.db.prepare('SELECT * FROM pulse_items WHERE id = ?').get(id);
  res.json({ ok: true, item: row });
});

// ── POST /api/pulse/preview — fetch OG metadata for a URL (no save) ──────────
// Used by the capture UI to show a confirmation card before the user commits.
router.post('/pulse/preview', async (req, res) => {
  const user = requireToken(req, res); if (!user) return;
  const url = (req.body && req.body.url) ? String(req.body.url).trim() : '';
  if (!url || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: 'invalid_url' });
  }
  const meta = await fetchMetadata(url);
  res.json({ ok: true, preview: meta });
});

// ── DELETE /api/pulse/:id ────────────────────────────────────────────────────
router.delete('/pulse/:id', (req, res) => {
  const user = requireToken(req, res); if (!user) return;
  const info = db.db.prepare('DELETE FROM pulse_items WHERE id = ? AND user_id = ?')
                    .run(req.params.id, user.id);
  if (!info.changes) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
});

module.exports = router;
