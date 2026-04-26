'use strict';
/**
 * Second-pass corrections to the kids opportunity batch:
 *   1. Delete Pole Position Raceway Dallas (now a duplicate of K1 Speed via acquisition)
 *   2. Patch URLs for venues whose original URL 404'd or pointed at the wrong place
 *   3. Add 11 verified well-known DFW kids/family attractions to reach 50 in the batch
 *
 * Idempotent — safe to re-run.
 *
 * Usage:  node scripts/seed-kids-opportunities-batch2.js
 */

const db = require('../db');
const { randomUUID } = require('crypto');

// ── 1. Delete duplicate ──────────────────────────────────────────────────
const delPolePos = db.db.prepare("DELETE FROM opportunities WHERE title = 'Pole Position Raceway Dallas'").run();
if (delPolePos.changes) console.log(`  • removed Pole Position Raceway Dallas (duplicate of K1 Speed Carrollton)`);

// ── 2. URL patches for kids venues whose original URL was wrong ──────────
const URL_PATCHES = {
  'LEGOLAND Discovery Center':       'https://www.legolanddiscoverycenter.com/dallas-fw/',
  'Mountasia Family Fun Center':     'https://mountasiafamilyfuncenter.com/',
  'Rainforest Cafe Grapevine':       'https://www.rainforestcafe.com/location/rainforest-cafe-grapevine-mills-tx/',
  "Joe T. Garcia's":                 'https://www.joetgarcias.com/',
};
const updUrl = db.db.prepare('UPDATE opportunities SET source_url = ?, image_url = NULL WHERE title = ?');
let patched = 0;
for (const [t, url] of Object.entries(URL_PATCHES)) {
  if (updUrl.run(url, t).changes) { patched++; console.log(`  • patched URL: ${t}`); }
}

// ── 3. Add 11 verified well-known DFW kids/family attractions ────────────
const NEW_SPOTS = [
  { title: 'Sky Zone Frisco', category: 'sports', audience: 'kids',
    tags: ['trampoline','dodgeball','foam pit','frisco','indoor'],
    location_name: '6101 Preston Rd, Frisco', price_tier: 'medium',
    source_url: 'https://www.skyzone.com/frisco-preston-ridge-tx/' },
  { title: "Andy B's Bowl Social — Denton", category: 'sports', audience: 'all',
    tags: ['bowling','arcade','laser tag','denton','family entertainment'],
    location_name: '4321 S Interstate 35E, Denton', price_tier: 'medium',
    source_url: 'https://www.bowlandybs.com/denton' },
  { title: 'Cedar Hill State Park', category: 'walks', audience: 'all',
    tags: ['state park','swimming','hiking','camping','joe pool lake'],
    location_name: '1570 FM-1382, Cedar Hill', price_tier: 'low',
    source_url: 'https://tpwd.texas.gov/state-parks/cedar-hill' },
  { title: 'Cane Rosso — Bishop Arts', category: 'restaurants', audience: 'all',
    tags: ['pizza','neapolitan','kid-friendly','bishop arts','casual'],
    location_name: '408 W 8th St, Bishop Arts, Dallas', price_tier: 'low',
    source_url: 'https://canerosso.com/' },
  { title: 'Grapevine Vintage Railroad', category: 'events', audience: 'kids',
    tags: ['steam train','historic','grapevine','scenic ride','interactive'],
    location_name: '705 S Main St, Grapevine', price_tier: 'medium',
    source_url: 'https://www.grapevinetexasusa.com/grapevine-vintage-railroad/' },
  { title: 'The Trains at NorthPark', category: 'events', audience: 'kids',
    tags: ['model trains','holiday tradition','northpark','indoor','iconic'],
    location_name: 'NorthPark Center, 8687 N Central Expy, Dallas', price_tier: 'low',
    source_url: 'https://www.northparkcenter.com/' },
  { title: 'Fort Worth Zoo', category: 'events', audience: 'kids',
    tags: ['zoo','animals','top-rated','fort worth','family'],
    location_name: '1989 Colonial Pkwy, Fort Worth', price_tier: 'medium',
    source_url: 'https://www.fortworthzoo.org/' },
  { title: 'Fort Worth Stockyards Cattle Drive', category: 'events', audience: 'all',
    tags: ['cattle drive','western','iconic','free','outdoor','fort worth'],
    location_name: 'E Exchange Ave, Fort Worth', price_tier: 'free',
    source_url: 'https://www.fortworthstockyards.org/' },
  { title: 'AT&T Stadium Tour', category: 'events', audience: 'all',
    tags: ['cowboys','stadium tour','arlington','behind the scenes'],
    location_name: '1 AT&T Way, Arlington', price_tier: 'medium',
    source_url: 'https://attstadium.com/tours/' },
  { title: 'Globe Life Field Tour', category: 'events', audience: 'all',
    tags: ['rangers','baseball','stadium tour','arlington'],
    location_name: '734 Stadium Dr, Arlington', price_tier: 'medium',
    source_url: 'https://www.mlb.com/rangers/ballpark/tours' },
  { title: "Ripley's Believe It or Not! Grand Prairie", category: 'events', audience: 'kids',
    tags: ['oddities','interactive','grand prairie','wax museum','family'],
    location_name: '601 E Palace Pkwy, Grand Prairie', price_tier: 'medium',
    source_url: 'https://www.ripleys.com/grandprairie' },
];

const insertStmt = db.db.prepare(`
  INSERT INTO opportunities
    (id, title, type, category, tags, start_time, end_time,
     location_name, location_lat, location_lng,
     price_tier, source_type, source_domain, source_url,
     confidence_score, visibility, created_by, audience)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
`);

let inserted = 0, skipped = 0;
for (const s of NEW_SPOTS) {
  if (db.db.prepare('SELECT 1 FROM opportunities WHERE title = ?').get(s.title)) { skipped++; continue; }
  insertStmt.run(
    randomUUID(), s.title, 'venue', s.category,
    JSON.stringify(s.tags), null, null,
    s.location_name, null, null,
    s.price_tier, 'manual', null, s.source_url,
    0.85, 'public', 'admin', s.audience
  );
  inserted++;
}

console.log(`\n✅  Patched ${patched} URLs, deleted ${delPolePos.changes} dupes, added ${inserted} new (${skipped} skipped).`);

// Final kids-batch count
const kidsCount = db.db.prepare("SELECT COUNT(*) as n FROM opportunities WHERE audience = 'kids' OR audience = 'all'").get().n;
const total = db.db.prepare('SELECT COUNT(*) as n FROM opportunities').get().n;
console.log(`   kids+all audience: ${kidsCount}, total opportunities: ${total}\n`);
