'use strict';
/**
 * Update source_url for opportunities to point at the venue's own website
 * (rather than a listicle). Then clear image_url so the next backfill run
 * picks up a venue-specific og:image instead of the listicle hero.
 *
 * Usage:  node scripts/update-opportunity-sources.js
 */

const db = require('../db');

// title → official site URL  (verified to resolve to the correct DFW venue)
const OFFICIAL_URLS = {
  // Coffee
  'Magnolias Sous Le Pont':      'https://www.magnoliasdallas.com/',
  'Opening Bell Coffee':         'https://www.openingbellcoffee.com/',
  "Otto's Coffee & Fine Foods":  'https://www.ottoscoffeeandfinefoods.com/',
  'Funny Library Coffee Shop':   'https://virginhotels.com/dallas/drink-and-dine/funny-library-coffee-shop/',
  'Houndstooth Coffee':          'https://houndstoothcoffee.com/',

  // Drinks
  'Midnight Rambler':            'https://midnightramblerbar.com/',
  'Catbird':                     'https://www.catbirddallas.com/',
  'Barcelona Wine Bar':          'https://barcelonawinebar.com/location/dallas-henderson/',
  'Bowen House':                 'https://www.yelp.com/biz/bowen-house-dallas-2',
  "St. Martin's Wine Bistro":    'https://stmartinswinebistro.com/',
  'Sixty Vines':                 'https://sixtyvines.com/locations/uptown-dallas/',
  'Bodega Wine Bar':             'https://bodegawinebar.square.site/',
  'Saint Valentine':             'https://saintvalentinedtx.com/',
  'Hide Dallas':                 'https://hide.bar/',
  'Parliament':                  'https://www.parliamentdallas.com/',
  'Dragonfly at Hotel ZaZa':     'https://www.hotelzaza.com/dallas/',

  // Restaurants
  'Monarch':                     'https://www.monarchrestaurant.com/',
  'Mercat':                      'https://www.mercatbistro.com/',
  "Javier's":                    'https://javiers.net/dallas/',
  "Dakota's Steakhouse":         'https://www.dakotasrestaurant.com/',
  "Drake's Hollywood":           'https://www.drakeshollywood.com/location/drakes-hollywood/',
  'Gorji':                       'https://www.gorjirestaurant.com/',
  'Georgie by Curtis Stone':     'https://www.tripadvisor.com/Restaurant_Review-g55711-d19764418-Reviews-Georgie_by_Curtis_Stone-Dallas_Texas.html',
  'Avanti — Wednesday Date Night': 'https://avantirestaurants.com/',
  'Crown Block at Reunion Tower':  'https://www.crownblock.com/',
  'Lonesome Dove':               'https://lonesomedovebistro.com/',
  'Petra and the Beast':         'https://www.petraandthebeast.com/',

  // Walks / outdoor
  'Sunset Walk at White Rock Lake': 'https://www.whiterocklakefoundation.org/',
  'Katy Trail Evening Stroll':   'https://www.katytraildallas.org/',
  'Bishop Arts District Walk':   'https://bishopartsdistrict.com/',
  'Dallas Arboretum & Botanical Garden': 'https://www.dallasarboretum.org/',
  'Klyde Warren Park':           'https://www.klydewarrenpark.org/',
  'Cedar Ridge Preserve':        'https://audubondallas.org/cedar-ridge-preserve/',
  'Arbor Hills Nature Preserve': 'https://visitplano.com/listings/arbor-hills-nature-preserve/',
  'AT&T Discovery District':     'https://discoverydistrictdallas.com/',

  // Events
  'Gondola Ride on Lake Carolyn': 'https://irving.gondola.com/',
  'Kayaking at White Rock Lake': 'https://dallasparks.org/246/White-Rock-Lake-Park',
  'Texas Discovery Gardens — Butterfly House': 'https://txdg.org/',
  'Live Music in Deep Ellum':    'https://deepellumtexas.com/',
  'Luxury Picnic Date':          'https://www.dfwurbanpicnics.com/',
  'Nasher Sculpture Center':     'https://nashersculpturecenter.org/visit',
  'Reunion Tower GeO-Deck':      'https://www.reuniontower.com/',
  'Alamo Drafthouse Cinema':     'https://drafthouse.com/dfw',

  // Sports / activity
  'Bowl & Barrel':               'https://www.bowlandbarrel.com/',
  'Chicken N Pickle':            'https://chickennpickle.com/grand-prairie/',
  'Whiskey Hatchet':             'https://whiskeyhatchet.com/',
  'Paddle Boarding at White Rock Lake': 'https://dallasparks.org/246/White-Rock-Lake-Park',
  'TopGolf Dallas':              'https://topgolf.com/us/dallas/',
  'Main Event':                  'https://www.mainevent.com/locations/',
  'The Pool Club at Virgin Hotels': 'https://virginhotels.com/dallas/drink-and-dine/the-pool-club/',
  'Meridian':                    'https://www.meridiandallas.com/',
  'Andretti Indoor Karting':     'https://andrettikarting.com/locations/grand-prairie-tx/',
};

const update = db.db.prepare('UPDATE opportunities SET source_url = ?, image_url = NULL WHERE title = ?');
let changed = 0, missing = 0;
for (const [title, url] of Object.entries(OFFICIAL_URLS)) {
  const r = update.run(url, title);
  if (r.changes) changed++; else { missing++; console.log('  ✗ no row for:', title); }
}
console.log(`\n✅  Updated source_url for ${changed} venues (cleared image_url so backfill re-fetches).`);
if (missing) console.log(`   ${missing} titles not found in DB.`);
