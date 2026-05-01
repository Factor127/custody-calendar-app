'use strict';
const db = require('../db');
const { CHIP_TO_CAT } = require('./opportunityIngestion');

// ── Pref helpers ─────────────────────────────────────────────────────────────

// Map a user's activity-chip prefs (general, not per-friend) to opp categories.
function userCategories(userId) {
  const prefs = db.getUserActivityPrefs(userId);
  const cats  = new Set();
  for (const row of prefs) {
    const types = JSON.parse(row.activity_types || '[]');
    for (const chip of types) {
      (CHIP_TO_CAT[chip] || []).forEach(c => cats.add(c));
    }
  }
  return [...cats];
}

// Map per-connection prefs (chips set during the connection-prefs flow) to cats.
// Falls back to user's general categories when no per-connection prefs exist.
function connectionCategories(userId, connectionId, fallbackCats) {
  const row = db.q.getConnectionPrefs.get(userId, connectionId);
  if (!row || !row.activity_types || row.activity_types === '[]') return fallbackCats;
  const cats = new Set();
  for (const chip of JSON.parse(row.activity_types)) {
    (CHIP_TO_CAT[chip] || []).forEach(c => cats.add(c));
  }
  const out = [...cats];
  return out.length ? out : fallbackCats;
}

// Intersect two category arrays (string equality). When one side is empty,
// return the other — i.e. "no opinion" doesn't filter.
function intersectCats(a, b) {
  if (!a || !a.length) return b || [];
  if (!b || !b.length) return a;
  return a.filter(x => b.includes(x));
}

// ── Calendar helpers ─────────────────────────────────────────────────────────

const fmt = d => d.toISOString().slice(0,10);

// Is the user kid-free on this date? "Kid-free" = day owner is NOT 'self'
// (so 'coparent' or any unset day counts as free, matching userFreeDays).
function isKidFreeOn(userId, date) {
  const row = db.getDayForUser(userId, date);
  if (!row) return true;            // unset day → treated as free
  return (row.owner || 'coparent') !== 'self';
}

// User's free days (next 60), used by the legacy non-date path.
function userFreeDays(userId) {
  const today = new Date(); today.setHours(0,0,0,0);
  const end   = new Date(today); end.setDate(today.getDate() + 60);

  const rows  = db.getDaysForUserInRange(userId, fmt(today), fmt(end));
  const byDate = {};
  for (const r of rows) byDate[r.date] = r.owner;

  const free = [];
  for (let i = 0; i < 60; i++) {
    const d  = new Date(today); d.setDate(today.getDate() + i);
    const ds = fmt(d);
    if ((byDate[ds] || 'coparent') !== 'self') free.push(ds);
  }
  return new Set(free);
}

// Count how many of the next 30 days BOTH users are kid-free.
// Used to decide if a connection-overlap is "scarce" → pulse-worthy.
function overlapCountNext30(userIdA, userIdB) {
  const today = new Date(); today.setHours(0,0,0,0);
  const end   = new Date(today); end.setDate(today.getDate() + 30);
  const aRows = db.getDaysForUserInRange(userIdA, fmt(today), fmt(end));
  const bRows = db.getDaysForUserInRange(userIdB, fmt(today), fmt(end));
  const aMap = {}, bMap = {};
  for (const r of aRows) aMap[r.date] = r.owner;
  for (const r of bRows) bMap[r.date] = r.owner;
  let count = 0;
  for (let i = 0; i < 30; i++) {
    const d  = new Date(today); d.setDate(today.getDate() + i);
    const ds = fmt(d);
    const aFree = (aMap[ds] || 'coparent') !== 'self';
    const bFree = (bMap[ds] || 'coparent') !== 'self';
    if (aFree && bFree) count++;
  }
  return count;
}

const SCARCITY_THRESHOLD = 3;   // ≤3 overlaps in next 30 days → pulse-worthy

// ── Card decoration ──────────────────────────────────────────────────────────

// Old scoring (used by the non-date legacy path). Kept verbatim for back-compat.
function legacyScore(opp, userCats, freeDays) {
  let score = 0;
  const reasons = [];
  const oppTags = JSON.parse(opp.tags || '[]');

  if (userCats.includes(opp.category)) {
    score += 0.40;
    reasons.push(`matches your ${opp.category} interest`);
  } else if (userCats.length === 0) {
    score += 0.15;
  }

  const overlap = oppTags.filter(t => userCats.some(c => t.toLowerCase().includes(c))).length;
  if (overlap > 0) {
    score += 0.15 * Math.min(overlap, 3);
    reasons.push(`${overlap} matching tags`);
  }

  if (opp.start_time) {
    const oppDay = opp.start_time.slice(0,10);
    if (freeDays.has(oppDay)) {
      score += 0.35;
      reasons.push("you're free that day");
    }
  } else {
    score += 0.10;
  }

  score += (opp.confidence_score - 0.5) * 0.10;

  return {
    match_score:      Math.min(1, Math.max(0, Math.round(score * 100) / 100)),
    relevance_reason: reasons.join(' · ') || 'might interest you',
  };
}

// Wrap an opp row into a card with the new fields. Defaults are sensible for
// rows that come from the legacy (non-date) path.
function decorateCard(opp, extras = {}) {
  return {
    ...opp,
    tags: typeof opp.tags === 'string' ? JSON.parse(opp.tags || '[]') : (opp.tags || []),
    reason_type:      extras.reason_type      ?? (opp.start_time ? 'event' : 'solo'),
    lead_reason:      extras.lead_reason      ?? (opp.relevance_reason || 'might interest you'),
    is_pulse_worthy:  extras.is_pulse_worthy  ?? false,
    connection_ids:   extras.connection_ids   ?? [],
    match_score:      extras.match_score      ?? opp.match_score ?? 0,
  };
}

// ── Bucket builders (date-scoped path) ───────────────────────────────────────

// Bucket A — relational. For each currently-active social connection that
// overlaps with the user on `date`, find venues/non-dated opps matching the
// intersection of (user prefs ∩ per-connection prefs). Partner first, then
// friends. is_pulse_worthy fires when overlap is scarce in next 30 days.
function getRelationalIdeas(userId, date, userCats) {
  const conns = db.getActiveSocialConnections(userId);
  if (!conns.length) return [];
  if (!isKidFreeOn(userId, date)) return [];      // user has kids, not socially free

  // Pull venue/activity opps once (non-dated, relational ideas are venue-shaped).
  const allOpps = db.getOpportunitiesForMatching({ from_date: date });
  const venues  = allOpps.filter(o => o.type !== 'event' && !o.start_time);

  const cards = [];
  for (const c of conns) {
    if (!isKidFreeOn(c.other_user_id, date)) continue;     // friend has kids
    const friendCats = connectionCategories(userId, c.id, userCats);
    const cats       = intersectCats(userCats, friendCats);
    const isPartner  = c.relationship_type === 'partner';
    const scarce     = overlapCountNext30(userId, c.other_user_id) <= SCARCITY_THRESHOLD;

    // Top 3 venue picks for this person on this date.
    const picks = venues
      .filter(o => cats.length === 0 || cats.includes(o.category))
      .slice(0, 3);

    for (const v of picks) {
      const lead = isPartner
        ? `You & ${c.other_name} are both free — ${v.title}`
        : `${c.other_name} is free too — ${v.title}`;
      cards.push(decorateCard(v, {
        reason_type:     'relational',
        lead_reason:     lead,
        is_pulse_worthy: !isPartner && scarce,    // partner overlaps don't pulse
        connection_ids:  [c.id],
        // Score: partner=highest, then friend; nudged by scarcity for friends.
        match_score:     isPartner ? 1.0 : (scarce ? 0.92 : 0.85),
      }));
    }
  }

  // Partner cards first, then by score.
  cards.sort((a, b) => b.match_score - a.match_score);
  return cards;
}

// Bucket B — dated events on this exact date. Pulse-worthy by definition.
function getEventIdeas(userId, date, userCats) {
  const allOpps = db.getOpportunitiesForMatching({ from_date: date });
  const events  = allOpps.filter(o => o.start_time && o.start_time.slice(0,10) === date);
  if (!events.length) return [];

  // For tagging "friend also free": precompute overlapping connections for date.
  let overlappingFriends = [];
  if (isKidFreeOn(userId, date)) {
    overlappingFriends = db.getActiveSocialConnections(userId)
      .filter(c => isKidFreeOn(c.other_user_id, date));
  }
  const friendNote = overlappingFriends.length
    ? ` · ${overlappingFriends.map(f => f.other_name).slice(0,2).join(' & ')} free too`
    : '';
  const friendIds = overlappingFriends.map(f => f.id);

  return events.map(o => {
    const matches = userCats.length === 0 || userCats.includes(o.category);
    const lead    = matches
      ? `${o.title} — fits your vibe${friendNote}`
      : `${o.title}${friendNote}`;
    return decorateCard(o, {
      reason_type:     'event',
      lead_reason:     lead,
      is_pulse_worthy: true,
      connection_ids:  friendIds,
      match_score:     matches ? 0.80 : 0.60,
    });
  }).sort((a, b) => b.match_score - a.match_score);
}

// Bucket C — solo / vibe fallback. Only used when A and B are empty for the
// requested date. Surfaces top user-pref venue/activity matches, no time anchor.
// When the user hasn't set any activity prefs yet, fall back to a base score
// so we still surface generic ideas instead of an empty list.
function getSoloIdeas(userId, userCats, limit = 5) {
  const allOpps  = db.getOpportunitiesForMatching({ from_date: fmt(new Date()) });
  const venues   = allOpps.filter(o => !o.start_time);
  const noPrefs  = userCats.length === 0;

  const ranked = venues.map(o => {
    const tags    = JSON.parse(o.tags || '[]');
    const tagHit  = tags.filter(t => userCats.some(c => t.toLowerCase().includes(c))).length;
    const catHit  = userCats.includes(o.category) ? 1 : 0;
    const base    = noPrefs ? 0.15 : 0;
    const score   = base + catHit * 0.6 + Math.min(tagHit, 3) * 0.1 + (o.confidence_score - 0.5) * 0.1;
    return { o, score };
  })
  .filter(x => x.score > 0.05)
  .sort((a, b) => b.score - a.score)
  .slice(0, limit);

  return ranked.map(({ o, score }) => decorateCard(o, {
    reason_type:     'solo',
    lead_reason:     userCats.includes(o.category)
      ? `Matches your ${o.category} vibe`
      : (noPrefs ? 'Worth a look' : 'Might interest you'),
    is_pulse_worthy: false,
    connection_ids:  [],
    match_score:     Math.round(score * 100) / 100,
  }));
}

// ── Public API ───────────────────────────────────────────────────────────────

async function matchForUser(userId, { date = null, limit = 20, category = null, type = null } = {}) {
  const userCats  = userCategories(userId);
  const dismissed = new Set(db.getDismissedOppIds(userId));

  // ── Date-scoped path: bucketed (relational → event → solo fallback) ───────
  if (date) {
    const relational = getRelationalIdeas(userId, date, userCats).filter(c => !dismissed.has(c.id));
    const events     = getEventIdeas(userId, date, userCats).filter(c => !dismissed.has(c.id));
    const solo       = (relational.length === 0 && events.length === 0)
      ? getSoloIdeas(userId, userCats, 5).filter(c => !dismissed.has(c.id))
      : [];

    let cards = [...relational, ...events, ...solo];
    if (category) cards = cards.filter(o => o.category === category);
    if (type)     cards = cards.filter(o => o.type === type);
    return cards.slice(0, limit);
  }

  // ── Legacy non-date path (existing /matches consumers) ────────────────────
  const fromDate = fmt(new Date());
  const opps     = db.getOpportunitiesForMatching({ from_date: fromDate });
  const free     = userFreeDays(userId);

  let results = opps
    .filter(o => !dismissed.has(o.id))
    .map(opp => {
      const { match_score, relevance_reason } = legacyScore(opp, userCats, free);
      return decorateCard(opp, {
        match_score,
        lead_reason: relevance_reason,
        reason_type: opp.start_time ? 'event' : 'solo',
      });
    });

  if (category) results = results.filter(o => o.category === category);
  if (type)     results = results.filter(o => o.type === type);

  return results
    .filter(o => o.match_score > 0.05)
    .sort((a, b) => b.match_score - a.match_score)
    .slice(0, limit);
}

// ── Bulk pulse-dates ─────────────────────────────────────────────────────────
// Returns { 'YYYY-MM-DD': true, ... } for dates in [from, to] that should
// pulse on the month grid. A date pulses if EITHER:
//   • a dated event matches the user (or no prefs) and isn't dismissed; OR
//   • a non-partner social connection has a SCARCE overlap (≤ threshold in
//     next 30 days) and both are kid-free that date.
// Partner overlaps don't pulse — assumed too frequent to be noteworthy.
async function pulseDatesForUser(userId, fromDate, toDate) {
  const dismissed = new Set(db.getDismissedOppIds(userId));
  const userCats  = userCategories(userId);
  const result    = {};

  // ── Event side ───────────────────────────────────────────────────────────
  const opps = db.getOpportunitiesForMatching({ from_date: fromDate });
  for (const o of opps) {
    if (!o.start_time) continue;
    if (dismissed.has(o.id)) continue;
    const day = o.start_time.slice(0, 10);
    if (day < fromDate || day > toDate) continue;
    const matches = userCats.length === 0 || userCats.includes(o.category);
    if (matches) result[day] = true;
  }

  // ── Friend-overlap side (scarce, non-partner only) ───────────────────────
  const myDays = {};
  for (const r of db.getDaysForUserInRange(userId, fromDate, toDate)) myDays[r.date] = r.owner;

  const conns = db.getActiveSocialConnections(userId);
  for (const c of conns) {
    if (c.relationship_type === 'partner') continue;
    if (overlapCountNext30(userId, c.other_user_id) > SCARCITY_THRESHOLD) continue;

    const friendDays = {};
    for (const r of db.getDaysForUserInRange(c.other_user_id, fromDate, toDate)) friendDays[r.date] = r.owner;

    const start = new Date(fromDate + 'T00:00:00');
    const end   = new Date(toDate   + 'T00:00:00');
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const ds = fmt(d);
      const meFree     = (myDays[ds]     || 'coparent') !== 'self';
      const friendFree = (friendDays[ds] || 'coparent') !== 'self';
      if (meFree && friendFree) result[ds] = true;
    }
  }

  return result;
}

module.exports = { matchForUser, userCategories, pulseDatesForUser };
