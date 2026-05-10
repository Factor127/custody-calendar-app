# Memory

## Me
Ran, solo founder building Spontany — a scheduling app for divorcees to manage custody constraints and coordinate plans with partners and friend groups.

## People
| Who | Role |
|-----|------|
| **Ran** | Founder, sole developer, does everything — code, design, marketing |

## Terms
| Term | Meaning |
|------|---------|
| Spontany | The app — scheduling/calendar for divorcees |
| PWA | Progressive Web App — how Spontany is deployed (not native app store) |
| Railway | Cloud hosting platform where Spontany backend runs |
| "Know before you ask" | Core campaign tagline / hook |
| R/Z days | LEGACY term — use **"custody days"** in user-facing copy. R/Z still appears in code/CSS class names (`td.r`, `td.z`) and is fine there. |
| Opportunities | Events/venues/activities that users can discover and plan around |
| Outcomes | Plans + outings generated from user-submitted opportunities |

## Projects
| Name | What |
|------|------|
| **Spontany MVP** | Node.js + Express + SQLite + Vanilla JS frontend, PWA. Hosted on Railway. **In production with ~8 real users (post-launch).** Major surfaces: calendar, partner invites, admin dashboard, push notifications, **Crafter wizard** (2-step plan creation), **Pulse** feed (saved venues + dated events), **Opportunities** matcher (kid-friendly + matching-custody friends), **Groups** (saved crews), **Match tool** (`/match`, no-auth custody compatibility check), **Demo mode**, **LP A/B variants** (`/match/demo?variant=…`), **SMS nudges** via Twilio, **Hotjar** analytics, **Web Share Target**. |
| **"Know Before You Ask" Campaign** | Pre-launch social ad campaign. $1K budget, Meta + TikTok + X. 4 ad sets, 48 Canva creatives. All docs in workspace folder. Target: 500+ signups in 2 weeks. |

## Stack
- **Backend:** Node.js (v22+), Express, SQLite (better-sqlite3)
- **Frontend:** Vanilla HTML/CSS/JS (no framework, no build step)
- **Email:** Resend
- **Images:** Sharp
- **Push:** web-push
- **SMS:** Twilio (nudge worker, `TWILIO_*` env vars)
- **Analytics:** Hotjar + custom `lpFunnel` / `nudgeStatus` events in `stats.js`
- **Hosting:** Railway (with persistent volume for DB)
- **Domains:** spontany.io, spontany.club (registered at GoDaddy, not yet pointed)
- **Design:** Canva
- **Code:** Built with Claude
- **Creative/Messaging:** ChatGPT for copy, image/video generation

## Security
**Production stance:** Spontany has real (non-friend) users with custody and kid PII in the SQLite DB on Railway. Treat security suggestions with prod weight, not pre-launch weight.

### Secrets
- Never read or paste `.env` files or service-account JSONs into chat. Reference env vars by NAME (e.g. `ANTHROPIC_API_KEY`), never values.
- Rotation order: generate new key → update Railway → redeploy → verify endpoint → **then** revoke old. Reversing this breaks prod.
- Service-account JSONs belong in Railway only. Delete from `~/Downloads` immediately after pasting.

### Auth surface (4 schemes — don't add a 5th)
- **Magic links (Resend):** tokens must be single-use and short-lived; verify before granting session.
- **`ADMIN_TOKEN`:** gates ops endpoints. Never log it, never echo in error messages, never include in URLs.
- **Google OAuth:** verify `state` param on callback to prevent CSRF.
- **Push subscriptions / VAPID:** subscription endpoints are user-bound; never accept a `userId` from the client without auth.

### Database
- All DB access via `db.prepare(...)` (better-sqlite3 prepared statements). Never string-concat or template-literal SQL.

### PII (custody/kid data)
- Don't log: kid ages, partner names, phone numbers, full custody-day arrays.
- Don't return PII in error messages to the client.
- Don't put PII in URL params (path or query) — leaks into Railway access logs and browser history.

### Frontend (vanilla JS PWA)
- User-generated text (event titles, partner names, opportunity descriptions) → use `textContent`, not `innerHTML`. If `innerHTML` is required, sanitize first.
- Service worker: don't cache authenticated responses or PII.

### Before merging any change
- New endpoints have an auth check before processing.
- New env var is set in Railway *before* merging code that reads it.
- No hardcoded secrets, tokens, or invite codes in committed files.
- Don't `git push` unless explicitly asked. Commit freely; pushing is user-triggered because Railway auto-deploys from `main` on push.

### 2FA / account security
2FA on every service. Authenticator app (or hardware key) — never SMS, SIM swap is the realistic threat for a domain owner. Priority order by blast radius:

1. **GoDaddy** — highest priority. Domain hijack = magic links break, push origin mismatch, Resend SPF/DKIM stop validating, can't even reset things because resets go to email on that domain. Also enable **registrar lock** (transfer lock) and confirm the recovery email isn't on a domain hosted at GoDaddy (circular dependency).
2. **Personal email (ranmer2000@gmail.com)** — recovery channel for everything else, effectively the master key. Hardware key here if anywhere.
3. **GitHub** — push to `main` auto-deploys to Railway, so compromised GitHub = compromised prod. Consider signed commits.
4. **Google OAuth admin (Google Cloud Console)** — compromised here means rotated client secret locks users out, or a malicious redirect URI phishes them.
5. **Railway, Resend, Twilio** — hold prod secrets / send on your behalf. Check Railway's GitHub deploy token doesn't bypass 2FA on re-auth.
6. **Anthropic, Hotjar, Canva, accounting tools, business bank** — lower blast radius but still required.

## Merge gates
Hard gates — a commit/PR cannot land without these passing. Not advice, not "load-bearing rules" — gates.

- **SW cache bump (enforced):** if any file in `public/` changes, `CACHE_VERSION` in `public/sw.js` MUST be incremented in the same commit/PR. Otherwise returning PWA users keep the stale cache and "the deploy didn't work."
  - **Local enforcement:** `.git/hooks/pre-commit` runs `scripts/check-sw-bump.js --staged`. Installed automatically by `npm install` (via the `prepare` script) or manually with `node scripts/install-hooks.js`.
  - **CI enforcement:** `.github/workflows/sw-cache-bump.yml` runs the same check on PRs touching `public/**` and on pushes to `main`.
  - **Bypass:** `git commit --no-verify` skips the local hook. Don't — the CI gate will still catch it on push, and you'll have wasted a deploy.

## PWA gotchas
These have all bitten more than once — treat as load-bearing rules, not suggestions.

- **Bump the service worker cache:** see **Merge gates** above — this is now enforced by a pre-commit hook + CI, not a habit. (Historical: commits like `sw: bump cache to v15`.)
- **Static assets must live in `public/`:** Express only serves from `public/`. Files in the repo root will 404 on Railway (carousel images burned us — see `context-backup-2026-04-02b.md`).
- **Android back button is part of the UX contract:** in any sheet, modal, overlay, or wizard step, back must close *that* — not exit the app. Spontany installs as a PWA on Android and exiting feels like a crash. Pattern: push a history state on open, listen for `popstate` to dismiss.
- **Web Share Target:** the `/share-target` route + SW intercept is fragile. Preserve `shareUrl` through any auth/login bounce — don't drop it in `history.replaceState` or token-fixup paths.

## Design system
Battle-earned rules from prior contrast/layout debugging — don't relitigate.

- **Palette:** lime `#e6f952` / obsidian `#0e0e0e` / dark purple `#131321`.
- **Lime text rule:** any lime background uses `color: #0e0e0e`, never white. Set `--btn-primary-text: #0e0e0e` on every lime page (`.btn-primary` falls back to white otherwise).
- **App frame:** `#app-frame { background: #0e0e0e; border-radius: 0 0 24px 24px; overflow: clip; }` — pages without this leak the lime body through and look broken.
- **Custody cells:** `td.r` (kid days) = purple tint `rgba(124,92,191,0.22)`; `td.z` (free days) = lime tint `rgba(230,249,82,0.12)`.
- **Logo on dark frames:** `filter: brightness(0) invert(1)` (the source SVG is black paths).

## Brand
- **Voice:** Smart, fun, mature, sexy
- **Colors:** see **Design system** above — lime `#e6f952` / obsidian `#0e0e0e` / dark purple `#131321`. Same palette across marketing and in-app.
- **Tagline:** "Finds your moments before they slip away."
- **Target audience:** Divorcees 35–55 with kids aged 0–14

## Preferences
- Solo founder — keep recommendations practical for one person
- Uses Claude for code/planning, ChatGPT for creative/messaging, Canva for design
- Prefers to build things himself rather than use heavy platforms
- Asks smart strategic questions — treat as a technical founder who thinks about the full picture

## User research / Interviews
Spontany has a structured user-research workflow. It exists because the project's biggest historical gap was building before talking — and the next phase is wedge-validation, which means interviews are now first-class.

**Canonical guide:** `docs/interview-guide.md` — the 32-question script with stable IDs (Q1–Q32, QP1–QP6) and type tags (REPLAY, BEHAVIOR, COUNTERFACTUAL, etc.). If you change a question, change it here first.

**Interview corpus:** `strategy/interviews/` — one markdown file per interview, named `YYYY-MM-DD-firstname.md`. The folder has its own README explaining the convention. The template lives at `strategy/interviews/_template.md`.

**Admin tracker:** `/admin?token=…` → Interviews tab. Lightweight DB-backed list of all interviews with synthesis fields and follow-up status. Schema lives in `db.js` (`interviews` table). Endpoints in `routes/admin.js` under `/api/admin/interviews/*`. The admin tab is for tracking and synthesis; the full Q&A still lives in markdown files.

**Slash command:** `/new-interview` scaffolds a new interview file from the template — picks today's date, copies the template, fills in the basics. Use it instead of doing the copy manually.

**Workflow:**
1. Before an interview: copy `_template.md` → `YYYY-MM-DD-firstname.md` (or use `/new-interview`). Fill the Pre-Interview Setup table. Optionally create the matching admin row at `/admin → Interviews → New`.
2. Record audio with consent; store outside the repo if sensitive.
3. Within 24 hours: fill the **Synthesis** section at the top of the markdown file (3 fields). This is the durable artifact — even if the per-question answers never get filled in, the synthesis is what compounds across interviews.
4. Mirror the synthesis to the admin row so it's queryable from the dashboard.

**Cross-interview synthesis:** when there are 5+ interviews in the corpus, do a meta-pass — open every file, copy the three synthesis items into one document, look for patterns. Q30 answers (the "what would they need to see in the first 30 seconds" question) are the most strategically valuable thing in the entire corpus — they're the wedge headline candidates.

**PII rule:** first names only in committed files. No phone numbers, no exact addresses, no kid names. Audio files with sensitive content stay outside the repo.

## Session context backups
Older session backups exist under `docs/context-backup-*.md` if needed for archaeology, but the durable rules from them have been promoted into the sections above. Don't read them by default — `git log` and the current code are more reliable.
