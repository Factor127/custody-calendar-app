# A/B Testing Infrastructure — Implementation Brief

## Goal
Split incoming landing page traffic evenly across 3 variant pages (A, B, C) so we can measure which concept converts best. Variant assignment must be sticky (same visitor always sees the same page) and fully tracked in our existing analytics.

---

## What already exists (don't rebuild these)
- `server.js` line 57: `app.get('/', ...)` serves `public/landing.html`
- `public/js/tracker.js`: client-side analytics tracker, fires `page_view` on load, sets `s_vid` cookie (visitor ID) and `s_utm` cookie (UTM params), sends events to `POST /api/track`
- `routes/analytics.js`: ingests events into `analytics_events` table, serves admin funnel at `/admin/funnel`
- `public/funnel.html`: admin dashboard showing funnel, source breakdown, device split
- `db.js` lines 311–329: `analytics_events` table schema with `properties` JSON column

---

## Changes needed

### 1. Variant assignment middleware (`server.js`)

Add Express middleware on the `GET /` route that:

1. Checks for a cookie called `s_variant` on the incoming request
2. If no cookie exists, randomly assigns `"a"`, `"b"`, or `"c"` (equal 1/3 probability)
3. Sets `s_variant` cookie — 30 day expiry, `SameSite=Lax`, `Path=/`
4. Serves the matching file:
   - `"a"` → `public/landing-a.html`
   - `"b"` → `public/landing-b.html`
   - `"c"` → `public/landing-c.html`
5. If a query param `?variant=a` (or b/c) is present, force that variant (override cookie). This lets us preview each variant manually.

Use the `cookie-parser` middleware if not already installed (check first — may already be a dependency). If not present, install it.

### 2. Variant landing page files

- Copy `public/landing.html` → `public/landing-a.html`, `landing-b.html`, `landing-c.html`
- These are placeholders — I will replace the content myself with 3 different concepts. Just make sure each one:
  - Includes `<script src="/js/tracker.js" defer></script>` (same as current landing.html)
  - Has the correct structure so tracker.js fires on load

### 3. Pass variant into analytics (`tracker.js`)

Modify `tracker.js` so that:

1. On load, it reads the `s_variant` cookie value
2. Includes `variant` as a field in **every** event payload sent to `/api/track` (not just `page_view` — every event for that visitor should carry the variant so we can filter the full funnel by variant)
3. The variant value should be sent as a top-level field alongside `visitor_id`, `utm`, etc. — not buried inside `properties`

### 4. Store variant in the database (`routes/analytics.js` + `db.js`)

- Add a `variant` TEXT column to the `analytics_events` table (with a migration or an ALTER TABLE — don't break existing data)
- Add an index on `variant`: `CREATE INDEX IF NOT EXISTS idx_ae_variant ON analytics_events(variant)`
- Update the `POST /api/track` handler to read `variant` from the request body and insert it into the new column

### 5. Update the admin funnel dashboard

In `routes/analytics.js` (the `/admin/funnel` endpoint) and `public/funnel.html`:

- Add a **"Variant Performance"** section to the dashboard that shows, for each variant (A, B, C):
  - Total sessions (page_view count)
  - Key conversion steps: `match_started`, `signup_started`, `email_submitted`, `onboard_completed`
  - Conversion rate (email_submitted / page_view) per variant
- Add a variant filter/toggle at the top of the dashboard so I can view the entire funnel filtered to a single variant
- Keep the existing overall view as the default (all variants combined)

---

## What NOT to do
- Don't design or change the actual landing page content/HTML/CSS — I'll handle the 3 concepts myself
- Don't change any existing analytics events or funnel steps
- Don't add any third-party A/B testing tools or libraries
- Don't change the URL structure — all 3 variants serve from `/`, the routing is internal only

---

## Testing checklist
1. Visit `/` three times in incognito → verify you get assigned a variant and the cookie sticks
2. Visit `/?variant=b` → verify it forces variant B regardless of existing cookie
3. Check `/funnel` dashboard → verify variant breakdown section appears with real data
4. Confirm existing funnel tracking still works (no regressions in UTM tracking, visitor IDs, etc.)
5. Verify a new visitor's events all carry the same variant value through the full funnel
