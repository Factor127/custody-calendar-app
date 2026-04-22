'use strict';
const express = require('express');
const router  = express.Router();
const { randomUUID } = require('crypto');
const db = require('../db');

function requireToken(req, res) {
  const token = req.query.token || req.body?.token;
  if (!token) { res.status(401).json({ error: 'Missing token' }); return null; }
  const user = db.getUserByToken(token);
  if (!user)  { res.status(401).json({ error: 'Invalid token' }); return null; }
  return user;
}

// ── Reputation label computation ──────────────────────────────────────────────
const CATEGORY_LABELS = {
  music:     'Music Planner',
  food:      'Food Finder',
  outdoors:  'Outdoors Explorer',
  arts:      'Arts & Culture',
  sports:    'Sports Organiser',
  nightlife: 'Night Owl',
  family:    'Family Planner',
  culture:   'Culture Curator',
  fitness:   'Active Planner',
  comedy:    'Laugh Maker',
  theatre:   'Theatre Lover',
};

function computeReputationLabels(stats) {
  const labels = [];
  const totalOutcomes = stats.reduce((s, r) =>
    s + (r.total_plans || 0) + (r.total_outings || 0), 0);

  // Category-specific labels (need ≥ 2 outcomes in that category)
  for (const s of stats) {
    const outcomes = (s.total_plans || 0) + (s.total_outings || 0);
    const cat = (s.category || '').toLowerCase().trim();
    if (outcomes >= 2 && CATEGORY_LABELS[cat]) {
      labels.push(CATEGORY_LABELS[cat]);
    }
  }

  // Generic labels
  if (totalOutcomes >= 10) labels.unshift('Super Connector');
  else if (totalOutcomes >= 5) labels.unshift('Event Connector');
  else if (totalOutcomes >= 2 && labels.length === 0) {
    labels.push('Good at finding things to do');
  }

  return [...new Set(labels)].slice(0, 3);
}

// ── GET /api/contributions/impact - full impact dashboard ─────────────────────
router.get('/contributions/impact', (req, res) => {
  const me = requireToken(req, res); if (!me) return;
  try {
    const contributions = db.getMyContributions(me.id);
    const recentWins    = db.getRecentWins(me.id);
    const repStats      = db.getReputationStats(me.id);
    const labels        = computeReputationLabels(repStats);
    res.json({ contributions, recentWins, labels });
  } catch(e) {
    console.error('Impact error:', e);
    res.status(500).json({ error: 'Failed to load impact' });
  }
});

// ── POST /api/contributions/event - track view or save ───────────────────────
router.post('/contributions/event', (req, res) => {
  const me = requireToken(req, res); if (!me) return;
  const { opportunity_id, event_type } = req.body;
  if (!opportunity_id || !['viewed', 'saved'].includes(event_type)) {
    return res.status(400).json({ error: 'invalid' });
  }
  db.trackOppEvent(opportunity_id, me.id, event_type);
  if (event_type === 'viewed') db.incOppCounter('incOppViews', opportunity_id);
  if (event_type === 'saved')  db.incOppCounter('incOppSaves', opportunity_id);
  res.json({ ok: true });
});

// ── GET /api/contributions/wins/new?since=ISO - unread wins badge count ───────
router.get('/contributions/wins/new', (req, res) => {
  const me = requireToken(req, res); if (!me) return;
  const since = req.query.since || new Date(Date.now() - 7 * 86400000).toISOString();
  const count = db.getNewWinsCount(me.id, since);
  res.json({ count });
});

module.exports = router;
