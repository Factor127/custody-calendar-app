# Spontany Meta Ads Campaign - Full Context for Continuation

## Who You're Talking To
Ran, solo founder of Spontany - a scheduling PWA for divorcees to manage custody constraints and coordinate plans with partners and friend groups. First-ever ad campaign. Technical founder who thinks strategically but has zero Meta Ads experience.

## What Spontany Is
A scheduling/calendar app for co-parents dating again. The core value prop: "See if your free nights line up before the conversation gets awkward." Target audience: divorced parents aged 35-55 with kids 0-14.

## Brand
- **Colors:** Dark bg #0a0a0a / #0e0e0e, lime accent #e6f952 / #e7f848, Inter font
- **Voice:** Smart, fun, mature, sexy
- **Tagline:** "Finds your moments before they slip away."

---

## The Campaign: "Match Check"

A light-commitment CTA where early-dating pairs can check if their custody schedules are compatible. The landing page is `public/match.html` - a multi-step tool where you tap your custody days, invite a match, and see overlap.

### Budget & Structure
- **Budget:** ~$10/day (₪37/day), 14 days, ~$140 total
- **Platform:** Meta (Facebook + Instagram)
- **Objective:** Traffic (link clicks)
- **Campaign name:** `Spontany - Match Check - Test`

### 3 Ad Hooks (x2 genders = 6 ads total)

**Hook 1: "Know before you ask."**
- Visual: 35-yr-old with a deliberating expression, living room setting
- Primary text: "Not sure when they have the kids? Now you can check - before the conversation gets awkward."
- Headline: "Know before you ask."
- Description: "Free. Private. Takes 30 seconds."
- UTM: utm_content=hook1

**Hook 2: "We matched. Now let's see if our weeks do too."**
- Visual: Excited surprise looking at phone, cafe setting
- Primary text: "You swiped right. They swiped right. But do your Tuesday nights actually line up? Find out in 30 seconds."
- Headline: "Check your schedule match."
- Description: "Two custody calendars. One answer."
- UTM: utm_content=hook2

**Hook 3: "You're great, but our schedules just don't work."**
- Visual: Polite bored/exit energy, restaurant setting
- Primary text: "You've gotten this text. Or sent it. The polite exit when the schedules just don't line up. What if you knew before it got to that?"
- Headline: "Skip the letdown. Check first."
- Description: "Free schedule check for co-parents dating again."
- UTM: utm_content=hook3

Each hook has a male (M) and female (W) version = 6 ads total.

### Ad Format
- 4:5 ratio (1080x1350) - 25% more screen real estate than 1:1 on Meta feed
- Video ads created in Canva (user designed them manually)
- CTA button: "Learn More"
- Pill-shaped CTAs in the creative itself

### Ad URLs (copy-paste ready)
```
Hook 1: https://spontany.io/match?utm_source=meta&utm_medium=paid&utm_campaign=match-check&utm_content=hook1
Hook 2: https://spontany.io/match?utm_source=meta&utm_medium=paid&utm_campaign=match-check&utm_content=hook2
Hook 3: https://spontany.io/match?utm_source=meta&utm_medium=paid&utm_campaign=match-check&utm_content=hook3
```

---

## What's Already Done

### Meta Business Setup (ALL COMPLETE)
- [x] Meta Business Suite account: "Spontany" (Business ID: 1911271506244707)
- [x] Facebook Page: "Spontany" (ID: 6157542295352)
- [x] Instagram account: ran.merkazy (display name "Spontany") - connected. Username needs renaming to spontany.io or spontany_app later (do from mobile app)
- [x] Ad account: "Spontany Ads" (ID: 35446603578258080) - created under Spontany business portfolio
- [x] Payment method: Visa ending 3026, currency ILS (₪)
- [x] Facebook Page description updated

### Campaign Build (IN PROGRESS - partially done in Ads Manager)
- [x] Campaign created: "Spontany - Match Check - Test"
- [x] Objective: Traffic
- [x] Budget strategy: Campaign budget (Advantage+), ₪37/day
- [x] Ad set created: "Match Check - All Hooks - 35-55"
- [x] Conversion: Website, maximize link clicks
- [x] Audience saved: "Parents 35-55 Dating Divorced"
  - Location: Dallas-Ft. Worth, TX (Comscore Market) - single US metro for focused learning
  - Minimum age: 25 (Meta's hard floor), Advantage+ audience age: 35-55
  - Language: English (UK) or English (US)
  - Detailed targeting: Parenting/Family interests, Relationship status: Single, Parents with children of various ages, Facebook access (mobile), Life event: Friends of people with birthdays
  - Note: Could also add Divorce, Online dating, Single parent interests for sharper targeting
- [x] Placements: Advantage+ (recommended)
- [x] Identity set: Facebook Page = Spontany, Instagram = ran.merkazy
- [ ] **START DATE NEEDS FIXING** - was set to Apr 5 (in the past). Must reset to today.
- [ ] **END DATE NOT SET** - should be set to 14 days from start

### Ad Creative Level (NOT YET STARTED - this is where to resume)
- [ ] Upload 6 video/image creatives from Canva
- [ ] Write ad copy for each (primary text, headline, description - see hooks above)
- [ ] Set destination URLs with UTM parameters for each
- [ ] Set CTA button to "Learn More" for all
- [ ] Review and publish

### Landing Page (match.html - COMPLETE)
- [x] Splash screen added (brand intro for cold ad traffic)
- [x] All emojis replaced with Spontany logo SVG
- [x] All em dashes replaced with hyphens
- [x] Lime wordmark logo at top of page
- [x] End CTA with Spontany pitch cards (key capabilities + signup)
- [x] Meta Pixel base code added (placeholder YOUR_PIXEL_ID - needs real pixel ID)
- [x] Custom pixel events: MatchStarted, MatchCompleted, Lead
- [x] UTM tracking: reads params from URL, stores in sessionStorage, attaches to Lead event
- [ ] **Replace YOUR_PIXEL_ID** with actual pixel ID from Events Manager (user needs to create pixel first)

### Canva Creatives
- User designed the ads manually in Canva after attempts to use Canva MCP API
- Videos created for at least Hook 1 (the user replaced static images with videos)
- Status of all 6 creatives is unclear - may need to finalize remaining hooks

---

## Optimization Plan (after launch)

### Day 1-2: Don't touch - learning phase
### Day 3-4: First read
- Add columns: Results, CPC, CTR, Impressions, Amount spent
- Use Breakdown > By Delivery > Gender to analyze
### Day 5: Kill 2 worst-performing ads
### Day 7: Kill 2 more
### Day 10-14: Final read - pull all metrics

### Benchmarks
| Metric | Bad | OK | Good | Great |
|--------|-----|-----|------|-------|
| CTR | <0.5% | 0.5-1% | 1-2% | >2% |
| CPC | >$3 | $1.50-3 | $0.75-1.50 | <$0.75 |
| CPM | >$30 | $15-30 | $10-15 | <$10 |

---

## Key Learnings / Corrections from Prior Conversation

1. **Canva MCP limitations:** generate-design-structured only supports presentations, not instagram_post. Use generate-design for IG posts. Can't upload local files (needs public URL). Export-then-import doesn't work reliably.
2. **4:5 not 1:1** for Meta feed ads - 25% more screen real estate.
3. **Minimum age in Meta hardcapped at 25** in Audience Controls - the real targeting age is set in Advantage+ audience section (35-55).
4. **One market for small budgets** - splitting $10/day across multiple countries dilutes learning. User chose Dallas-Ft. Worth.
5. **All 6 ads in one ad set** - don't create separate ad sets per hook. Let Meta auto-optimize, then use Breakdown > Gender to analyze.
6. **Gender testing approach:** Run all 6 ads (3 hooks x 2 genders), analyze via Breakdown by Gender in reporting.
7. **User designed creatives manually in Canva** after API attempts were frustrating. Don't try to automate Canva creative generation again.

---

## Immediate Next Steps (Resume Here)

1. **Fix start date** in ad set (reset to today)
2. **Set end date** to 14 days from today
3. **Build the 6 ads** at the Ad level:
   - Upload creatives from Canva
   - Enter copy for each hook (see exact copy above)
   - Set UTM URLs
   - Set CTA to "Learn More"
4. **Create Meta Pixel** in Events Manager
5. **Replace YOUR_PIXEL_ID** in match.html with actual pixel ID
6. **Review and publish** the campaign
7. **Verify ads approved** within 24 hours

---

## Reference Files
- `docs/meta-ads-setup-guide.md` - Full 58-step setup guide with campaign structure, targeting, ad copy, UTM URLs, optimization rhythm, and benchmarks
- `public/match.html` - The landing page (with pixel code, UTM tracking, splash screen)
- `public/logo.svg` - Lime circle icon
- `public/logo-wordmark.svg` - Full wordmark in lime (logo + "SPONTANY" text)
