'use strict';
const db = require('../db');
const { CHIP_TO_CAT } = require('./opportunityIngestion');

// Map user's activity chip preferences to opportunity categories
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

// User's free days (next 60) — simplified: no kids + not a work day
function userFreeDays(userId) {
  const today = new Date(); today.setHours(0,0,0,0);
  const end   = new Date(today); end.setDate(today.getDate() + 60);
  const fmt   = d => d.toISOString().slice(0,10);

  const rows  = db.getDaysForUserInRange(userId, fmt(today), fmt(end));
  const byDate = {};
  for (const r of rows) byDate[r.date] = r.owner;

  const free = [];
  for (let i = 0; i < 60; i++) {
    const d  = new Date(today); d.setDate(today.getDate() + i);
    const ds = fmt(d);
    if ((byDate[ds] || 'coparent') !== 'self') free.push(ds); // no kids = free
  }
  return new Set(free);
}

function matchScore(opp, userCats, freeDays) {
  let score = 0;
  const reasons = [];
  const oppTags = JSON.parse(opp.tags || '[]');

  // Category match
  if (userCats.includes(opp.category)) {
    score += 0.40;
    reasons.push(`matches your ${opp.category} interest`);
  } else if (userCats.length === 0) {
    // No prefs set yet — show everything with lower base score
    score += 0.15;
  }

  // Tag overlap
  const overlap = oppTags.filter(t => userCats.some(c => t.toLowerCase().includes(c))).length;
  if (overlap > 0) {
    score += 0.15 * Math.min(overlap, 3);
    reasons.push(`${overlap} matching tags`);
  }

  // Time window match
  if (opp.start_time) {
    const oppDay = opp.start_time.slice(0,10);
    if (freeDays.has(oppDay)) {
      score += 0.35;
      reasons.push("you're free that day");
    }
  } else {
    // Venue / activity template — always potentially relevant
    score += 0.10;
  }

  // Confidence boost
  score += (opp.confidence_score - 0.5) * 0.10;

  return {
    match_score:      Math.min(1, Math.max(0, Math.round(score * 100) / 100)),
    relevance_reason: reasons.join(' · ') || 'might interest you'
  };
}

async function matchForUser(userId, { limit = 20, category = null, type = null } = {}) {
  const fromDate = new Date().toISOString().slice(0,10);
  const opps     = db.getOpportunitiesForMatching({ from_date: fromDate });
  const cats     = userCategories(userId);
  const free     = userFreeDays(userId);

  let results = opps.map(opp => {
    const { match_score, relevance_reason } = matchScore(opp, cats, free);
    return {
      ...opp,
      tags:           JSON.parse(opp.tags || '[]'),
      match_score,
      relevance_reason
    };
  });

  if (category) results = results.filter(o => o.category === category);
  if (type)     results = results.filter(o => o.type === type);

  return results
    .filter(o => o.match_score > 0.05)
    .sort((a, b) => b.match_score - a.match_score)
    .slice(0, limit);
}

module.exports = { matchForUser, userCategories };
