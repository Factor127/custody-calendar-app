'use strict';
/**
 * Apply curated Unsplash image fallbacks for kids/family venues that couldn't
 * be auto-backfilled. Uses verified-stable Unsplash photo IDs (HEAD-checked).
 *
 * Usage:  node scripts/apply-kids-image-overrides.js
 */

const db = require('../db');

const u = (id) => `https://images.unsplash.com/photo-${id}?w=1200&auto=format&fit=crop&q=80`;

// All IDs below are confirmed-working from prior backfill runs (HEAD-check passed)
// All IDs HEAD-verified to resolve. Some categories share an image —
// acceptable trade-off vs broken URLs. Replace later as venue-specific
// photos become available.
const PLAYGROUND = u('1571902943202-507ec2618e8f'); // active sports
const BOWLING    = u('1519861531473-9200262188bf'); // bowling lane
const ICE_SKATE  = u('1519861531473-9200262188bf'); // (reused — indoor sport)
const ARCADE     = u('1571902943202-507ec2618e8f'); // (reused — active play)
const MINI_GOLF  = u('1571902943202-507ec2618e8f'); // (reused)
const WATERPARK  = u('1506905925346-21bda4d32df4'); // outdoor / nature
const KARTING    = u('1489824904134-891ab64532f1'); // go-karts
const KIDS_FOOD  = u('1517248135467-4c7edcad34c4'); // pasta
const PARK       = u('1519741497674-611481863552'); // park bench
const MUSEUM     = u('1519741497674-611481863552'); // (reused — quiet/cultural)
const SCIENCE    = u('1519741497674-611481863552'); // (reused)
const AQUARIUM   = u('1506905925346-21bda4d32df4'); // (reused — outdoor/nature)
const ZOO        = u('1506905925346-21bda4d32df4'); // (reused)
const TRAMPOLINE = u('1571902943202-507ec2618e8f'); // (reused — active sport)
const THEATER    = u('1414235077428-338989a2e8c0'); // dim/elegant interior
const STADIUM    = u('1489824904134-891ab64532f1'); // (reused — sport venue)

const OVERRIDES = {
  // Aquariums / animals
  "Children's Aquarium at Fair Park":             AQUARIUM,

  // Museums / interactive
  'Crayola Experience Plano':                     MUSEUM,
  'Frontiers of Flight Museum':                   SCIENCE,
  'Perot Museum of Nature and Science':           SCIENCE,
  'National Videogame Museum':                    ARCADE,

  // Water
  'Bahama Beach Waterpark':                       WATERPARK,
  'Hawaiian Falls — The Colony':                  WATERPARK,

  // Trampoline / indoor play
  'Altitude Trampoline Park — Frisco':            TRAMPOLINE,
  'Catch Air Plano':                              TRAMPOLINE,
  'Sky Zone Frisco':                              TRAMPOLINE,

  // Karting / racing / thrill
  'Zero Gravity Thrill Amusement Park':           KARTING,
  'K1 Speed Carrollton':                          KARTING,
  'Mountasia Family Fun Center':                  MINI_GOLF,

  // Skating
  'Galleria Dallas Ice Skating Center':           ICE_SKATE,
  'Dr Pepper StarCenter Public Skating':          ICE_SKATE,

  // Theaters
  'Casa Mañana Children\'s Theater':              THEATER,
  'Eisemann Center Family Series':                THEATER,
  'AT&T Performing Arts Center Family Shows':     THEATER,

  // Parks / outdoor
  'Carpenter Park Plano':                         PLAYGROUND,
  'Cedar Hill State Park':                        PARK,
  "Dallas Arboretum Children's Adventure Garden": PLAYGROUND,
  'Fort Worth Stockyards Cattle Drive':           ZOO,

  // Stadium tours
  'Globe Life Field Tour':                        STADIUM,

  // Restaurants
  "Babe's Chicken Dinner House":                  KIDS_FOOD,
  'Cane Rosso — Bishop Arts':                     KIDS_FOOD,
  "Joe T. Garcia's":                              KIDS_FOOD,
};

const upd = db.db.prepare('UPDATE opportunities SET image_url = ? WHERE title = ? AND image_url IS NULL');
let n = 0, skipped = 0;
for (const [t, url] of Object.entries(OVERRIDES)) {
  const r = upd.run(url, t);
  if (r.changes) n++; else skipped++;
}
console.log(`\n✅  Applied ${n} kids/family image overrides. (${skipped} already had images or not found.)`);

const total = db.db.prepare('SELECT COUNT(*) as n FROM opportunities').get().n;
const withImg = db.db.prepare('SELECT COUNT(*) as n FROM opportunities WHERE image_url IS NOT NULL').get().n;
console.log(`Final: ${withImg}/${total} opportunities have images.\n`);
