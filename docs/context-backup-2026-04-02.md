# Session Context Backup — 2026-04-02

## What was done in this session

### 1. Calendar day cell colors
- `td.r` (R's custody days / has kids) → purple `rgba(124,92,191,0.22)` with `rgba(167,139,250,0.18)` border
- `td.z` (co-parent days / R is free) → lime `rgba(230,249,82,0.12)` with `rgba(230,249,82,0.22)` border

### 2. Landing page added at root
- `public/landing.html` → served at `GET /`
- Login moved to `GET /login` (was at `/`)
- All unauthenticated redirects updated from `/` → `/login`
- Signup form wired to `/api/auth/request` (real magic-link endpoint)
- Nav has "Log in" link

### 3. Onboard.html restructured (4 intro slides, new steps)
New flow:
**Intro (4 slides) → Step 1 (name/phone/city) → Photo → Bridge → Personal (relationship status) → [if separated: Parent → Custody → Calendar Review] → Work → Done**

Key changes from original:
- 4th intro slide: "Spontany is your social calendar"
- Step 1 header: "Let's set you up" (was "Let's learn about you")
- Age field removed entirely
- New `step-photo` moved to right after step 1 (was at end)
- New `step-bridge`: "Now let's build your timeline" — 3 visibility bullet points
- New `step-personal`: "Let's understand your lifestyle rhythm." — relationship status chips only
- `personalNext()` routes custody flow only for `relStatus === 'separated'`
- Work step title: "Work also determines our rhythm — what does your work life look like?"
- `hasCustody` checks `relStatus === 'separated'` (was `!== 'married'`)
- Work step saves directly to `saveAndFinish()` (no longer returns to photo)

### 4. Contrast / white-on-lime fixes
**Root cause:** `styles.css` had `.btn-primary { color: white }` but every page aliases `--blue` to `#e6f952` (lime).

Fixes:
- `styles.css`: `.btn-primary` now uses `color: var(--btn-primary-text, white)`
- All lime pages (calendar, connections, login, onboard, profile): added `--btn-primary-text: #0e0e0e` to `:root`
- `connections.html`: added missing `#app-frame { background: #0e0e0e; ... }` base rule — entire page was transparent, showing lime body through everything
- `calendar.html`:
  - `.sc-confirm-summary` / `.sc-confirm-tick` → `#0e0e0e` (lime confirm bar at bottom of smart-crafter)
  - `.sc-hover-tip-avatar` → `#0e0e0e`
  - `.person-select-check.checked` → `#0e0e0e`
  - `.tp-chip.selected` → `#0e0e0e`
  - `_SC_COLOR_PALETTE`: removed `#aec013` (lime), replaced with `#7c5cbf` — first contact was getting white initials on lime avatar
  - `.dss-free-avatar-circle` fallback → `#7c5cbf` (was `#aec013`)

### 5. Custody Compatibility Match tool — `GET /match`
New public route, no auth required.

**DB:** `match_requests` table (token, person_a/b name/email/schedule, status, timestamps)

**API endpoints** (`routes/match.js`):
- `POST /api/match/create` — Person A stores schedule, returns `{ token, match_url }`
- `GET /api/match/:token` — returns status + person_a_name (no emails; schedules only when completed)
- `POST /api/match/:token/complete` — Person B submits schedule

**Routes:**
- `GET /match` → `public/match.html`
- `GET /match/:token` → same (token read client-side)

**match.html JS flows:**
- Person A: schedule → fork → "Let them fill it in" → signup (name+email) → `POST /api/match/create` → waiting screen shows real shareable URL
- Person B: `/match/:token` detected on load → `GET /api/match/:token` → hero personalized to "[Name] wants to check your match" → schedule picker → signup → `POST /api/match/:token/complete` → fetch Person A's schedule → compute overlap client-side → show result
- `yourScheduleNext()` skips fork for Person B
- `submitSignup()` branches: Person B → `completeMatch()`, Person A → `createMatch()`

**Landing page:** "Match" nav link + `💑 New: Check your custody compatibility →` callout between features and stats

### 6. Logo replacement — logo 2 black naked
- `public/logo.svg` → replaced with `logo 2_black_naked.svg` (black paths, transparent bg)
- `public/icon.svg` → rebuilt: new mark in white on obsidian `#131321` background (rounded corners)
- `icon-192.png` / `icon-512.png` auto-regenerated from new `icon.svg` via Sharp on server start
- `calendar.html` `.app-logo`: added `filter: brightness(0) invert(1)` → black mark renders white on dark frame
- `profile.html` header logo: same invert filter added

### 7. Privacy policy + terms of service routes
Added to `routes/pages.js`:
- `GET /privacy-policy` → `public/privacy-policy.html`
- `GET /terms` → `public/terms-of-service.html`
- `GET /terms-of-service` → `public/terms-of-service.html`

### 8. File consolidation from OneDrive
Copied from `C:/Users/ranme/OneDrive/Documents/spontany/` into project:

**Project root (source copies):**
- `match.html` (OneDrive source, 42,881b — public/ has larger API-integrated version 50,739b, untouched)
- `onboard.html` (73,829b — newer than previous public/ version 72,268b)
- `privacy-policy.html`
- `terms-of-service.html`
- `CLAUDE.md`

**`public/` (served versions):**
- `public/onboard.html` → replaced with OneDrive version (73,829b), old backed up as `public/onboard.html.bak`
- `public/privacy-policy.html` → copied
- `public/terms-of-service.html` → copied

**`docs/` (new folder):**
- All 8 strategy .md files + TASKS.md
- `dashboard.html` (internal launch dashboard, not served)
- `docs/campaign-1/` — all campaign assets
- `docs/logo-design/` — all logo design files
- `docs/graphics/` — top-level SVG/PNG assets

**Findings from consolidation:**
- `Spontany light/` — only contained `.claude/` session data. Empty of real content.
- `V2/` — didn't exist
- `Graphics/` in OneDrive — only had lock files; project already had full copy
- `landing.html` — identical in both (25,247b each)

---

## Current file structure (key files)

```
C:/Projects/custody-calendar-app/
├── server.js          — Express entry point
├── db.js              — DB schema + queries (includes match_requests table)
├── CLAUDE.md          — Brand/profile/preferences context
├── landing.html       — Source copy
├── match.html         — Source copy (OneDrive version, pre-API integration)
├── onboard.html       — Source copy (OneDrive version, newest)
├── privacy-policy.html
├── terms-of-service.html
├── routes/
│   ├── pages.js       — All page routes
│   ├── api.js         — Core API
│   ├── match.js       — Match tool API (new)
│   ├── auth.js
│   └── ...
├── public/
│   ├── calendar.html  — Main app calendar
│   ├── connections.html
│   ├── login.html
│   ├── landing.html   — Served at /  (has match callout + nav link)
│   ├── match.html     — Match tool (API-integrated, served at /match)
│   ├── onboard.html   — Onboarding wizard (newest version)
│   ├── onboard.html.bak
│   ├── profile.html
│   ├── privacy-policy.html
│   ├── terms-of-service.html
│   ├── icon.svg       — New logo mark, white on #131321
│   ├── logo.svg       — New logo mark, black paths (naked)
│   └── styles.css     — Shared styles (btn-primary-text var added)
├── Graphics/          — Full asset library (campaign, logos, animations)
└── docs/              — Strategy docs, dashboard, campaign assets
```

## Current routes summary
- `GET /` → `public/landing.html`
- `GET /login` → `public/login.html`
- `GET /calendar?token=` → `public/calendar.html`
- `GET /connections?token=` → `public/connections.html`
- `GET /profile?token=` → `public/profile.html`
- `GET /match` → `public/match.html`
- `GET /match/:token` → `public/match.html`
- `GET /privacy` → `public/privacy.html`
- `GET /privacy-policy` → `public/privacy-policy.html`
- `GET /terms` / `GET /terms-of-service` → `public/terms-of-service.html`
- `GET /invite/:token` → `public/onboard.html`
- `GET /rsvp/:token` → `public/rsvp.html`
- `GET /kids-export?token=` → `public/kids-export.html`
- `GET /admin?token=` → `public/admin.html`
- `GET /icon-192.png` / `GET /icon-512.png` → generated from `public/icon.svg` via Sharp

## Design system
- **Palette:** Lime `#e6f952` / obsidian `#0e0e0e` / dark purple `#131321`
- **Lime text rule:** All lime-background elements use `color: #0e0e0e` (not white)
- **`--btn-primary-text: #0e0e0e`** set on all lime pages
- **App frame:** `#app-frame { background: #0e0e0e; border-radius: 0 0 24px 24px; overflow: clip; }`
- **Body:** `background: linear-gradient(145deg, #e6f952, #aec013)` with responsive padding (10px mobile → 60px 860px+ → 100px 1280px+)
- **Custody cells:** `td.r` (has kids) = purple tint; `td.z` (free) = lime tint

## Hosting
- Railway (GitHub-connected, auto-deploys from main)
- Domain: spontany.up.railway.app
- DB: SQLite via better-sqlite3 on Railway persistent volume
