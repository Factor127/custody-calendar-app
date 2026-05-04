#!/usr/bin/env node
/**
 * Export Spontany admin dashboard data to UTF-8 CSV files.
 *
 * Usage:
 *   ADMIN_TOKEN=xxx node scripts/export-dashboard.js
 *   ADMIN_TOKEN=xxx BASE_URL=https://spontany.io node scripts/export-dashboard.js
 *
 * Writes one CSV per dataset into dashboard-export-YYYY-MM-DD/.
 * Skips opportunities and submissions per request.
 */

const fs   = require('fs');
const path = require('path');

const BASE_URL    = process.env.BASE_URL    || 'https://spontany.io';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

if (!ADMIN_TOKEN) {
  console.error('ERROR: ADMIN_TOKEN env var is required.');
  console.error('Run: ADMIN_TOKEN=your-token node scripts/export-dashboard.js');
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);
const OUT_DIR = path.join(process.cwd(), `dashboard-export-${today}`);
fs.mkdirSync(OUT_DIR, { recursive: true });

// ── CSV writer ─────────────────────────────────────────────────────────────
// RFC 4180-ish: quote any field containing comma, quote, CR, or LF.
// Doubled quotes escape inner quotes. UTF-8 with BOM so Excel auto-detects.
function csvEscape(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') v = JSON.stringify(v);
  const s = String(v);
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function writeCsv(filename, rows, columns) {
  const filepath = path.join(OUT_DIR, filename);
  if (!rows || rows.length === 0) {
    fs.writeFileSync(filepath, '﻿' + (columns || []).join(',') + '\n', 'utf8');
    console.log(`  ${filename}: 0 rows`);
    return;
  }
  // If columns not provided, union keys from all rows (preserves first-seen order).
  const cols = columns || (() => {
    const seen = new Set();
    const out = [];
    for (const r of rows) for (const k of Object.keys(r)) {
      if (!seen.has(k)) { seen.add(k); out.push(k); }
    }
    return out;
  })();
  const lines = [cols.join(',')];
  for (const r of rows) lines.push(cols.map(c => csvEscape(r[c])).join(','));
  fs.writeFileSync(filepath, '﻿' + lines.join('\n') + '\n', 'utf8');
  console.log(`  ${filename}: ${rows.length} rows`);
}

async function fetchJson(endpoint) {
  const url = `${BASE_URL}${endpoint}`;
  const res = await fetch(url, { headers: { 'X-Admin-Token': ADMIN_TOKEN } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${endpoint} → ${res.status} ${res.statusText}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

// ── Main ───────────────────────────────────────────────────────────────────
(async () => {
  console.log(`Exporting from ${BASE_URL} → ${OUT_DIR}\n`);

  // 1. Users
  console.log('users…');
  const usersData = await fetchJson('/api/admin/users');
  writeCsv('users.csv', usersData.users || []);

  // 2. Network (nodes + edges as two files)
  console.log('network…');
  const net = await fetchJson('/api/admin/network');
  writeCsv('network_nodes.csv', net.nodes || []);
  writeCsv('network_edges.csv', net.edges || []);

  // 3. Stats — flatten the multi-shape payload into themed CSVs
  console.log('stats…');
  const stats = await fetchJson('/api/admin/stats');
  writeCsv('stats_summary.csv', [{
    oppCount:              stats.oppCount,
    subCount:              stats.subCount,
    planCount:             stats.planCount,
    eventCount:            stats.eventCount,
    total_views:           stats.total_views,
    total_saves:           stats.total_saves,
    total_plans_from_opps: stats.total_plans_from_opps,
    total_outings:         stats.total_outings,
  }]);
  writeCsv('stats_by_type.csv',          stats.byType          || []);
  writeCsv('stats_by_category.csv',      stats.byCat           || []);
  writeCsv('stats_by_sub_status.csv',    stats.byStatus        || []);
  writeCsv('stats_top_contributors.csv', stats.topContributors || []);

  // 4. Analytics — many funnels, one CSV each
  console.log('analytics…');
  const a = await fetchJson('/api/admin/analytics');
  writeCsv('analytics_match_funnel_by_hook.csv', a.funnel         || []);
  writeCsv('analytics_event_totals.csv',         a.totals         || []);
  writeCsv('analytics_person_b.csv',             a.personB ? [a.personB] : []);
  writeCsv('analytics_devices.csv',              a.devices        || []);
  writeCsv('analytics_daily_sessions.csv',       a.daily          || []);
  writeCsv('analytics_utm_sources.csv',          a.sources        || []);
  writeCsv('analytics_step_timing.csv',          a.timing         || []);
  writeCsv('analytics_screen_funnel.csv',        a.screenFunnel   || []);
  writeCsv('analytics_exit_screens.csv',         a.exitScreens    || []);
  writeCsv('analytics_variant_funnel.csv',       a.variantFunnel  || []);
  writeCsv('analytics_lp_funnel.csv',            a.lpFunnel       || []);
  writeCsv('analytics_lp_steps.csv',             a.lpSteps        || []);
  writeCsv('analytics_lp_diagnostics.csv',       a.lpDiagnostics  || []);
  writeCsv('analytics_lp_abandons.csv',          a.lpAbandons     || []);
  writeCsv('analytics_nudge_status.csv',         a.nudgeStatus    || []);

  // 5. Waitlist
  console.log('waitlist…');
  try {
    const wl = await fetchJson('/api/admin/waitlist');
    // Endpoint may return {waitlist: [...]} or [...] — handle both.
    const rows = Array.isArray(wl) ? wl : (wl.waitlist || wl.entries || wl.rows || []);
    writeCsv('waitlist.csv', rows);
  } catch (e) {
    console.log(`  waitlist skipped: ${e.message}`);
  }

  console.log(`\nDone. Files written to: ${OUT_DIR}`);
})().catch(err => {
  console.error('\nExport failed:', err.message);
  process.exit(1);
});
