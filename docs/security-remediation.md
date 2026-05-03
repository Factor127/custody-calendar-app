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

### [ ] H2 — Host-header injection in cron emails
- **Where:** `server.js:923` (digest), audit other places computing BASE_URL.
- **Why:** `BASE_URL = process.env.BASE_URL || \`https://${req.headers.host}\`` lets an attacker control link domain in outbound emails.
- **Fix sketch:** at server boot, if `process.env.NODE_ENV === 'production'` and `!process.env.BASE_URL`, log error and `process.exit(1)`. Remove all `req.headers.host` fallbacks; always use `app.locals.BASE_URL`.
- **Commit:** _pending_

### [ ] H3/H4/H5/H8 — Rate-limit unauth endpoints
- **Where:** new `utils/rateLimit.js` extracted from `routes/auth.js`. Apply to: `/api/share/create`, `/api/lp/signup`, `/api/match/create`, `/api/match/invite`, `/api/waitlist`. Add a per-phone limiter for SMS-sending paths.
- **Why:** SMS toll fraud, magic-link bombing, signup spam.
- **Fix sketch:** export `rateLimit({ keyFn, windowMs, max })` middleware. Default `keyFn = req => req.ip`. SMS endpoints additionally use `keyFn = req => req.body.phone` with tighter quota.
- **Commit:** _pending_

### [ ] H10 — Use `requireAdmin` helper in server.js inline routes
- **Where:** `server.js:164`, `server.js:172`.
- **Why:** drift risk; admin auth changes (like the recent header-only migration) need to be made in two places.
- **Fix sketch:** export `requireAdmin` from `routes/admin.js`, import in `server.js`, replace inline checks.
- **Commit:** _pending_

---

## Phase 2 — Move tokens out of URLs (Route A)

Server-side first, then client. Two sessions.

### [ ] P2-Server — Server accepts cookie OR header
- Magic-link verify (`/api/auth/verify/:token`) sets `Set-Cookie: spontany_session=<token>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=...`.
- Google OAuth callback does the same.
- `requireToken` reads in order: `req.cookies.spontany_session` → `req.headers['x-access-token']` → `req.body.token` → `req.query.token`. Query is still accepted in this session for back-compat — removed in P2-Client.
- Page routes (`/calendar`, `/profile`, `/connections`, `/kids-export`, `/partner`, `/admin`) read cookie instead of `?token=`.
- Add `Referrer-Policy: same-origin` to all responses (cheap, blunts remaining query-string leakage during transition).
- Add `cookie-parser` dep.

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
