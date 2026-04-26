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

// ── Step 4.1: clear logo-only / garbage images so step 5 fills them with curated photos
(() => {
  const banner = '═'.repeat(70);
  console.log(`\n${banner}\n  Step 4.1 — Clear logo-only / garbage images\n${banner}`);
  const db2 = require('../db');
  const r = db2.db.prepare(
    "UPDATE opportunities SET image_url = NULL " +
    "WHERE image_url LIKE '%logo%' " +
    "   OR image_url LIKE '%cropped%' " +
    "   OR image_url LIKE '%appicon%' " +
    "   OR image_url LIKE '%.svg' " +
    "   OR image_url LIKE '%ie6countdown%' " +
    "   OR image_url LIKE '%warning_bar%' " +
    // Known-broken Unsplash IDs that 404 (defensive — should never be inserted now)
    "   OR image_url LIKE '%photo-1489599537094%' " +
    "   OR image_url LIKE '%photo-1520637836862%' " +
    "   OR image_url LIKE '%photo-1572878401119%' " +
    "   OR image_url LIKE '%photo-1530873322%' " +
    "   OR image_url LIKE '%photo-1551516114%' " +
    "   OR image_url LIKE '%photo-1520340942036%'"
  ).run();
  console.log(`  Cleared ${r.changes} logo-only / garbage image URLs.`);
})();

run('Step 5 — Apply curated Unsplash overrides',     'apply-image-overrides.js');

// ── Steps 5a–5d: kids/family expansion ───────────────────────────────────
run("Step 5a — Mark existing 64 venues' audience",   'mark-existing-audience.js');
run('Step 5b — Seed 50 kids/family DFW venues',      'seed-kids-opportunities.js');
run('Step 5c — Patch kids URLs + add 11 more',       'seed-kids-opportunities-batch2.js');
run('Step 5d — Backfill og:image for kids batch',    'backfill-opportunity-images.js');

// ── Step 5d.1: clear logo-only / garbage images so step 5e fills them with curated photos
(() => {
  const banner = '═'.repeat(70);
  console.log(`\n${banner}\n  Step 5d.1 — Clear logo-only / garbage images\n${banner}`);
  const db2 = require('../db');
  const r = db2.db.prepare(
    "UPDATE opportunities SET image_url = NULL " +
    "WHERE image_url LIKE '%logo%' " +
    "   OR image_url LIKE '%cropped%' " +
    "   OR image_url LIKE '%appicon%' " +
    "   OR image_url LIKE '%.svg'"
  ).run();
  console.log(`  Cleared ${r.changes} logo-only image URLs (kids batch).`);
})();

run('Step 5e — Apply kids Unsplash overrides',       'apply-kids-image-overrides.js');

// ── Step 6: Verification ─────────────────────────────────────────────────
(() => {
  const banner = '═'.repeat(70);
  console.log(`\n${banner}\n  Step 6 — Final verification\n${banner}`);

  const db = require('../db');
  const total   = db.db.prepare('SELECT COUNT(*) as n FROM opportunities').get().n;
  const withImg = db.db.prepare('SELECT COUNT(*) as n FROM opportunities WHERE image_url IS NOT NULL').get().n;
  const byCat   = db.db.prepare('SELECT category, COUNT(*) as n FROM opportunities GROUP BY category ORDER BY category').all();
  const byAud   = db.db.prepare("SELECT COALESCE(audience, 'unset') as audience, COUNT(*) as n FROM opportunities GROUP BY audience ORDER BY audience").all();

  console.log(`  Total opportunities: ${total}`);
  console.log(`  With images:         ${withImg} / ${total}`);
  console.log(`  By category:`);
  byCat.forEach(r => console.log(`    ${r.category.padEnd(15)} ${r.n}`));
  console.log(`  By audience:`);
  byAud.forEach(r => console.log(`    ${r.audience.padEnd(15)} ${r.n}`));

  // Flag any remaining non-DFW
  const sus = db.db.prepare("SELECT title FROM opportunities WHERE source_url LIKE '%.il%' OR location_name LIKE '%Israel%' OR location_name LIKE '%Tel Aviv%'").all();
  if (sus.length) {
    console.log(`\n  ⚠️   Remaining non-DFW suspects:`);
    sus.forEach(s => console.log(`     - ${s.title}`));
  }

  console.log(`\n✅  Sync complete.\n`);
})();
