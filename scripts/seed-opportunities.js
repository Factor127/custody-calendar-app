'use strict';
/**
 * Seed the opportunities table with curated DFW date spots.
 *
 * Usage:  node scripts/seed-opportunities.js
 *
 * Safe to run multiple times — skips any title that already exists.
 */
 
const db = require('../db');
const { randomUUID } = require('crypto');
 
const spots = [
 
  // ═══════════════════════════════════════════════════════════════════════════
  // COFFEE  (category: 'coffee')
  // ═══════════════════════════════════════════════════════════════════════════
  {
    title: 'Magnolias Sous Le Pont',
    type: 'venue',
    category: 'coffee',
    tags: ['coffee','cozy','french','downtown'],
    location_name: '2727 Harwood St, Dallas',
    price_tier: 'low',
    source_url: 'https://www.dmagazine.com/guides/best-dallas-coffee-shops-and-roasters/'
  },
  {
    title: 'Opening Bell Coffee',
    type: 'venue',
    category: 'coffee',
    tags: ['coffee','live music','beer','wine'],
    location_name: 'South Side on Lamar, Dallas',
    price_tier: 'low',
    source_url: 'https://www.dmagazine.com/guides/best-dallas-coffee-shops-and-roasters/'
  },
  {
    title: "Otto's Coffee & Fine Foods",
    type: 'venue',
    category: 'coffee',
    tags: ['coffee','upscale','hotel','downtown'],
    location_name: 'The Adolphus Hotel, Dallas',
    price_tier: 'low',
    source_url: 'https://www.dmagazine.com/guides/best-dallas-coffee-shops-and-roasters/'
  },
  {
    title: 'Funny Library Coffee Shop',
    type: 'venue',
    category: 'coffee',
    tags: ['coffee','quirky','arts district'],
    location_name: 'Virgin Hotel, Dallas Arts District',
    price_tier: 'low',
    source_url: 'https://www.dmagazine.com/guides/best-dallas-coffee-shops-and-roasters/'
  },
  {
    title: 'Houndstooth Coffee',
    type: 'venue',
    category: 'coffee',
    tags: ['coffee','specialty','modern'],
    location_name: '1900 N Henderson Ave, Dallas',
    price_tier: 'low',
    source_url: 'https://www.dmagazine.com/guides/best-dallas-coffee-shops-and-roasters/'
  },
 
  // ═══════════════════════════════════════════════════════════════════════════
  // DRINKS  (category: 'drinks')
  // ═══════════════════════════════════════════════════════════════════════════
  {
    title: 'Midnight Rambler',
    type: 'venue',
    category: 'drinks',
    tags: ['cocktails','speakeasy','underground','romantic'],
    location_name: 'The Joule Hotel, 1530 Main St, Dallas',
    price_tier: 'medium',
    source_url: 'https://dallasnav.com/best-cocktail-bars-in-dallas'
  },
  {
    title: 'Catbird',
    type: 'venue',
    category: 'drinks',
    tags: ['rooftop','cocktails','skyline views','upscale'],
    location_name: 'Thompson Hotel, 10th Floor, Dallas',
    price_tier: 'high',
    source_url: 'https://dallasnav.com/best-cocktail-bars-in-dallas'
  },
  {
    title: 'Barcelona Wine Bar',
    type: 'venue',
    category: 'drinks',
    tags: ['wine','tapas','cozy','patio'],
    location_name: 'Henderson Ave, Dallas',
    price_tier: 'medium',
    source_url: 'https://www.datenightdallas.com/11-of-the-best-wine-bars-in-dallas/'
  },
  {
    title: 'Bowen House',
    type: 'venue',
    category: 'drinks',
    tags: ['cocktails','victorian','intimate','chandeliers'],
    location_name: 'Uptown, Dallas',
    price_tier: 'medium',
    source_url: 'https://www.dallasites101.com/blog/post/the-most-romantic-restaurants-in-dallas/'
  },
  {
    title: "St. Martin's Wine Bistro",
    type: 'venue',
    category: 'drinks',
    tags: ['wine','piano','european','classy'],
    location_name: 'Dallas',
    price_tier: 'medium',
    source_url: 'https://dallasnav.com/best-wine-bars-in-dallas'
  },
  {
    title: 'Sixty Vines',
    type: 'venue',
    category: 'drinks',
    tags: ['wine on tap','napa style','uptown'],
    location_name: 'Uptown, Dallas',
    price_tier: 'medium',
    source_url: 'https://dallasnav.com/best-wine-bars-in-dallas'
  },
  {
    title: 'Bodega Wine Bar',
    type: 'venue',
    category: 'drinks',
    tags: ['wine','cozy','relaxed','east dallas'],
    location_name: 'East Dallas',
    price_tier: 'low',
    source_url: 'https://dallasnav.com/best-wine-bars-in-dallas'
  },
  {
    title: 'Saint Valentine',
    type: 'venue',
    category: 'drinks',
    tags: ['cocktails','retro','award-winning','east dallas'],
    location_name: 'East Dallas',
    price_tier: 'medium',
    source_url: 'https://dallasnav.com/best-cocktail-bars-in-dallas'
  },
 
  // ═══════════════════════════════════════════════════════════════════════════
  // RESTAURANTS  (category: 'restaurants')
  // ═══════════════════════════════════════════════════════════════════════════
  {
    title: 'Monarch',
    type: 'venue',
    category: 'restaurants',
    tags: ['italian','skyline views','49th floor','upscale'],
    location_name: 'Thompson Hotel, 49th Floor, Dallas',
    price_tier: 'high',
    source_url: 'https://diningout.com/dallas/the-13-most-romantic-restaurants-in-dallas/'
  },
  {
    title: 'Mercat',
    type: 'venue',
    category: 'restaurants',
    tags: ['french','bistro','romantic','warm'],
    location_name: 'Dallas',
    price_tier: 'high',
    source_url: 'https://www.dallasites101.com/blog/post/the-most-romantic-restaurants-in-dallas/'
  },
  {
    title: "Javier's",
    type: 'venue',
    category: 'restaurants',
    tags: ['mexican','upscale','cigar bar','lush'],
    location_name: 'Knox-Henderson, Dallas',
    price_tier: 'high',
    source_url: 'https://www.dallasites101.com/blog/post/the-most-romantic-restaurants-in-dallas/'
  },
  {
    title: "Dakota's Steakhouse",
    type: 'venue',
    category: 'restaurants',
    tags: ['steakhouse','intimate','classic','underground'],
    location_name: '600 N Akard St, Dallas',
    price_tier: 'high',
    source_url: 'https://www.dallasites101.com/blog/post/the-most-romantic-restaurants-in-dallas/'
  },
  {
    title: "Drake's Hollywood",
    type: 'venue',
    category: 'restaurants',
    tags: ['speakeasy','sexy','red leather','intimate'],
    location_name: 'Dallas',
    price_tier: 'high',
    source_url: 'https://diningout.com/dallas/the-13-most-romantic-restaurants-in-dallas/'
  },
  {
    title: 'Gorji',
    type: 'venue',
    category: 'restaurants',
    tags: ['mediterranean','prix fixe','intimate','5 tables'],
    location_name: 'Dallas',
    price_tier: 'high',
    source_url: 'https://www.dallasites101.com/blog/post/the-most-romantic-restaurants-in-dallas/'
  },
  {
    title: 'Georgie by Curtis Stone',
    type: 'venue',
    category: 'restaurants',
    tags: ['european','sustainable','elegant','velvet'],
    location_name: 'Highland Park Village, Dallas',
    price_tier: 'high',
    source_url: 'https://diningout.com/dallas/the-13-most-romantic-restaurants-in-dallas/'
  },
  {
    title: 'Avanti — Wednesday Date Night',
    type: 'venue',
    category: 'restaurants',
    tags: ['italian','date night deal','wine','piano'],
    location_name: 'Uptown, Dallas',
    price_tier: 'medium',
    source_url: 'https://www.dmagazine.com/guides/55-date-ideas-in-dallas-and-beyond/'
  },
  {
    title: 'Crown Block at Reunion Tower',
    type: 'venue',
    category: 'restaurants',
    tags: ['steakhouse','seafood','panoramic views','landmark'],
    location_name: 'Reunion Tower, 300 Reunion Blvd, Dallas',
    price_tier: 'high',
    source_url: 'https://www.dmagazine.com/guides/55-date-ideas-in-dallas-and-beyond/'
  },
  {
    title: 'Lonesome Dove',
    type: 'venue',
    category: 'restaurants',
    tags: ['wild game','steakhouse','stockyards','fort worth'],
    location_name: 'Fort Worth Stockyards',
    price_tier: 'high',
    source_url: 'https://dfwchild.com/30-date-night-spots-open-for-dine-in-around-dfw/'
  },
 
  // ═══════════════════════════════════════════════════════════════════════════
  // WALKS  (category: 'walks')
  // ═══════════════════════════════════════════════════════════════════════════
  {
    title: 'Sunset Walk at White Rock Lake',
    type: 'activity_template',
    category: 'walks',
    tags: ['lake','sunset','skyline views','free','peaceful'],
    location_name: 'White Rock Lake, Dallas',
    price_tier: 'free',
    source_url: 'https://www.dmagazine.com/guides/55-date-ideas-in-dallas-and-beyond/'
  },
  {
    title: 'Katy Trail Evening Stroll',
    type: 'activity_template',
    category: 'walks',
    tags: ['trail','urban','cafes nearby','3.5 miles','free'],
    location_name: 'Katy Trail, Dallas',
    price_tier: 'free',
    source_url: 'https://www.dmagazine.com/guides/55-date-ideas-in-dallas-and-beyond/'
  },
  {
    title: 'Bishop Arts District Walk',
    type: 'activity_template',
    category: 'walks',
    tags: ['boutiques','galleries','string lights','walkable','free'],
    location_name: 'Bishop Arts District, Dallas',
    price_tier: 'free',
    source_url: 'https://incloodiefoodtour.com/8-free-outdoor-dates-in-dallas/'
  },
  {
    title: 'Dallas Arboretum & Botanical Garden',
    type: 'venue',
    category: 'walks',
    tags: ['gardens','lakeside','picnic','photography'],
    location_name: '8525 Garland Rd, Dallas',
    price_tier: 'low',
    source_url: 'https://www.dmagazine.com/guides/55-date-ideas-in-dallas-and-beyond/'
  },
  {
    title: 'Klyde Warren Park',
    type: 'venue',
    category: 'walks',
    tags: ['park','downtown','skyline','food trucks','free'],
    location_name: '2012 Woodall Rodgers Fwy, Dallas',
    price_tier: 'free',
    source_url: 'https://incloodiefoodtour.com/8-free-outdoor-dates-in-dallas/'
  },
  {
    title: 'Cedar Ridge Preserve',
    type: 'venue',
    category: 'walks',
    tags: ['nature','hiking','butterfly garden','600 acres','free'],
    location_name: '7171 Mountain Creek Pkwy, Dallas',
    price_tier: 'free',
    source_url: 'https://incloodiefoodtour.com/8-free-outdoor-dates-in-dallas/'
  },
 
  // ═══════════════════════════════════════════════════════════════════════════
  // EVENTS  (category: 'events')
  // ═══════════════════════════════════════════════════════════════════════════
  {
    title: 'Gondola Ride on Lake Carolyn',
    type: 'activity_template',
    category: 'events',
    tags: ['gondola','romantic','water','serenade'],
    location_name: 'Lake Carolyn, Irving / Las Colinas',
    price_tier: 'medium',
    source_url: 'https://www.dmagazine.com/guides/55-date-ideas-in-dallas-and-beyond/'
  },
  {
    title: 'Kayaking at White Rock Lake',
    type: 'activity_template',
    category: 'events',
    tags: ['kayak','outdoors','sunrise','sunset','lake'],
    location_name: 'White Rock Lake, Dallas',
    price_tier: 'low',
    source_url: 'https://www.dmagazine.com/guides/55-date-ideas-in-dallas-and-beyond/'
  },
  {
    title: 'Texas Discovery Gardens — Butterfly House',
    type: 'venue',
    category: 'events',
    tags: ['butterflies','indoor','year-round','unique'],
    location_name: 'Fair Park, 3601 Martin Luther King Jr Blvd, Dallas',
    price_tier: 'low',
    source_url: 'https://www.dmagazine.com/guides/55-date-ideas-in-dallas-and-beyond/'
  },
  {
    title: 'Live Music in Deep Ellum',
    type: 'activity_template',
    category: 'events',
    tags: ['live music','nightlife','bars','walking'],
    location_name: 'Deep Ellum, Dallas',
    price_tier: 'low',
    source_url: 'https://www.visitdallas.com/events/'
  },
  {
    title: 'Luxury Picnic Date',
    type: 'activity_template',
    category: 'events',
    tags: ['picnic','styled','romantic','outdoor'],
    location_name: 'Various parks, Dallas',
    price_tier: 'medium',
    source_url: 'https://www.dmagazine.com/guides/55-date-ideas-in-dallas-and-beyond/'
  },
 
  // ═══════════════════════════════════════════════════════════════════════════
  // SPORTS  (category: 'sports')
  // ═══════════════════════════════════════════════════════════════════════════
  {
    title: 'Bowl & Barrel',
    type: 'venue',
    category: 'sports',
    tags: ['bowling','upscale','food','drinks'],
    location_name: 'Shops at Park Lane, Dallas',
    price_tier: 'medium',
    source_url: 'https://streetsbeatseats.com/fun-date-ideas-dallas/'
  },
  {
    title: 'Chicken N Pickle',
    type: 'venue',
    category: 'sports',
    tags: ['pickleball','food','casual','fun'],
    location_name: 'Grand Prairie / Grapevine',
    price_tier: 'low',
    source_url: 'https://mycurlyadventures.com/best-active-date-ideas-dallas-for-couples/'
  },
  {
    title: 'Whiskey Hatchet',
    type: 'venue',
    category: 'sports',
    tags: ['axe throwing','cocktails','unique'],
    location_name: 'Dallas',
    price_tier: 'medium',
    source_url: 'https://streetsbeatseats.com/fun-date-ideas-dallas/'
  },
  {
    title: 'Paddle Boarding at White Rock Lake',
    type: 'activity_template',
    category: 'sports',
    tags: ['paddleboard','lake','outdoors','active'],
    location_name: 'White Rock Lake, Dallas',
    price_tier: 'low',
    source_url: 'https://mycurlyadventures.com/best-active-date-ideas-dallas-for-couples/'
  },
  {
    title: 'TopGolf Dallas',
    type: 'venue',
    category: 'sports',
    tags: ['golf','food','drinks','casual'],
    location_name: 'Dallas (multiple locations)',
    price_tier: 'medium',
    source_url: 'https://topgolf.com/us/dallas/'
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // EXPANSION BATCH (2026-04-22) — 25 new cool DFW venues
  // ═══════════════════════════════════════════════════════════════════════════

  // --- Coffee ---
  {
    title: 'Ascension Coffee',
    type: 'venue',
    category: 'coffee',
    tags: ['coffee','wine','brunch','design district','photogenic'],
    location_name: 'Design District / Highland Park Village, Dallas',
    price_tier: 'low',
    source_url: 'https://ascensioncoffee.com/'
  },
  {
    title: 'La La Land Kind Cafe',
    type: 'venue',
    category: 'coffee',
    tags: ['coffee','aesthetic','greenville','instagram','mission-driven'],
    location_name: '5626 Bell Ave, Dallas',
    price_tier: 'low',
    source_url: 'https://www.lalalandkindcafe.com/'
  },

  // --- Drinks ---
  {
    title: 'Hide Dallas',
    type: 'venue',
    category: 'drinks',
    tags: ['cocktails','award-winning','deep ellum','craft','dark'],
    location_name: '2816 Elm St, Deep Ellum, Dallas',
    price_tier: 'medium',
    source_url: 'https://hide.dallas/'
  },
  {
    title: 'Parliament',
    type: 'venue',
    category: 'drinks',
    tags: ['cocktails','extensive menu','uptown','lounge','date night'],
    location_name: '2418 Allen St, Uptown, Dallas',
    price_tier: 'medium',
    source_url: 'https://parliamentbar.com/'
  },
  {
    title: 'The Pool Club at Virgin Hotels',
    type: 'venue',
    category: 'drinks',
    tags: ['rooftop','pool','skyline','cocktails','arts district'],
    location_name: 'Virgin Hotels Dallas, 1445 Turtle Creek Blvd',
    price_tier: 'high',
    source_url: 'https://virginhotels.com/dallas/drink-and-dine/the-pool-club/'
  },
  {
    title: 'Dragonfly at Hotel ZaZa',
    type: 'venue',
    category: 'drinks',
    tags: ['cocktails','hotel bar','romantic','uptown','patio'],
    location_name: 'Hotel ZaZa, 2332 Leonard St, Dallas',
    price_tier: 'high',
    source_url: 'https://www.hotelzaza.com/dallas/dining/dragonfly-restaurant-dallas/'
  },
  {
    title: 'Las Almas Rotas',
    type: 'venue',
    category: 'drinks',
    tags: ['mezcal','tequila','agave','east dallas','unique'],
    location_name: '3615 Parry Ave, Dallas',
    price_tier: 'medium',
    source_url: 'https://www.lasalmasrotas.com/'
  },

  // --- Restaurants ---
  {
    title: 'Uchi Dallas',
    type: 'venue',
    category: 'restaurants',
    tags: ['japanese','sushi','omakase','uptown','upscale'],
    location_name: '2817 Maple Ave, Uptown, Dallas',
    price_tier: 'high',
    source_url: 'https://uchidallas.com/'
  },
  {
    title: "Nick & Sam's",
    type: 'venue',
    category: 'restaurants',
    tags: ['steakhouse','caviar service','uptown','clubby','upscale'],
    location_name: '3008 Maple Ave, Uptown, Dallas',
    price_tier: 'high',
    source_url: 'https://www.nick-sams.com/'
  },
  {
    title: 'The Charles',
    type: 'venue',
    category: 'restaurants',
    tags: ['italian','design district','sexy','trendy','cocktails'],
    location_name: '1632 Market Center Blvd, Dallas',
    price_tier: 'high',
    source_url: 'https://thecharlesdallas.com/'
  },
  {
    title: 'Petra and the Beast',
    type: 'venue',
    category: 'restaurants',
    tags: ['chef-driven','wild game','east dallas','james beard','intimate'],
    location_name: '601 N Haskell Ave, Dallas',
    price_tier: 'high',
    source_url: 'https://www.petraandthebeast.com/'
  },
  {
    title: 'Rise nº1 Soufflé',
    type: 'venue',
    category: 'restaurants',
    tags: ['french','soufflé','inwood village','cozy','unique'],
    location_name: '5360 W Lovers Ln, Dallas',
    price_tier: 'medium',
    source_url: 'https://risesouffle.com/'
  },
  {
    title: 'Pecan Lodge',
    type: 'venue',
    category: 'restaurants',
    tags: ['bbq','brisket','deep ellum','iconic','casual'],
    location_name: '2702 Main St, Deep Ellum, Dallas',
    price_tier: 'medium',
    source_url: 'https://pecanlodge.com/'
  },
  {
    title: 'Meridian',
    type: 'venue',
    category: 'restaurants',
    tags: ['mexican american','james beard','casa linda','chef-driven','heritage'],
    location_name: 'Casa Linda Plaza, 9725 Garland Rd, Dallas',
    price_tier: 'high',
    source_url: 'https://www.meridiandallas.com/'
  },

  // --- Walks ---
  {
    title: 'Trinity River Audubon Center',
    type: 'venue',
    category: 'walks',
    tags: ['wetlands','nature','birds','trails','free'],
    location_name: '6500 Great Trinity Forest Way, Dallas',
    price_tier: 'low',
    source_url: 'https://trinityriver.audubon.org/'
  },
  {
    title: 'Arbor Hills Nature Preserve',
    type: 'venue',
    category: 'walks',
    tags: ['hiking','views','plano','prairie','free'],
    location_name: '6701 W Parker Rd, Plano',
    price_tier: 'free',
    source_url: 'https://www.plano.gov/Facilities/Facility/Details/Arbor-Hills-Nature-Preserve-11'
  },
  {
    title: 'AT&T Discovery District',
    type: 'venue',
    category: 'walks',
    tags: ['downtown','media wall','street food','interactive','free'],
    location_name: '208 S Akard St, Downtown Dallas',
    price_tier: 'free',
    source_url: 'https://www.discoverydistrict.com/'
  },

  // --- Events ---
  {
    title: 'Nasher Sculpture Center',
    type: 'venue',
    category: 'events',
    tags: ['art','sculpture','garden','arts district','date spot'],
    location_name: '2001 Flora St, Arts District, Dallas',
    price_tier: 'low',
    source_url: 'https://nashersculpturecenter.org/'
  },
  {
    title: 'Reunion Tower GeO-Deck',
    type: 'venue',
    category: 'events',
    tags: ['observation deck','skyline','landmark','panoramic','downtown'],
    location_name: '300 Reunion Blvd, Dallas',
    price_tier: 'medium',
    source_url: 'https://www.reuniontower.com/geo-deck'
  },
  {
    title: 'The Rustic',
    type: 'venue',
    category: 'events',
    tags: ['live music','outdoor','food','uptown','pat green'],
    location_name: '3656 Howell St, Uptown, Dallas',
    price_tier: 'medium',
    source_url: 'https://therustic.com/dallas/'
  },
  {
    title: 'Alamo Drafthouse Cinema',
    type: 'venue',
    category: 'events',
    tags: ['dinner and movie','cinema','craft beer','dine-in','date night'],
    location_name: '1005 S Lamar St, Cedars, Dallas',
    price_tier: 'medium',
    source_url: 'https://drafthouse.com/dfw'
  },

  // --- Sports ---
  {
    title: 'Cidercade Dallas',
    type: 'venue',
    category: 'sports',
    tags: ['arcade','cider','unlimited play','east dallas','fun'],
    location_name: '2777 Irving Blvd, Dallas',
    price_tier: 'low',
    source_url: 'https://cidercade.com/dallas/'
  },
  {
    title: 'Main Event',
    type: 'venue',
    category: 'sports',
    tags: ['bowling','arcade','laser tag','food','casual'],
    location_name: 'Multiple DFW locations',
    price_tier: 'medium',
    source_url: 'https://www.mainevent.com/'
  },
  {
    title: 'Andretti Indoor Karting',
    type: 'venue',
    category: 'sports',
    tags: ['go-karts','arcade','racing','grand prairie','thrill'],
    location_name: '1201 N Watson Rd, Grand Prairie',
    price_tier: 'medium',
    source_url: 'https://andrettikarting.com/locations/grandprairie-texas/'
  },
  {
    title: 'Dallas Stars at American Airlines Center',
    type: 'event',
    category: 'sports',
    tags: ['hockey','nhl','arena','victory green','date night'],
    location_name: '2500 Victory Ave, Dallas',
    price_tier: 'medium',
    source_url: 'https://www.nhl.com/stars'
  },
];
 
// ── Insert logic ───────────────────────────────────────────────────────────
let inserted = 0;
let skipped  = 0;
 
for (const s of spots) {
  // Deduplicate by title
  const existing = db.textSearchOpportunities(s.title);
  if (existing.some(e => e.title === s.title)) {
    skipped++;
    continue;
  }
 
  db.createOpportunity(
    randomUUID(),
    s.title,
    s.type,
    s.category,
    JSON.stringify(s.tags),
    s.start_time || null,
    s.end_time   || null,
    s.location_name || null,
    s.location_lat  || null,
    s.location_lng  || null,
    s.price_tier || null,
    'manual',           // source_type
    null,               // source_domain
    s.source_url || null,
    0.85,               // confidence_score — manual curation = high confidence
    'public',           // visibility
    'admin'             // created_by
  );
  inserted++;
}
 
console.log(`\n✅  Seeded ${inserted} opportunities (${skipped} duplicates skipped)`);
console.log(`   Total in DB: ${db.textSearchOpportunities('').length || '(run a count query to check)'}\n`);
 