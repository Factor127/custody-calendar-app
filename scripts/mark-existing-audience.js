'use strict';
/**
 * Mark each of the existing (non-kids-batch) opportunities with an audience:
 *   'adults' = bars, fine dining, date-night spots
 *   'all'    = parks, casual restaurants, family-friendly venues that work for both
 *   'kids'   = primarily kid-focused (rare among existing — none, but supported)
 *
 * Idempotent — safe to re-run. Only touches venues whose title is in the map
 * below, so it won't clobber any future audience assignments.
 *
 * Usage:  node scripts/mark-existing-audience.js
 */

const db = require('../db');

// All-audience: works equally for date night AND family outings
const ALL = [
  'Klyde Warren Park',
  'Dallas Arboretum & Botanical Garden',
  'White Rock Lake — Sunset Walk',
  'Sunset Walk at White Rock Lake',
  'Katy Trail Evening Stroll',
  'Bishop Arts District Walk',
  'Cedar Ridge Preserve',
  'Trinity River Audubon Center',
  'Arbor Hills Nature Preserve',
  'AT&T Discovery District',
  'Reunion Tower GeO-Deck',
  'Texas Discovery Gardens — Butterfly House',
  'Pecan Lodge',
  'Live Music in Deep Ellum',
  'Alamo Drafthouse Cinema',
  'TopGolf Dallas',
  'Bowl & Barrel',
  'Main Event',
  'Chicken N Pickle',
  'Cidercade Dallas',
  'Andretti Indoor Karting',
  'Dallas Stars at American Airlines Center',
  'Paddle Boarding at White Rock Lake',
  'Kayaking at White Rock Lake',
  'Magnolias Sous Le Pont',
  'Opening Bell Coffee',
  'Houndstooth Coffee',
  'Ascension Coffee',
  'La La Land Kind Cafe',
];

// Adults: 21+ vibe, date-night focused, not appropriate / not appealing for kids
const ADULTS = [
  // coffee with adult-only vibe
  "Otto's Coffee & Fine Foods",
  'Funny Library Coffee Shop',
  // drinks - all
  'Midnight Rambler', 'Catbird', 'Barcelona Wine Bar', 'Bowen House',
  "St. Martin's Wine Bistro", 'Sixty Vines', 'Bodega Wine Bar', 'Saint Valentine',
  'Hide Dallas', 'Parliament', 'The Pool Club at Virgin Hotels',
  'Dragonfly at Hotel ZaZa', 'Las Almas Rotas',
  // restaurants - upscale / romantic
  'Monarch', 'Mercat', "Javier's", "Dakota's Steakhouse", "Drake's Hollywood",
  'Gorji', 'Georgie by Curtis Stone', 'Avanti — Wednesday Date Night',
  'Crown Block at Reunion Tower', 'Lonesome Dove', 'Uchi Dallas',
  "Nick & Sam's", 'The Charles', 'Petra and the Beast',
  'Rise nº1 Soufflé', 'Meridian',
  // events - adult
  'Gondola Ride on Lake Carolyn', 'Luxury Picnic Date',
  'Nasher Sculpture Center', 'The Rustic',
  // sports - adult
  'Whiskey Hatchet',
];

const upd = db.db.prepare('UPDATE opportunities SET audience = ? WHERE title = ? AND (audience IS NULL OR audience != ?)');

let nAll = 0, nAdults = 0, missing = [];
for (const t of ALL) {
  const r = upd.run('all', t, 'all');
  if (r.changes) nAll++; else if (!db.db.prepare('SELECT 1 FROM opportunities WHERE title=?').get(t)) missing.push(t);
}
for (const t of ADULTS) {
  const r = upd.run('adults', t, 'adults');
  if (r.changes) nAdults++; else if (!db.db.prepare('SELECT 1 FROM opportunities WHERE title=?').get(t)) missing.push(t);
}

console.log(`\n✅  Marked audience: ${nAll} 'all', ${nAdults} 'adults'.`);
if (missing.length) {
  console.log(`\n⚠️   ${missing.length} titles in script but missing from DB:`);
  missing.forEach(t => console.log(`     - ${t}`));
}

// Report any opportunity STILL missing audience (caught by sync orchestrator)
const unmarked = db.db.prepare('SELECT title FROM opportunities WHERE audience IS NULL').all();
if (unmarked.length) {
  console.log(`\n⚠️   ${unmarked.length} opportunities still have audience=NULL:`);
  unmarked.forEach(r => console.log(`     - ${r.title}`));
}
