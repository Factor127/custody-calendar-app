'use strict';
const express = require('express');
const router  = express.Router();
const { db, q } = require('../db');

function requireToken(req, res) {
  const token = req.query.token || req.body?.token;
  if (!token) { res.status(401).json({ error: 'Missing token' }); return null; }
  const user = q.getUserByToken.get(token);
  if (!user)  { res.status(401).json({ error: 'Invalid token' }); return null; }
  return user;
}

// Prepared once at module load
const lastOutingStmt = db.prepare(`
  SELECT MAX(o.date) AS last_date
  FROM outings o
  JOIN outing_invitees oi ON oi.outing_id = o.id
  WHERE o.created_by = ? AND oi.user_id = ? AND o.date < ?
`);

// Activity pools by primary relationship type
const POOLS = {
  partner: [
    { emoji: '🍷', title: 'Dinner date',       category: 'food'          },
    { emoji: '🎭', title: 'Show or theatre',   category: 'arts'          },
    { emoji: '🌅', title: 'Day trip',           category: 'outdoors'      },
    { emoji: '🎵', title: 'Concert or gig',     category: 'music'         },
    { emoji: '🍽️', title: 'New restaurant',    category: 'food'          },
    { emoji: '🎪', title: 'Local event',        category: 'entertainment' },
  ],
  coparent: [
    { emoji: '🎡', title: 'Family outing',     category: 'family'        },
    { emoji: '🍕', title: 'Casual lunch',       category: 'food'          },
    { emoji: '🏖️', title: 'Beach or park day', category: 'outdoors'      },
    { emoji: '🎮', title: 'Games night',        category: 'entertainment' },
    { emoji: '🎠', title: 'Theme park',         category: 'family'        },
    { emoji: '🎈', title: 'Kids activity',      category: 'family'        },
  ],
  friend: [
    { emoji: '🍽️', title: 'Dinner out',        category: 'food'          },
    { emoji: '🎬', title: 'Movie night',        category: 'entertainment' },
    { emoji: '🎵', title: 'Live music',         category: 'music'         },
    { emoji: '🥂', title: 'Drinks & catch up', category: 'social'        },
    { emoji: '🎯', title: 'Activity or game',   category: 'sports'        },
    { emoji: '🌿', title: 'Walk or park',       category: 'outdoors'      },
  ],
};

function pickSuggestions(conns) {
  const types = conns.map(c => c.relationship_type || 'friend');
  let pool;
  if (types.includes('partner') && !types.includes('coparent')) pool = POOLS.partner;
  else if (types.includes('coparent'))                          pool = POOLS.coparent;
  else                                                          pool = POOLS.friend;

  // Light daily rotation so users see variety
  const seed = new Date().getDate() % pool.length;
  const picks = [];
  for (let i = 0; i < 3; i++) picks.push(pool[(seed + i) % pool.length]);
  return picks;
}

// GET /api/smart-suggest?token=...
router.get('/smart-suggest', (req, res) => {
  const me = requireToken(req, res);
  if (!me) return;

  const today       = new Date().toISOString().slice(0, 10);
  const horizon     = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);

  // All approved connections
  const allConns = q.getAllConnectionsForUser
    .all(me.id, me.id, me.id, me.id, me.id, me.id)   // 6 params: 4 CASE WHENs + 2 WHERE
    .filter(c => c.status === 'approved');

  // WHO — scored and ranked
  const who = allConns.map(conn => {
    const relType  = conn.relationship_type || 'friend';
    const relWeight = relType === 'friend' ? 1.0 : relType === 'partner' ? 0.8 : 0.2;

    // Recency: higher = longer since last outing together → higher priority
    let recencyWeight = 1.0;
    try {
      const row = lastOutingStmt.get(me.id, conn.other_user_id, today);
      if (row?.last_date) {
        const days = Math.floor((new Date(today) - new Date(row.last_date)) / 86400000);
        recencyWeight = Math.min(1.0, days / 90);
      }
    } catch(e) { /* outings table may be empty */ }

    const score = relWeight * 0.35 + recencyWeight * 0.45 + 0.5 * 0.20;

    const otherMobile = conn.i_am_target ? conn.requester_mobile : conn.target_mobile;

    return {
      id:      conn.id,
      userId:  conn.other_user_id,
      name:    conn.other_name,
      initial: (conn.other_name || '?')[0].toUpperCase(),
      photo:   conn.other_photo || null,
      type:    relType,
      phone:   otherMobile || null,
      score:   Math.round(score * 100) / 100,
    };
  }).sort((a, b) => b.score - a.score);

  // My free days (where I am NOT looking after kids)
  const myDays = q.getDaysForUserInRange.all(me.id, today, horizon);
  const myFreeDays = myDays.filter(d => d.owner === 'coparent').map(d => d.date);

  // Each connection's free days
  const connFreeDays = {};
  for (const conn of allConns) {
    try {
      const days = q.getDaysForUserInRange.all(conn.other_user_id, today, horizon);
      connFreeDays[conn.id] = days.filter(d => d.owner === 'coparent').map(d => d.date);
    } catch(e) { connFreeDays[conn.id] = []; }
  }

  const suggestions = pickSuggestions(allConns);

  // Recent venues from past outings (for WHAT? quick-pick)
  const recentVenues = db.prepare(
    `SELECT DISTINCT venue, venue_address, venue_place_id
     FROM outings WHERE created_by = ? AND venue IS NOT NULL
     ORDER BY date DESC LIMIT 8`
  ).all(me.id).map(r => ({ name: r.venue, address: r.venue_address || null, placeId: r.venue_place_id || null }));

  res.json({ who, myFreeDays, connFreeDays, suggestions, recentVenues });
});

module.exports = router;
