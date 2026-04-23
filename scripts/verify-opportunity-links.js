'use strict';
/**
 * Fetch every opportunity's source_url and flag ones where:
 *   - HTTP status is not 2xx
 *   - final redirect URL is on a different host (possible parked domain / listicle redirect)
 *   - page title/h1 doesn't mention any word from the venue name
 *
 * Usage:  node scripts/verify-opportunity-links.js
 */

const db = require('../db');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

function stripTags(s) { return s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(); }
function hostOf(u)    { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return null; } }

// Tokens from venue names to look for in page title/h1. Case-insensitive.
function keywords(title) {
  // Strip edge decoration, split on non-alpha, keep meaningful tokens
  return title
    .replace(/—.*$/, '')                 // drop after em-dash tagline (Avanti — Wednesday...)
    .replace(/\bat\b.*$/i, '')          // drop "at X" location tail
    .replace(/[^A-Za-z0-9']/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !['the','and','for','with','dallas','texas','tx','cafe','coffee','shop','bar','house','room','grill','kitchen','restaurant','hotel','lake','park','trail','walk','evening','stroll','ride','date','night','luxury','preserve','center','district'].includes(w.toLowerCase()))
    .map(w => w.toLowerCase());
}

async function check(row) {
  const expectedHost = hostOf(row.source_url);
  let resp;
  try {
    resp = await fetch(row.source_url, {
      headers: { 'User-Agent': UA, 'Accept': 'text/html' },
      signal: AbortSignal.timeout(15000),
      redirect: 'follow'
    });
  } catch (e) {
    return { status: 'FETCH_FAIL', detail: e.message };
  }
  const finalHost  = hostOf(resp.url);
  const hostChanged = expectedHost !== finalHost;
  if (!resp.ok) return { status: `HTTP_${resp.status}`, finalHost };
  const html = await resp.text();
  const titleMatch = html.match(/<title[^>]*>([\s\S]{0,300}?)<\/title>/i);
  const h1Match    = html.match(/<h1[^>]*>([\s\S]{0,500}?)<\/h1>/i);
  const title = titleMatch ? stripTags(titleMatch[1]) : '';
  const h1    = h1Match    ? stripTags(h1Match[1])    : '';
  const ogTitle = (html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) || [])[1] || '';
  const haystack = (title + ' ' + h1 + ' ' + ogTitle).toLowerCase();
  const kws = keywords(row.title);
  const matches = kws.filter(k => haystack.includes(k));
  const nameHit = kws.length === 0 ? true : matches.length > 0;
  return {
    status: resp.ok ? 'OK' : `HTTP_${resp.status}`,
    hostChanged,
    finalHost,
    title: title.slice(0, 100),
    nameHit,
    kwsChecked: kws,
    kwsMatched: matches,
  };
}

(async () => {
  const rows = db.db.prepare('SELECT id, title, source_url FROM opportunities WHERE source_url IS NOT NULL ORDER BY title').all();
  console.log(`Checking ${rows.length} links...\n`);

  const suspects = [];
  const results = [];
  for (const r of rows) {
    const res = await check(r);
    results.push({ title: r.title, url: r.source_url, ...res });
    const marker = (res.status === 'OK' && res.nameHit && !res.hostChanged) ? '  ✓'
                 : (res.status === 'OK' && res.nameHit &&  res.hostChanged) ? '  ~ (redirect)'
                 : (res.status === 'OK' && !res.nameHit)                    ? '  ?  name not in page'
                 :                                                            '  ✗';
    console.log(marker.padEnd(22), r.title.padEnd(42), '→', res.status, res.title || '');
    if (marker.trim() !== '✓') suspects.push({ title: r.title, ...res, url: r.source_url });
    await new Promise(r => setTimeout(r, 150));
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Suspects: ${suspects.length} / ${rows.length}`);
  console.log('='.repeat(60));
  suspects.forEach(s => {
    console.log(`\n• ${s.title}`);
    console.log(`    url:       ${s.url}`);
    console.log(`    status:    ${s.status}`);
    if (s.hostChanged) console.log(`    redirect:  → ${s.finalHost}`);
    if (s.title)       console.log(`    pageTitle: ${s.title}`);
    if (s.kwsChecked)  console.log(`    keywords:  checked [${s.kwsChecked.join(', ')}]  matched [${s.kwsMatched.join(', ')}]`);
  });
})();
