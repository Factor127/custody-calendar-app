'use strict';

// Minimal HTML escape for user-controlled strings spliced into email bodies
// or any other server-rendered HTML. Always use this on values that came
// from req.body / DB columns the user can write (names, messages, titles)
// before interpolating into a backtick string. Mail clients render HTML, so
// unescaped names like `<a href=...>` become live phishing links sent FROM
// our verified domain.
function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// Render a plain-text email body as safe HTML: escape, wrap bare URLs in
// anchor tags, convert newlines to <br>. Sending HTML matters because some
// inbound gateways (Proofpoint URL Defense) rewrite every URL in a message;
// in plain text the reader sees the long rewritten URL, in HTML the visible
// anchor text stays clean while the href gets rewritten transparently.
const URL_RE = /(https?:\/\/[^\s<>]+|www\.[^\s<>]+)/gi;
const TRAILING_PUNCT = /[.,;:!?)\]]+$/;

function textToEmailHtml(text) {
  const escaped = escHtml(text);
  const linked = escaped.replace(URL_RE, (match) => {
    let trail = '';
    const m = match.match(TRAILING_PUNCT);
    if (m) {
      trail = m[0];
      match = match.slice(0, -trail.length);
    }
    const href = match.startsWith('www.') ? 'http://' + match : match;
    return `<a href="${href}">${match}</a>${trail}`;
  });
  return linked.replace(/\r?\n/g, '<br>\n');
}

module.exports = { escHtml, textToEmailHtml };
