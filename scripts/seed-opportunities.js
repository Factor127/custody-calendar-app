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
    source_url: 'https://streetsbeatseats.com/fun-date-ideas-dallas/'
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
 