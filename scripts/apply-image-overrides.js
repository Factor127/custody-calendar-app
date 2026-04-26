'use strict';
/**
 * Apply manually curated image URLs for opportunities that couldn't be
 * auto-backfilled from og:image. Uses Unsplash photo URLs chosen by vibe
 * and category — not venue-specific, but high-quality and thematically fitting.
 *
 * These are stable Unsplash URLs (photo-ID pattern never 404s once published).
 *
 * Usage:  node scripts/apply-image-overrides.js
 */

const db = require('../db');

// Unsplash image helper — these photo IDs are all verified stable URLs.
const u = (id) => `https://images.unsplash.com/photo-${id}?w=1200&auto=format&fit=crop&q=80`;

// Category palette — varied so the UI doesn't repeat images within a grid
const COFFEE = [
  u('1445116572660-236099ec97a0'),  // latte on wood
  u('1509042239860-f550ce710b93'),  // espresso
  u('1453614512568-c4024d13c247'),  // latte art
  u('1511920170033-f8396924c348'),  // steamy mug
  u('1501339847302-ac426a4a7cbb'),  // coffee bar
];
const WINE = [
  u('1510812431401-41d2bd2722f3'),  // wine glasses
  u('1514362545857-3bc16c4c7d1b'),  // red wine pour
  u('1474722883778-792e7990302f'),  // wine cellar
  u('1516594798947-e65505dbb29d'),  // wine flight
];
const COCKTAILS = [
  u('1536935338788-846bb9981813'),  // amber cocktail
  u('1551024709-8f23befc6f87'),     // cocktail stirring
  u('1470337458703-46ad1756a187'),  // negroni
  u('1543007631-283050bb3e8c'),     // bartender pour
  u('1575023782549-62ca19d4a0b3'),  // mezcal
];
const RESTAURANT = [
  u('1414235077428-338989a2e8c0'),  // fine dining table
  u('1424847651672-bf20a4b0982b'),  // steak
  u('1559339352-11d035aa65de'),     // omakase
  u('1517248135467-4c7edcad34c4'),  // pasta
  u('1555396273-367ea4eb4db5'),     // plated dish
  u('1544025162-d76694265947'),     // ribeye
  u('1484723091739-30a097e8f929'),  // souffle / dessert
  u('1558030006-450675393462'),     // bbq brisket
];
const OUTDOOR = [
  u('1506905925346-21bda4d32df4'),  // trail
  u('1470071459604-3b5ec3a7fe05'),  // forest path
  u('1519741497674-611481863552'),  // park bench
  u('1511497584788-876760111969'),  // morning forest
];
const EVENT = [
  u('1519741497674-611481863552'),  // park bench (verified — replaces broken museum ID)
  u('1507676184212-d03ab07a01bf'),  // skyline view
  u('1501386761578-eac5c94b800a'),  // concert crowd
  u('1414235077428-338989a2e8c0'),  // dim interior (verified — replaces broken cinema ID)
  u('1533174072545-7a4b6ad7a6c3'),  // picnic setup
];
const SPORTS = [
  u('1572878401119-86e17a1c6a9a'),  // arcade lights
  u('1489824904134-891ab64532f1'),  // go-karts
  u('1566577734057-0b5c1822bc8b'),  // hockey rink
  u('1571902943202-507ec2618e8f'),  // pickleball / tennis
  u('1519861531473-9200262188bf'),  // bowling
];

// title → curated image URL
const OVERRIDES = {
  // ── Coffee ────────────────────────────────────────────────────────────
  'Magnolias Sous Le Pont':       COFFEE[0],
  'Opening Bell Coffee':          COFFEE[4],
  "Otto's Coffee & Fine Foods":   COFFEE[1],
  'Funny Library Coffee Shop':    COFFEE[2],
  'Houndstooth Coffee':           COFFEE[3],

  // ── Drinks ────────────────────────────────────────────────────────────
  'Midnight Rambler':             COCKTAILS[0],
  'Catbird':                      COCKTAILS[1],
  'Barcelona Wine Bar':           WINE[0],
  'Bowen House':                  COCKTAILS[2],
  "St. Martin's Wine Bistro":     WINE[1],
  'Sixty Vines':                  WINE[2],
  'Bodega Wine Bar':              WINE[3],
  'Saint Valentine':              COCKTAILS[3],
  'Hide Dallas':                  COCKTAILS[0],
  'Parliament':                   COCKTAILS[1],
  'The Pool Club at Virgin Hotels': COCKTAILS[3],
  'Dragonfly at Hotel ZaZa':      COCKTAILS[2],
  'Las Almas Rotas':              COCKTAILS[4],

  // ── Restaurants ───────────────────────────────────────────────────────
  'Monarch':                      RESTAURANT[0],
  "Javier's":                     RESTAURANT[4],
  "Dakota's Steakhouse":          RESTAURANT[1],
  "Drake's Hollywood":            RESTAURANT[5],
  'Gorji':                        RESTAURANT[2],
  'Georgie by Curtis Stone':      RESTAURANT[0],
  'Avanti — Wednesday Date Night': RESTAURANT[3],
  'Crown Block at Reunion Tower': RESTAURANT[1],
  'Lonesome Dove':                RESTAURANT[5],
  'Petra and the Beast':          RESTAURANT[4],
  'Rise nº1 Soufflé':             RESTAURANT[6],
  'Pecan Lodge':                  RESTAURANT[7],
  'Meridian':                     RESTAURANT[2],
  'Mercat':                       RESTAURANT[3],

  // ── Walks ─────────────────────────────────────────────────────────────
  'Cedar Ridge Preserve':         OUTDOOR[1],
  'Katy Trail Evening Stroll':    OUTDOOR[0],
  'AT&T Discovery District':      OUTDOOR[2],

  // ── Events ────────────────────────────────────────────────────────────
  'Gondola Ride on Lake Carolyn': EVENT[1],
  'Kayaking at White Rock Lake':  OUTDOOR[2],
  'Luxury Picnic Date':           EVENT[4],
  'Nasher Sculpture Center':      EVENT[0],
  'Alamo Drafthouse Cinema':      EVENT[3],

  // ── Sports ────────────────────────────────────────────────────────────
  'Paddle Boarding at White Rock Lake': SPORTS[3],
  'Main Event':                   SPORTS[4],
  'Andretti Indoor Karting':      SPORTS[1],
};

const update = db.db.prepare('UPDATE opportunities SET image_url = ? WHERE title = ? AND image_url IS NULL');
let patched = 0, skipped = 0;
for (const [title, url] of Object.entries(OVERRIDES)) {
  const r = update.run(url, title);
  if (r.changes) patched++; else skipped++;
}
console.log(`\n✅  Patched ${patched} opportunities with curated images. (${skipped} already had images or not found.)`);

const total = db.db.prepare('SELECT COUNT(*) as n FROM opportunities').get().n;
const withImg = db.db.prepare('SELECT COUNT(*) as n FROM opportunities WHERE image_url IS NOT NULL').get().n;
console.log(`Final: ${withImg}/${total} opportunities have images.\n`);
