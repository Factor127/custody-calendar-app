'use strict';

// Shared SSRF guard for every endpoint that fetches a user-supplied URL:
// /api/unfurl, /api/ical/import, /api/pulse + /api/pulse/preview, and the
// background opportunity image fetch. Centralised so hardening a new range
// (e.g. RFC 6598 CGNAT, multicast) updates every caller at once.
//
// Authenticated users could otherwise probe Railway's internal network or
// pull credentials from cloud metadata endpoints.

function isPrivateHost(host) {
  if (!host) return true;
  const h = host.toLowerCase();
  if (h === 'localhost' || h === 'metadata.google.internal') return true;

  // IPv4 literal
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b, c, d] = m.slice(1).map(Number);
    if ([a, b, c, d].some(n => n > 255)) return true;
    if (a === 10) return true;                              // 10.0.0.0/8
    if (a === 127) return true;                             // 127.0.0.0/8 loopback
    if (a === 169 && b === 254) return true;                // 169.254.0.0/16 link-local + AWS metadata
    if (a === 172 && b >= 16 && b <= 31) return true;       // 172.16.0.0/12
    if (a === 192 && b === 168) return true;                // 192.168.0.0/16
    if (a === 0) return true;                               // 0.0.0.0/8
    if (a === 100 && b >= 64 && b <= 127) return true;      // 100.64.0.0/10 RFC 6598 CGNAT
    if (a >= 224) return true;                              // 224.0.0.0+ multicast / reserved
    return false;
  }

  // IPv6 literal in brackets
  if (h.startsWith('[')) {
    const ip = h.slice(1, h.indexOf(']')).toLowerCase();
    if (ip === '::1' || ip === '::') return true;
    if (ip.startsWith('fc') || ip.startsWith('fd')) return true;  // fc00::/7 ULA
    if (ip.startsWith('fe80')) return true;                       // fe80::/10 link-local
    return false;
  }

  return false;
}

// Throws an Error tagged with .code on rejection. Returns the parsed URL.
function assertPublicHttpUrl(rawUrl) {
  let u;
  try { u = new URL(rawUrl); }
  catch { const e = new Error('invalid_url'); e.code = 'invalid_url'; throw e; }

  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    const e = new Error('blocked_scheme'); e.code = 'blocked_scheme'; throw e;
  }
  if (isPrivateHost(u.hostname)) {
    const e = new Error('blocked_host'); e.code = 'blocked_host'; throw e;
  }
  return u;
}

module.exports = { isPrivateHost, assertPublicHttpUrl };
