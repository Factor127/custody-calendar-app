'use strict';
/**
 * One-shot orchestrator to bring the production (Railway) opportunities DB
 * in line with local curation work. Safe to re-run — each step is idempotent.
 *
 * Usage against production:
 *   railway run node scripts/sync-to-prod.js
 *
 * Or locally (also idempotent):
 *   node scripts/sync-to-prod.js
 *
 * Steps:
 *   1. Delete non-DFW submissions (Atzmaut Blackout and similar)
 *   2. Seed 25 new DFW venues (skips any title already present)
 *   3. Update source_urls to each venue's official site (clears stale image_url)
 *   4. Fetch og:image from each venue's official site
 *   5. Apply curated Unsplash overrides for anything still missing an image
 *   6. Final verification — count opportunities and images
 */

const { execSync } = require('child_process');
const path = require('path');

const SCRIPT_DIR = __dirname;
function run(label, script) {
  const banner = '═'.repeat(70);
  console.log(`\n${banner}\n  ${label}\n${banner}`);
  try {
    execSync(`node "${path.join(SCRIPT_DIR, script)}"`, { stdio: 'inherit' });
  } catch (e) {
    console.error(`\n❌  ${label} failed — stopping sync.`);
    process.exit(1);
  }
}

// ── Step 1: Remove known non-DFW submissions ─────────────────────────────
(() => {
  const banner = '═'.repeat(70);
  console.log(`\n${banner}\n  Step 1 — Remove non-DFW submissions\n${banner}`);

  const db = require('../db');

  // Delete by title (exact match) and by source host (.il = Israel)
  const NON_DFW_TITLES = ['Atzmaut Blackout'];

  let deleted = 0;
  for (const title of NON_DFW_TITLES) {
    const row = db.db.prepare('SELECT id FROM opportunities WHERE title = ?').get(title);
    if (row) {
      // Cascade-delete: remove related plans first (admin.js pattern)
      try { db.db.prepare('DELETE FROM plans WHERE opportunity_id = ?').run(row.id); } catch(e) {}
      try { db.db.prepare('DELETE FROM opportunity_events WHERE opportunity_id = ?').run(row.id); } catch(e) {}
      db.db.prepare('DELETE FROM opportunities WHERE id = ?').run(row.id);
      console.log(`  ✓ deleted: ${title} (${row.id})`);
      deleted++;
    }
  }

  // Catch-all: any opportunity whose source_url is on an Israeli TLD
  const ilRows = db.db.prepare("SELECT id, title FROM opportunities WHERE source_url LIKE '%.il/%' OR source_url LIKE '%.co.il%'").all();
  for (const r of ilRows) {
    try { db.db.prepare('DELETE FROM plans WHERE opportunity_id = ?').run(r.id); } catch(e) {}
    try { db.db.prepare('DELETE FROM opportunity_events WHERE opportunity_id = ?').run(r.id); } catch(e) {}
    db.db.prepare('DELETE FROM opportunities WHERE id = ?').run(r.id);
    console.log(`  ✓ deleted .il-hosted: ${r.title} (${r.id})`);
    deleted++;
  }

  console.log(`\n  Removed ${deleted} non-DFW opportunities.`);
})();

// ── Steps 2–5: run existing curation scripts in order ────────────────────
run('Step 2 — Seed 25 new DFW venues',              'seed-opportunities.js');
run('Step 3 — Update source_urls to official sites', 'update-opportunity-sources.js');
run('Step 4 — Fetch og:image for each venue',        'backfill-opportunity-images.js');
run('Step 5 — Apply curated Unsplash overrides',     'apply-image-overrides.js');

// ── Step 6: Verification ─────────────────────────────────────────────────
(() => {
  const banner = '═'.repeat(70);
  console.log(`\n${banner}\n  Step 6 — Final verification\n${banner}`);

  const db = require('../db');
  const total   = db.db.prepare('SELECT COUNT(*) as n FROM opportunities').get().n;
  const withImg = db.db.prepare('SELECT COUNT(*) as n FROM opportunities WHERE image_url IS NOT NULL').get().n;
  const byCat   = db.db.prepare('SELECT category, COUNT(*) as n FROM opportunities GROUP BY category ORDER BY category').all();

  console.log(`  Total opportunities: ${total}`);
  console.log(`  With images:         ${withImg} / ${total}`);
  console.log(`  By category:`);
  byCat.forEach(r => console.log(`    ${r.category.padEnd(15)} ${r.n}`));

  // Flag any remaining non-DFW
  const sus = db.db.prepare("SELECT title FROM opportunities WHERE source_url LIKE '%.il%' OR location_name LIKE '%Israel%' OR location_name LIKE '%Tel Aviv%'").all();
  if (sus.length) {
    console.log(`\n  ⚠️   Remaining non-DFW suspects:`);
    sus.forEach(s => console.log(`     - ${s.title}`));
  }

  console.log(`\n✅  Sync complete.\n`);
})();
