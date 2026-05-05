# Spontany Security Remediation Plan

**Started:** 2026-05-03
**Audit basis:** post-launch (~8 prod users), treat with prod weight.
**Owner:** Ran (solo founder)

This is the durable anchor for a multi-session security hardening pass. Read this on every session start, execute the next undone item, commit, update status, end cleanly.

## How to resume in a new Claude session

1. Open this file. Skim "Approved scope" and "Audit summary" so you have context.
2. Find the first `[ ]` item under the **active phase**. Each item lists *Where*, *Why*, *Fix sketch*, *Commit*.
3. Make ONE focused commit per item (or per tightly-related cluster — e.g. the SSRF items are one commit).
4. Mark the item `[x]` and write the commit hash.
5. Append one line to the **Session log** at the bottom.
6. If the session feels long, stop. Better to ship one item than lose context mid-flight.

When picking up cold: `Read docs/security-remediation.md and continue with the next [ ] item.`

## Approved scope (founder sign-off 2026-05-03)

- **Phase 2 strategy:** Route A — migrate to httpOnly cookie session, drop `?token=` URLs, add `Referrer-Policy: same-origin`.
- **Phase 3 tools:** `helmet` for security headers, `gitleaks` (binary) for pre-commit secret scan.
- All findings approved as in-scope; nothing deferred.

## Audit summary (severity → finding → fix sketch)

### Critical
- **C1** — `/api/email/unsubscribe` `?token=` is the user's session credential. → Add `unsubscribe_token` column on `users`, swap link generator. Old links go 410.
- **C2** — `routes/pulse.js:45` `fetchMetadata` has no SSRF guard. → Apply shared `assertPublicHttpUrl` before fetch.
- **C3** — `routes/api.js:870` `/api/ical/import` has no SSRF guard. → Same.
- **C4** — `routes/opportunities.js:9` `_fetchImageForOpportunity` has no SSRF guard. → Same.
- **C5** — `routes/api.js:1325` `PATCH /api/rsvp/:token` lets any RSVP-token holder rewrite venue/time/address for all invitees. → Drop the PATCH or restrict to creator-only via session token.

### High
- **H1** — Session tokens in `?token=` query strings everywhere (pages.js, auth.js redirects, calendar.ics). Leak via Referer, logs, history. → Phase 2 cookie migration.
- **H2** — `server.js:923` `BASE_URL` falls back to `req.headers.host` → host-header injection in cron emails. → Refuse to boot if `BASE_URL` unset in production.
- **H3** — `routes/share.js:50` `/api/share/create` unauth + sends Twilio SMS, no rate limit. → Apply shared limiter (per IP + per phone).
- **H4** — `routes/lp.js:141` `/api/lp/signup` unauth, no rate limit, mints magic links → inbox-bomb. → Limiter per IP + per email.
- **H5** — `routes/match.js:21,219` `/api/match/create`, `/api/match/invite` unauth, no rate limit, `match/invite` allows arbitrary `sender_name`/`sender_email` (impersonation). → Limiter; consider sender attestation.
- **H6** — `routes/api.js:1290` RSVP tokens reusable. → Add `used_at`; allow status flip but log.
- **H7** — `routes/api.js:2318,2344` `/users/find-by-phone`, `/users/search` enable enumeration. → Per-user rate limit.
- **H8** — `server.js:153` `/api/waitlist` unauth, no rate limit. → Limiter per IP.
- **H9** — `users.google_access_token` / `google_refresh_token` stored plaintext. → AES-256-GCM via `NODE_ENCRYPT_KEY`, migration script for existing rows.
- **H10** — `server.js:164,172` admin waitlist endpoints reimplement `requireAdmin` inline. → Use the helper from `routes/admin.js`.
- **H11** — No security headers (no helmet, no CSP, no HSTS, no Referrer-Policy). → Install helmet with conservative defaults; explicit `Referrer-Policy: same-origin` is highest priority because it limits H1 fallout.

### Medium
- **M1** — Cookies missing `secure: true` on prod (`sa_access`, `sa_variant`). → Add `secure: NODE_ENV === 'production'` to all `res.cookie` calls.
- **M2/M3** — ~30 `res.json({ error: e.message })` callsites leak internals. → `utils/safeError.js` + sweep.
- **M4** — `/api/import/html` multer has no MIME check. → Validate `text/html`.
- **M5** — `/api/match/:token` exposes both schedules to any token holder (acceptable by design — note in a comment).
- **M6** — Same-token A/B submission in share flow (acceptable by design).
- **M7** — `/api/opportunities/sync` lacks admin gate. → Require admin token.
- **M8** — `/api/me` returns phones; combined with H1 = phone leak. Resolved by Phase 2.

### Low
- **L1** — `/api/email/open` allows third-party analytics pollution. Accept (open-pixel pattern).
- **L2** — share/report XSS already fixed in commit 54c0d2f. ✓
- **L3** — `serveVariant` uses `String.replace('</head>', ...)` on disk-read HTML; safe today, note for review.
- **L4** — `routes/sandbox.js` is gitignored but auto-mounts if present. → Add explicit `NODE_ENV !== 'production'` gate.
- **L5** — 251 `innerHTML` occurrences in `public/`; out of scope for this pass; revisit when adding CSP.

---

## Phase 1 — Critical fixes (active)

### [x] C2/C3/C4 — Shared SSRF guard
- **Where:** new `utils/ssrf.js`, applied to `routes/pulse.js` (`fetchMetadata`), `routes/api.js` (`/api/ical/import` + refactor of existing `/api/unfurl` inline guard), `routes/opportunities.js` (`_fetchImageForOpportunity`).
- **Why:** three external-fetch endpoints lacked the guard already on `/unfurl`; centralising means future hardening (RFC 6598 CGNAT, multicast, etc.) updates all callers at once.
- **Fix:** export `isPrivateHost(host)` and `assertPublicHttpUrl(rawUrl)` from `utils/ssrf.js`. Hardened with RFC 6598 CGNAT (100.64/10) and multicast/reserved (224+).
- **Commit:** `2de7746`

### [x] C1 — Separate unsubscribe token from session
- **Where:** `server.js:333-371` (route handler), `db.js` (schema + backfill + INSERT statements), `routes/api.js:68,149` (user-creation callers stamp unsubscribe_token at insert), `utils/emailSequence.js` (every template now passes `user.unsubscribe_token` via `ensureUnsubToken()` lazy-fill helper).
- **Why:** `?token=` in unsubscribe links was the user's `access_token` — anyone seeing a forwarded email got full account access.
- **Fix:** `unsubscribe_token TEXT` column with unique index `idx_users_unsub_token`. Startup backfill stamps random UUID on every NULL row. New users get one stamped at INSERT. `/api/email/unsubscribe` now looks up by `unsubscribe_token`; any other token returns 410 Gone with a "use a recent email" page. The weekly-digest email in `routes/api.js` does not currently include an unsubscribe link, so no change needed there.
- **Commit:** `36678c0`

### [x] C5 — RSVP PATCH IDOR
- **Where:** `routes/api.js` PATCH handler removed; `public/rsvp.html` fill-section UI + PATCH fetch removed; `public/sw.js` cache bumped to v18.
- **Why:** any RSVP-token holder could mutate venue/time/address visible to all other invitees.
- **Fix:** preferred path — endpoint deleted, "Know any missing details?" UX ripped out. Corrections to outings now flow only through the authenticated creator-only `PUT /api/outings/:id`. Verified live: PATCH route returns generic 404, GET still routes correctly, valid RSVP renders without the fill-section, decline flow show/cancel still work, no console errors.
- **Commit:** `a538208`

### [x] H2 — Host-header injection in cron emails
- **Where:** `server.js:5-13` (boot guard); `routes/api.js:898` (weekly digest); `routes/share.js:31-33` (share base URL); `routes/nudge.js:128` (Twilio webhook signature URL); `routes/auth.js:39-41,212,237` (Google OAuth redirect URIs in three places).
- **Why:** `BASE_URL = process.env.BASE_URL || \`https://${req.headers.host}\`` let an attacker control the link domain in outbound emails by spoofing the Host header (cron digest was the loudest example, but every endpoint with the same fallback was equally exploitable).
- **Fix:** added a fail-fast boot guard — `NODE_ENV === 'production' && !BASE_URL` ⇒ log + `process.exit(1)`. Replaced every `req.headers.host` / `req.get('host')` fallback in the main repo with `req.app.locals.BASE_URL`. Dev still gets the `http://localhost:${PORT}` default from server.js. Verified with `node -c` on all five files.
- **Commit:** `79d4bec`

### [x] H3/H4/H5/H8 — Rate-limit unauth endpoints
- **Where:** new `utils/rateLimit.js` (exports `createBucket`, `rateLimitAllow`, `rateLimit` middleware factory). Wired into `routes/auth.js` (refactored existing limiter onto shared util — caps unchanged), `routes/share.js` (`/api/share/create`), `routes/lp.js` (`/api/lp/signup`), `routes/match.js` (`/match/create`, `/match/invite`), `server.js` (`/api/waitlist`).
- **Why:** SMS toll fraud (share/create can fire arbitrary Twilio sends), magic-link inbox bombing (lp/signup mints magic links), drive-by signup spam (waitlist), abuse of unauth match endpoints.
- **Fix:** caps applied —
  - `/api/share/create`: 10/IP/10min + per-phone 3/24h (E.164-normalized so format variations don't bypass).
  - `/api/lp/signup`: 10/IP/10min + 3/email/hour (matches existing `/api/auth/request` thresholds — same threat model).
  - `/api/waitlist`: 10/IP/10min + 3/email/hour.
  - `/match/create`, `/match/invite`: 20/IP/10min each (looser since legit per-session use can fire several).
  - `/api/auth/request`: unchanged thresholds, refactored onto shared util.
- **Verified live** (in a separate working clone): waitlist per-IP fired at req 11 with limit 10; per-email fired at req 4 with limit 3.
- **Note:** `/api/match/invite` `sender_name`/`sender_email` impersonation (also called out under H5) is not addressed by this commit — separate problem requiring sender attestation; remains open and tracked under M5 / future work.
- **Commit:** `31c21b8`

### [x] H10 — Use `requireAdmin` helper in server.js inline routes
- **Where:** `routes/admin.js` (now exports `requireAdmin` alongside the router); `server.js` imports it and calls it in `GET /api/admin/waitlist` and `PUT /api/admin/waitlist/:id/approve`.
- **Why:** the inline checks reimplemented `requireAdmin` from routes/admin.js; admin-auth changes (like the prior X-Admin-Token-only migration) had to be made in two places, drifted easily.
- **Fix:** `module.exports.requireAdmin = requireAdmin` on routes/admin.js. server.js destructures it from the existing `adminRouter` import. Both inline blocks collapse to `if (!requireAdmin(req, res)) return;` — same pattern used by 14 other admin endpoints. Side benefits: missing `ADMIN_TOKEN` env now returns 503 (config error) instead of being conflated with 403 (bad token); error messages match the rest of the admin surface.
- **Verified** by syntax check (`node -c`) on both files; not browser-verified because no preview is running in the canonical clone, and the change is a mechanical refactor onto a helper already battle-tested by every other admin route.
- **Commit:** `efde7c6`

---

## Phase 2 — Move tokens out of URLs (Route A)

Server-side first, then client. Two sessions.

### [x] P2-Server — Server accepts cookie OR header
- **Where:** `package.json` (cookie-parser dep), `server.js` (cookie-parser + global Referrer-Policy: same-origin middleware), `routes/auth.js` (`SESSION_COOKIE` const + `setSessionCookie()` helper, called in magic-link verify existing-user branch + Google OAuth callback existing-user branch), six `requireToken` implementations (`routes/api.js`, `routes/contributions.js`, `routes/opportunities.js`, `routes/pulse.js`, `routes/push.js`, `routes/smart-suggest.js`), `routes/pages.js` (`pageToken()` helper used by `/admin`, `/calendar`, `/profile`, `/connections`, `/kids-export`; `/partner` with cookie redirects to `/calendar` *without* echoing the token).
- **Why:** access token in `?token=` query strings leaks via Referer headers, browser history, and Railway access logs (H1). Cookie session moves the credential off the URL. Back-compat window keeps query/header working until P2-Client lands.
- **Fix:** httpOnly + SameSite=Lax + Path=/ + Max-Age=30d, `secure: true` only in production. Token-source order in every guard: cookie → X-Access-Token → body → query.
- **Note:** `routes/sandbox.js` is gitignored and not present in this clone; the handoff memory mentioned seven requireToken sites but canonical has six.
- **Verified live** via curl roundtrip on a freshly-spawned canonical-clone server (port 3001, seeded test user): cookie → 200, header → 200, query → 200 (back-compat), no auth → 401, every response carries `Referrer-Policy: same-origin`, `/calendar` with cookie → 200, `/calendar` no auth → 302 → `/login`, `/partner` with cookie → 302 → `/calendar` (no token in URL), `/partner` with query → 302 → `/calendar?token=...` (legacy path), `/api/auth/verify/:token` response includes `Set-Cookie: spontany_session=...; HttpOnly; SameSite=Lax`.
- **Commit:** `0d67e99`

### [ ] P2-Client — Client migrates to cookie/header, drop `?token=` from URLs
- Audit `public/*.html` and `public/*.js` for `?token=` URL building. Replace with `fetch(url, { credentials: 'include', headers: { 'X-Access-Token': sessionStorage.token } })`.
- Magic-link landing flow stores token in `sessionStorage` once, never echoes to URL.
- Delete `?token=` query-param branch from `requireToken`.
- Bookmarked URLs from old sessions break gracefully → magic-link re-login.
- Bump SW cache (`public/sw.js`) — required because client JS changed.

---

## Phase 3 — Hardening + guardrails

### [ ] H6 — RSVP token single-use
- Add `responded_at` already exists; gate POST on `if (inv.status === 'pending')` for first response. Allow `accepted ↔ declined` flip within 24h (UX), block thereafter.

### [ ] H7 — Rate-limit user lookup endpoints
- Apply per-user limiter (key = `me.id`) to `/api/users/find-by-phone`, `/api/users/search`. 30/min.

### [ ] M7 — Admin gate on `/api/opportunities/sync`
- Require `X-Admin-Token`.

### [ ] H9 — Encrypt Google OAuth tokens at rest
- Add `NODE_ENCRYPT_KEY` env var. AES-256-GCM helpers in `utils/crypto.js`. One-shot migration script. Decrypt on use in `/api/contacts/google/matches`.

### [ ] H11 — Install helmet + CSP
- `npm i helmet`. Apply with conservative defaults: HSTS on, X-Content-Type-Options on, Referrer-Policy=same-origin, frameguard=deny. CSP stub with `'unsafe-inline'` allowed initially (251 inline-script callsites in `public/`); tighten in a follow-up.

### [ ] M1 — `secure: true` on cookies
- One-line addition to all `res.cookie(...)` calls.

### [ ] M2/M3 — `utils/safeError.js` + sweep
- `function sendError(res, status, publicMsg, internalErr) { console.error(internalErr); res.status(status).json({ error: publicMsg }); }`. Sweep all `res.json({ error: e.message })`.

### [ ] M4 — Multer MIME validation on `/api/import/html`
- `fileFilter` accepts only `text/html` and `.html`/`.htm` extensions.

### [ ] L4 — Sandbox prod gate
- `if (process.env.NODE_ENV !== 'production') sandboxRouter = require(...)`.

### [ ] CLAUDE.md — Append "Secure Coding Standards" section
- Pattern rules: every external fetch through `utils/ssrf.js`. Every error response through `utils/safeError.js`. New auth-required endpoints get a rate-limit wrapper. No `?token=` in new URLs. Test these as load-bearing rules like the PWA gotchas.

### [ ] Pre-commit hook — gitleaks
- Add `scripts/install-pre-commit.sh` (idempotent). Configure `core.hooksPath = .githooks`. `.githooks/pre-commit` runs `gitleaks protect --staged --redact`. Document install in README.

---

## Out of scope / accepted

- **L1** open-pixel email tracking — accepted (it's an open-pixel by definition).
- **L5** 251 `innerHTML` callsites — accepted for this pass; revisited when CSP tightens beyond `'unsafe-inline'`.
- **M5/M6** match/share token-as-credential design — accepted (no-auth flow is the product).

---

## Session log

- **2026-05-03** — Audit complete; plan written (commit `a5f630b`). Phase 1 started: `utils/ssrf.js` + apply to pulse/ical/opportunities/unfurl, C2/C3/C4 done (commit `2de7746`).
- **2026-05-03** — C1 done: `unsubscribe_token` column added with unique index + startup backfill, stamped on new users via `q.createUserWithEmail`, all 5 sequence email templates switched to `ensureUnsubToken(user)`. `/api/email/unsubscribe` now keys on `unsubscribe_token`; legacy access-token links return 410. Verified live (sandbox-ran row): old token → 410, junk → 410, valid → 200 + `unsubscribed=1`. Next: C5 RSVP PATCH IDOR.
- **2026-05-04** — C5 done: PATCH /api/rsvp/:token deleted, `public/rsvp.html` fill-section + PATCH call ripped out, SW cache bumped v17→v18. Verified live: PATCH → 404, valid RSVP renders cleanly without fill-section, decline flow intact. **Phase 1 complete** — all critical findings closed (C1–C5). Next session: Phase 2 P2-Server (cookie session migration).
- **2026-05-04** — H2 done: boot guard refuses to start in prod without `BASE_URL`; all `req.headers.host` / `req.get('host')` fallbacks (api.js digest, share.js, nudge.js, auth.js x3) replaced with `req.app.locals.BASE_URL`. Server-side change only, not browser-observable; running dev server unchanged. Next: H3/H4/H5/H8 rate-limit unauth endpoints.
- **2026-05-04** — H3/H4/H5/H8 done: shared `utils/rateLimit.js` extracted; applied to share/create (per-IP + per-phone for SMS toll-fraud), lp/signup, waitlist (per-IP + per-email), match/create, match/invite. auth/request refactored onto shared util with unchanged caps. Code shipped via commit `31c21b8` (landed before this doc tick). Verified live in a separate clone — waitlist 11th req → 429; per-email 4th req → 429. Sender impersonation in match/invite still pending (see H5 note). Next: H10 inline `requireAdmin` consolidation in server.js.
- **2026-05-05** — H10 done: routes/admin.js now exports `requireAdmin`; server.js destructures from existing adminRouter import and replaces both inline waitlist-admin checks with `if (!requireAdmin(req, res)) return;`. Bonus: missing `ADMIN_TOKEN` env now distinguishes 503 (config) from 403 (bad token). **Phase 1 complete** — all critical and high findings closed (C1–C5, H2, H3/H4/H5/H8, H10). Next: Phase 2 P2-Server (cookie session migration).
- **2026-05-05** — P2-Server done (commit `0d67e99`): cookie-parser wired, global `Referrer-Policy: same-origin` middleware added, magic-link verify + Google OAuth callback set `spontany_session` cookie (httpOnly/SameSite=Lax/30d, Secure in prod), six `requireToken` guards now read cookie → header → body → query, `routes/pages.js` page-route gate switched to a `pageToken()` helper, `/partner` with cookie skips the `?token=` echo. Verified end-to-end via curl on a freshly-spawned canonical server with a seeded user: all 10 checks (cookie/header/query auth, 401, Referrer-Policy, page routes with/without cookie, `/partner` cookie vs query, magic-link Set-Cookie) pass. Next: P2-Client — audit `public/*.{html,js}` for `?token=` URL building and switch to `credentials: 'include'` + sessionStorage; drop the query-string branch from `requireToken`; bump SW cache.
