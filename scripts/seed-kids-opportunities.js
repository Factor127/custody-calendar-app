'use strict';
/**
 * Seed 50 kids/family DFW venues into the opportunities table.
 *
 * Usage:  node scripts/seed-kids-opportunities.js
 *
 * Idempotent — skips any title that already exists.
 * Each entry inserts with audience set ('kids' or 'all').
 */

const db = require('../db');
const { randomUUID } = require('crypto');

// audience: 'kids' = primarily kid/family destination
//           'all'  = great for kids AND works for adults too
const spots = [

  // ═══════════════════════════════════════════════════════════════════════════
  //  MUSEUMS / ANIMALS  (10)
  // ═══════════════════════════════════════════════════════════════════════════
  { title: 'Perot Museum of Nature and Science', category: 'events', audience: 'all',
    tags: ['science','dinosaurs','interactive','iconic','arts district'],
    location_name: '2201 N Field St, Dallas', price_tier: 'medium',
    source_url: 'https://www.perotmuseum.org/' },
  { title: 'Dallas Zoo', category: 'events', audience: 'kids',
    tags: ['zoo','animals','outdoor','giraffes','iconic'],
    location_name: '650 S R.L. Thornton Fwy, Dallas', price_tier: 'medium',
    source_url: 'https://www.dallaszoo.com/' },
  { title: 'Dallas World Aquarium', category: 'events', audience: 'all',
    tags: ['aquarium','rainforest','sloths','penguins','downtown'],
    location_name: '1801 N Griffin St, Dallas', price_tier: 'medium',
    source_url: 'https://dwazoo.com/' },
  { title: 'SEA LIFE Grapevine Aquarium', category: 'events', audience: 'kids',
    tags: ['aquarium','sharks','interactive','grapevine mills'],
    location_name: 'Grapevine Mills, 3000 Grapevine Mills Pkwy', price_tier: 'medium',
    source_url: 'https://www.visitsealife.com/grapevine/' },
  { title: 'LEGOLAND Discovery Center', category: 'events', audience: 'kids',
    tags: ['lego','interactive','rides','grapevine','indoor'],
    location_name: 'Grapevine Mills, 3000 Grapevine Mills Pkwy', price_tier: 'medium',
    source_url: 'https://www.legolanddiscoverycenter.com/dallas-fw/' },
  { title: "Children's Aquarium at Fair Park", category: 'events', audience: 'kids',
    tags: ['aquarium','small','toddler-friendly','fair park','affordable'],
    location_name: '1462 First Ave, Fair Park, Dallas', price_tier: 'low',
    source_url: 'https://childrensaquariumfairpark.com/' },
  { title: 'Frontiers of Flight Museum', category: 'events', audience: 'all',
    tags: ['aviation','aircraft','interactive','love field','history'],
    location_name: '6911 Lemmon Ave, Dallas', price_tier: 'low',
    source_url: 'https://www.flightmuseum.com/' },
  { title: 'Heard Natural Science Museum & Wildlife Sanctuary', category: 'walks', audience: 'all',
    tags: ['nature','dinosaur trail','wildlife','mckinney','outdoor'],
    location_name: '1 Nature Pl, McKinney', price_tier: 'low',
    source_url: 'https://www.heardmuseum.org/' },
  { title: 'Crayola Experience Plano', category: 'events', audience: 'kids',
    tags: ['arts','crafts','colorful','indoor','plano'],
    location_name: 'The Shops at Willow Bend, 6121 W Park Blvd, Plano', price_tier: 'medium',
    source_url: 'https://www.crayolaexperience.com/plano' },
  { title: 'National Videogame Museum', category: 'events', audience: 'all',
    tags: ['video games','retro','arcade','frisco','interactive'],
    location_name: '8004 Dallas Pkwy, Frisco', price_tier: 'low',
    source_url: 'https://nvmusa.org/' },

  // ═══════════════════════════════════════════════════════════════════════════
  //  WATER PARKS  (5)
  // ═══════════════════════════════════════════════════════════════════════════
  { title: 'Hawaiian Falls — The Colony', category: 'sports', audience: 'kids',
    tags: ['waterpark','slides','summer','the colony'],
    location_name: '4400 Paige Rd, The Colony', price_tier: 'medium',
    source_url: 'https://hfalls.com/the-colony/' },
  { title: 'NRH₂O Family Water Park', category: 'sports', audience: 'kids',
    tags: ['waterpark','wave pool','family','north richland hills'],
    location_name: '9001 Boulevard 26, North Richland Hills', price_tier: 'medium',
    source_url: 'https://www.nrh2o.com/' },
  { title: 'Bahama Beach Waterpark', category: 'sports', audience: 'kids',
    tags: ['waterpark','wave pool','south dallas','affordable'],
    location_name: '1895 Campfire Cir, Dallas', price_tier: 'low',
    source_url: 'https://www.dallasparks.org/255/Bahama-Beach-Waterpark' },
  { title: 'Six Flags Hurricane Harbor', category: 'sports', audience: 'kids',
    tags: ['waterpark','slides','arlington','wave pool'],
    location_name: '1800 E Lamar Blvd, Arlington', price_tier: 'high',
    source_url: 'https://www.sixflags.com/hurricaneharbortexas' },
  { title: 'Great Wolf Lodge Waterpark', category: 'sports', audience: 'kids',
    tags: ['indoor waterpark','resort','grapevine','year-round'],
    location_name: '100 Great Wolf Dr, Grapevine', price_tier: 'high',
    source_url: 'https://www.greatwolf.com/grapevine' },

  // ═══════════════════════════════════════════════════════════════════════════
  //  THEME / ADVENTURE PARKS  (5)
  // ═══════════════════════════════════════════════════════════════════════════
  { title: 'Six Flags Over Texas', category: 'events', audience: 'kids',
    tags: ['theme park','roller coasters','arlington','classic'],
    location_name: '2201 E Road to Six Flags St, Arlington', price_tier: 'high',
    source_url: 'https://www.sixflags.com/overtexas' },
  { title: 'Adventure Landing Dallas', category: 'sports', audience: 'kids',
    tags: ['mini golf','go-karts','batting cages','arcade'],
    location_name: '17717 Coit Rd, Dallas', price_tier: 'medium',
    source_url: 'https://www.adventurelanding.com/parks/dallas' },
  { title: 'Zero Gravity Thrill Amusement Park', category: 'sports', audience: 'kids',
    tags: ['extreme rides','bungee','skycoaster','dallas','thrill'],
    location_name: '11131 Malibu Dr, Dallas', price_tier: 'high',
    source_url: 'https://gojump.com/' },
  // (Removed: Adventure Park at Stonebriar — doesn't exist as named.)
  // (Removed: Sandy Lake Amusement Park — permanently closed.)
  // Replacement venues added in seed-kids-opportunities-batch2.js

  // ═══════════════════════════════════════════════════════════════════════════
  //  INDOOR PLAY / TRAMPOLINE  (8)
  // ═══════════════════════════════════════════════════════════════════════════
  { title: 'Urban Air Adventure Park — Dallas', category: 'sports', audience: 'kids',
    tags: ['trampoline','climbing','ropes course','indoor'],
    location_name: 'Multiple DFW locations', price_tier: 'medium',
    source_url: 'https://www.urbanair.com/' },
  { title: 'Altitude Trampoline Park — Frisco', category: 'sports', audience: 'kids',
    tags: ['trampoline','dodgeball','foam pit','frisco'],
    location_name: '6363 Dallas Pkwy, Frisco', price_tier: 'medium',
    source_url: 'https://altitudetrampolinepark.com/locations/frisco-tx/' },
  { title: 'Catch Air Plano', category: 'sports', audience: 'kids',
    tags: ['inflatables','toddler','indoor playground','plano'],
    location_name: '8417 Preston Rd, Plano', price_tier: 'low',
    source_url: 'https://www.catchairparties.com/plano-tx' },
  { title: 'Pinstack Plano', category: 'sports', audience: 'all',
    tags: ['bowling','arcade','laser tag','rock climbing','plano'],
    location_name: '6205 Dallas Pkwy, Plano', price_tier: 'medium',
    source_url: 'https://pinstackbowl.com/plano/' },
  // (Removed: Sky Zone Plano — no Plano location; Sky Zone Frisco added in batch2.)
  // (Removed: Pump It Up Carrollton — closed.)
  // (Removed: Rockin' Jump Frisco — no Frisco location.)
  // (Removed: Monkey Joe's Plano — no Plano location.)

  // ═══════════════════════════════════════════════════════════════════════════
  //  MINI GOLF / KARTING / SKATING  (7)
  // ═══════════════════════════════════════════════════════════════════════════
  { title: 'Mountasia Family Fun Center', category: 'sports', audience: 'kids',
    tags: ['mini golf','go-karts','arcade','batting cages'],
    location_name: '8851 Grapevine Hwy, North Richland Hills', price_tier: 'medium',
    source_url: 'https://mountasiafamilyfuncenter.com/' },
  // (Removed: Pirates Cove Mini Golf Plano — no TX location.)
  // (Removed: Putt-Putt Fun Center Allen — no Allen location.)
  // (Removed: Pole Position Raceway Dallas — acquired by K1 Speed; superseded by next entry.)
  { title: 'K1 Speed Carrollton', category: 'sports', audience: 'all',
    tags: ['indoor karting','electric','racing','carrollton'],
    location_name: '2400 Marsh Ln, Carrollton', price_tier: 'medium',
    source_url: 'https://www.k1speed.com/dallas-location.html' },
  { title: 'Galleria Dallas Ice Skating Center', category: 'sports', audience: 'all',
    tags: ['ice skating','indoor','galleria','dallas'],
    location_name: '13350 Dallas Pkwy, Dallas', price_tier: 'low',
    source_url: 'https://www.galleriaicedallas.com/' },
  { title: 'Dr Pepper StarCenter Public Skating', category: 'sports', audience: 'all',
    tags: ['ice skating','hockey','indoor','multiple locations'],
    location_name: 'Multiple DFW locations', price_tier: 'low',
    source_url: 'https://drpepperstarcenter.com/' },

  // ═══════════════════════════════════════════════════════════════════════════
  //  FAMILY RESTAURANTS  (5)
  // ═══════════════════════════════════════════════════════════════════════════
  { title: 'Rainforest Cafe Grapevine', category: 'restaurants', audience: 'kids',
    tags: ['themed','animatronics','grapevine mills','immersive','family'],
    location_name: 'Grapevine Mills, 3000 Grapevine Mills Pkwy', price_tier: 'medium',
    source_url: 'https://www.rainforestcafe.com/location/rainforest-cafe-grapevine-mills-tx/' },
  { title: "Babe's Chicken Dinner House", category: 'restaurants', audience: 'all',
    tags: ['family-style','fried chicken','roanoke','line dancing','iconic'],
    location_name: '104 N Oak St, Roanoke', price_tier: 'low',
    source_url: 'https://babeschicken.com/' },
  // (Removed: T-Rex Cafe Grapevine — closed/never existed.)
  // (Removed: Mellow Mushroom Lower Greenville — closed 2017.)
  { title: "Joe T. Garcia's", category: 'restaurants', audience: 'all',
    tags: ['mexican','patio','fort worth','iconic','family-style'],
    location_name: '2201 N Commerce St, Fort Worth', price_tier: 'medium',
    source_url: 'https://joets.com/' },

  // ═══════════════════════════════════════════════════════════════════════════
  //  THEATERS & SHOWS  (5)
  // ═══════════════════════════════════════════════════════════════════════════
  { title: "Dallas Children's Theater", category: 'events', audience: 'kids',
    tags: ['theater','live shows','professional','dallas','rotating'],
    location_name: '5938 Skillman St, Dallas', price_tier: 'medium',
    source_url: 'https://dct.org/' },
  { title: "Casa Mañana Children's Theater", category: 'events', audience: 'kids',
    tags: ['theater','musicals','fort worth','family shows'],
    location_name: '3101 W Lancaster Ave, Fort Worth', price_tier: 'medium',
    source_url: 'https://casamanana.org/' },
  { title: 'Eisemann Center Family Series', category: 'events', audience: 'all',
    tags: ['performing arts','family shows','richardson','rotating'],
    location_name: '2351 Performance Dr, Richardson', price_tier: 'medium',
    source_url: 'https://www.eisemanncenter.com/' },
  { title: 'Dallas Symphony Family Concerts', category: 'events', audience: 'all',
    tags: ['symphony','classical','family-friendly','meyerson','arts district'],
    location_name: 'Meyerson Symphony Center, 2301 Flora St, Dallas', price_tier: 'medium',
    source_url: 'https://www.dallassymphony.org/' },
  { title: 'AT&T Performing Arts Center Family Shows', category: 'events', audience: 'all',
    tags: ['performing arts','family shows','arts district','dallas'],
    location_name: '2403 Flora St, Dallas', price_tier: 'medium',
    source_url: 'https://www.attpac.org/' },

  // ═══════════════════════════════════════════════════════════════════════════
  //  OUTDOOR / NATURE FOR KIDS  (5)
  // ═══════════════════════════════════════════════════════════════════════════
  { title: "Dallas Arboretum Children's Adventure Garden", category: 'walks', audience: 'kids',
    tags: ['interactive garden','nature play','kids','arboretum','outdoor'],
    location_name: '8525 Garland Rd, Dallas', price_tier: 'medium',
    source_url: 'https://www.dallasarboretum.org/visit/childrens-adventure-garden/' },
  { title: 'Fort Worth Botanic Garden', category: 'walks', audience: 'all',
    tags: ['gardens','japanese garden','rose garden','fort worth'],
    location_name: '3220 Botanic Garden Blvd, Fort Worth', price_tier: 'low',
    source_url: 'https://www.fwbg.org/' },
  { title: 'Heritage Farmstead Museum Plano', category: 'events', audience: 'kids',
    tags: ['historic farm','animals','plano','interactive','outdoor'],
    location_name: '1900 W 15th St, Plano', price_tier: 'low',
    source_url: 'https://www.heritagefarmstead.org/' },
  { title: 'Carpenter Park Plano', category: 'walks', audience: 'all',
    tags: ['playground','splash pad','plano','huge','free'],
    location_name: '6701 Coit Rd, Plano', price_tier: 'free',
    source_url: 'https://www.plano.gov/Facilities/Facility/Details/Carpenter-Park-13' },
  { title: 'River Legacy Living Science Center', category: 'walks', audience: 'kids',
    tags: ['nature center','aquariums','arlington','interactive','trails'],
    location_name: '703 NW Green Oaks Blvd, Arlington', price_tier: 'low',
    source_url: 'https://riverlegacy.org/' },
];

// ── Insert ────────────────────────────────────────────────────────────────
const insertStmt = db.db.prepare(`
  INSERT INTO opportunities
    (id, title, type, category, tags, start_time, end_time,
     location_name, location_lat, location_lng,
     price_tier, source_type, source_domain, source_url,
     confidence_score, visibility, created_by, audience)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
`);

let inserted = 0, skipped = 0;
for (const s of spots) {
  const dupe = db.db.prepare('SELECT id FROM opportunities WHERE title = ?').get(s.title);
  if (dupe) { skipped++; continue; }

  insertStmt.run(
    randomUUID(),
    s.title,
    s.type || (s.category === 'restaurants' || s.category === 'walks' ? 'venue' : 'venue'),
    s.category,
    JSON.stringify(s.tags || []),
    null, null,
    s.location_name || null,
    null, null,
    s.price_tier || null,
    'manual', null,
    s.source_url || null,
    0.85,
    'public',
    'admin',
    s.audience || 'kids'
  );
  inserted++;
}

console.log(`\n✅  Seeded ${inserted} kids/family opportunities (${skipped} duplicates skipped).`);
console.log(`   Total in DB now: ${db.db.prepare('SELECT COUNT(*) as n FROM opportunities').get().n}\n`);
