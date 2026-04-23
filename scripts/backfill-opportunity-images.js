'use strict';
/**
 * Backfill og:image / twitter:image for opportunities that have no image_url.
 *
 * Usage:  node scripts/backfill-opportunity-images.js
 *
 * Walks every public opportunity where image_url IS NULL, fetches source_url,
 * and extracts the best image tag it can find. Safe to re-run.
 */

const db = require('../db');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

async function fetchImageForUrl(url) {
  const resp = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml' },
    signal: AbortSignal.timeout(12000),
    redirect: 'follow'
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const html = await resp.text();
  const get = (pattern) => { const m = html.match(pattern); return m ? m[1] : null; };
  let img = get(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
         || get(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)
         || get(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i)
         || get(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i)
         || get(/<meta[^>]+name=["']twitter:image:src["'][^>]+content=["']([^"']+)["']/i)
         || get(/<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i)
         || get(/<img[^>]+src=["'](https?:\/\/[^"']+(?:\.jpg|\.jpeg|\.png|\.webp)[^"']*)["']/i);
  if (img && !img.startsWith('http')) {
    try { img = new URL(img, url).href; } catch(e) { img = null; }
  }
  // HTML-decode basic entities
  if (img) img = img.replace(/&amp;/g, '&').replace(/&#x2F;/gi, '/').replace(/&#47;/g, '/');
  return img || null;
}

async function main() {
  const rows = db.db.prepare(
    "SELECT id, title, source_url FROM opportunities WHERE image_url IS NULL AND source_url IS NOT NULL"
  ).all();

  console.log(`\n🔍  Found ${rows.length} opportunities missing images.\n`);

  let ok = 0, fail = 0;
  const failures = [];
  const update = db.db.prepare('UPDATE opportunities SET image_url = ? WHERE id = ?');

  for (const r of rows) {
    process.stdout.write(`  • ${r.title.padEnd(40).slice(0,40)}  `);
    try {
      const img = await fetchImageForUrl(r.source_url);
      if (img) {
        update.run(img, r.id);
        console.log(`✓  ${img.slice(0, 80)}`);
        ok++;
      } else {
        console.log(`—  no image tag found`);
        fail++;
        failures.push({ title: r.title, source_url: r.source_url, reason: 'no image tag' });
      }
    } catch (e) {
      console.log(`✗  ${e.message}`);
      fail++;
      failures.push({ title: r.title, source_url: r.source_url, reason: e.message });
    }
    // Be polite — tiny delay between hosts
    await new Promise(r => setTimeout(r, 250));
  }

  console.log(`\n✅  Fetched images for ${ok} / ${rows.length} opportunities.`);
  if (failures.length) {
    console.log(`\n⚠️   ${failures.length} failures (will need manual image URLs):`);
    failures.forEach(f => console.log(`     - ${f.title}  →  ${f.reason}`));
  }
  console.log('');
}

main().catch(e => { console.error(e); process.exit(1); });
