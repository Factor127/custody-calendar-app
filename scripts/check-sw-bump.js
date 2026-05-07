#!/usr/bin/env node
// Merge gate: if anything in public/ changed, public/sw.js CACHE_VERSION must
// also have changed. Otherwise returning users keep the cached file and "the
// deploy didn't work."
//
// Usage:
//   node scripts/check-sw-bump.js --staged          # pre-commit (HEAD vs index)
//   node scripts/check-sw-bump.js <base-ref>        # CI (base-ref vs HEAD)
//
// Exit 0 = pass / not applicable. Exit 1 = gate failed.

const { execSync } = require('child_process');
const fs = require('fs');

function sh(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
}

const arg = process.argv[2] || '--staged';
const isStaged = arg === '--staged' || arg === 'staged';

let changedFiles;
let oldSw;
let newSw;

if (isStaged) {
  changedFiles = sh('git diff --cached --name-only').split('\n').map(s => s.trim()).filter(Boolean);
  oldSw = sh('git show HEAD:public/sw.js');
  // Index version of sw.js, falling back to working tree if unstaged.
  newSw = sh('git show :public/sw.js') || (fs.existsSync('public/sw.js') ? fs.readFileSync('public/sw.js', 'utf8') : '');
} else {
  const base = arg;
  changedFiles = sh(`git diff --name-only ${base}...HEAD`).split('\n').map(s => s.trim()).filter(Boolean);
  oldSw = sh(`git show ${base}:public/sw.js`);
  newSw = sh('git show HEAD:public/sw.js');
}

const publicChanged = changedFiles.filter(f => f.startsWith('public/') && f !== 'public/sw.js');

if (publicChanged.length === 0) {
  // No public/ changes -> gate not applicable.
  process.exit(0);
}

function extractVersion(src) {
  const m = src && src.match(/CACHE_VERSION\s*=\s*['"]([^'"]+)['"]/);
  return m ? m[1] : null;
}

const oldV = extractVersion(oldSw);
const newV = extractVersion(newSw);

if (!newV) {
  console.error('ERROR: Could not find CACHE_VERSION in public/sw.js.');
  process.exit(1);
}

if (oldV === newV) {
  console.error('');
  console.error('  ✗ Merge gate failed: SW cache version not bumped');
  console.error('  ----------------------------------------------------');
  console.error(`  Files in public/ changed but CACHE_VERSION is still ${newV}.`);
  console.error('  Returning PWA users will keep the stale cache.');
  console.error('');
  console.error('  Fix: bump CACHE_VERSION in public/sw.js');
  console.error(`       (e.g. ${newV} -> ${bumpHint(newV)})`);
  console.error('');
  console.error('  Changed files in public/:');
  publicChanged.forEach(f => console.error(`    ${f}`));
  console.error('');
  console.error('  Bypass (use sparingly): git commit --no-verify');
  console.error('');
  process.exit(1);
}

console.log(`✓ SW cache bumped: ${oldV} -> ${newV}`);

function bumpHint(v) {
  // spontany-v19 -> spontany-v20
  const m = v && v.match(/^(.*?)(\d+)$/);
  if (!m) return `${v}-next`;
  return `${m[1]}${parseInt(m[2], 10) + 1}`;
}
