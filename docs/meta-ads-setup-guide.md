# Meta Ads Manager — Step-by-Step Setup Guide
## Spontany "Match Check" Campaign

**Budget:** $100-140 | **Duration:** 10-14 days | **Platform:** Meta (Facebook + Instagram)

---

## Before You Start — Checklist

- [ ] Meta Business Suite account (business.facebook.com)
- [ ] Facebook Page for Spontany (even a basic one)
- [ ] Instagram account connected to the Facebook Page
- [ ] Payment method added to Ads Manager
- [ ] 6 ad creatives exported from Canva (MP4 if video, PNG if static)
- [ ] Match page live at spontany.io/match

---

## Step 1: Set Up Meta Pixel (5 minutes)

This tracks what happens after someone clicks your ad.

1. Go to **business.facebook.com** → **Events Manager** (left sidebar)
2. Click **Connect Data Sources** → **Web** → **Meta Pixel**
3. Name it "Spontany Pixel" → Click **Create Pixel**
4. Choose **Install code manually**
5. Copy the pixel base code snippet
6. Paste it into `public/match.html` inside the `<head>` tag (I'll do this for you after)
7. Click **Continue** → **Done**

**Why this matters:** Without the pixel, you're flying blind. With it, you can see how many clickers actually used the match tool or signed up.

---

## Step 2: Create the Campaign (10 minutes)

1. Go to **Ads Manager** (adsmanager.facebook.com)
2. Click **+ Create** (green button, top left)

### Campaign Level

3. **Campaign objective:** Choose **Traffic**
   - NOT "Awareness" (too broad, no clicks)
   - NOT "Conversions" (you don't have enough pixel data yet)
   - Traffic = optimized for link clicks = exactly what you want
4. **Campaign name:** `Spontany — Match Check — Test`
5. Leave **Advantage Campaign Budget** ON
6. Set **Daily budget:** `$10`
7. Click **Next**

---

## Step 3: Set Up the Ad Set (10 minutes)

### Ad Set name
8. Name it: `Match Check — Core Audience`

### Conversion location
9. **Conversion location:** Website
10. **Performance goal:** Maximize number of link clicks

### Budget & Schedule
11. Budget is already set at campaign level ($10/day)
12. **Start date:** Today (or whenever you're ready)
13. **End date:** Set to 14 days from start date
    - This caps your spend at ~$140 max

### Audience

14. **Location:** United States (or your target country)
15. **Age:** 30 – 55
16. **Gender:** All (we're testing this!)

17. **Detailed Targeting — Add interests:**
    Click "Browse" or search for these. Add all of them (they work as OR, not AND):

    **Relationship/Life stage:**
    - Divorce
    - Divorced (relationship status)
    - Single parent
    - Co-parenting

    **Dating:**
    - Dating
    - Online dating
    - Hinge (dating app)
    - Bumble
    - Match.com
    - Dating after divorce

    **Parenting:**
    - Custody
    - Child custody
    - Parenting

18. **Exclusions** (click "Exclude people"):
    - Family law attorney
    - Divorce lawyer
    (These people are in crisis mode, not dating mode)

### Placements
19. Choose **Advantage+ placements** (recommended)
    - Let Meta optimize where your ads show
    - It will automatically test FB Feed, IG Feed, Stories, Reels, etc.
    - This is the best approach for a test campaign

20. Click **Next**

---

## Step 4: Create the 6 Ads (20 minutes)

You'll create 6 ads inside this one ad set. All 6 run simultaneously — Meta auto-optimizes delivery.

### Ad 1W — Know before you ask (Woman)

21. **Ad name:** `Hook1 — Know before you ask — W`
22. **Identity:** Select your Spontany Facebook Page + Instagram account
23. **Ad setup:** Choose **Single image or video**
24. **Media:** Upload your woman version creative (video or image)
25. **Primary text:**
    ```
    Not sure when they have the kids?
    Now you can check — before the conversation gets awkward.
    ```
26. **Headline:** `Know before you ask.`
27. **Description:** `Free. Private. Takes 30 seconds.`
28. **Call to action button:** Choose **Learn More**
29. **Website URL:**
    ```
    https://spontany.io/match?utm_source=meta&utm_medium=paid&utm_campaign=match-check&utm_content=hook1
    ```
30. Click **Publish** — or **duplicate** this ad to create the next one faster

### Ad 1M — Know before you ask (Man)

31. **Duplicate Ad 1W** (click the three dots → Duplicate)
32. **Ad name:** `Hook1 — Know before you ask — M`
33. **Media:** Swap to the man version creative
34. Everything else stays the same
35. **Save**

### Ad 2W — We matched (Woman)

36. **Duplicate** any existing ad → rename to `Hook2 — We matched — W`
37. **Media:** Upload woman "We matched" creative
38. **Primary text:**
    ```
    You swiped right. They swiped right.
    But do your Tuesday nights actually line up? Find out in 30 seconds.
    ```
39. **Headline:** `Check your schedule match.`
40. **Description:** `Two custody calendars. One answer.`
41. **Website URL:** Change `utm_content=hook1` → `utm_content=hook2`
42. **Save**

### Ad 2M — We matched (Man)

43. **Duplicate Ad 2W** → rename to `Hook2 — We matched — M`
44. **Media:** Swap to man version
45. **Save**

### Ad 3W — You're great but (Woman)

46. **Duplicate** → rename to `Hook3 — Great but — W`
47. **Media:** Upload woman "You're great, but..." creative
48. **Primary text:**
    ```
    You've gotten this text. Or sent it.
    The polite exit when the schedules just don't line up.
    What if you knew before it got to that?
    ```
49. **Headline:** `Skip the letdown. Check first.`
50. **Description:** `Free schedule check for co-parents dating again.`
51. **Website URL:** Change to `utm_content=hook3`
52. **Save**

### Ad 3M — You're great but (Man)

53. **Duplicate Ad 3W** → rename to `Hook3 — Great but — M`
54. **Media:** Swap to man version
55. **Save**

---

## Step 5: Review & Publish

56. Click **Review** to see all 6 ads
57. Verify:
    - [ ] All 6 ads have the correct creative uploaded
    - [ ] All URLs have the right utm_content parameter (hook1/hook2/hook3)
    - [ ] Primary text, headline, description are correct for each hook
    - [ ] CTA button is "Learn More" on all
58. Click **Publish**
59. Ads go into Meta review (~15 min to 24 hours, usually fast)

---

## Step 6: Monitor & Optimize

### Day 1-2: Patience
- Ads are in "learning phase" — Meta is figuring out who to show them to
- Don't touch anything
- Check that ads were approved (you'll get a notification if rejected)

### Day 3-4: First Read
Open Ads Manager → Click into your campaign → Go to the **Ads** tab

**Add these columns:** (Click "Columns" → "Customize Columns")
- Results (link clicks)
- Cost per result (CPC)
- CTR (link click-through rate)
- Impressions
- Amount spent

**Then:** Click **Breakdown** → **By Delivery** → **Gender**

Now you can see performance split by:
- Which hook works best (compare hook1 vs hook2 vs hook3)
- Which gender responds more (compare M vs W versions)
- Which combination wins (e.g., hook2 + women might crush it)

### Day 5: First Kill
- **Turn off the 2 worst-performing ads** (lowest CTR)
- 4 ads remain — budget concentrates on winners
- To turn off: toggle the ad's status from Active → Paused

### Day 7: Second Kill
- Turn off 2 more underperformers
- 2 ads remain — your budget now fully backs the winners

### Day 10-14: Final Read
Pull your numbers:

| What | Where to find it |
|------|------------------|
| Total spent | Campaign level → "Amount Spent" |
| Total clicks | Campaign level → "Results" |
| Avg CPC | Campaign level → "Cost per Result" |
| Best hook | Compare CTR across hook1/hook2/hook3 |
| Best gender | Breakdown → Gender |
| Signups | Your Spontany database (check match completions + email signups) |

---

## Benchmarks — What "Good" Looks Like

| Metric | Bad | OK | Good | Great |
|--------|-----|-----|------|-------|
| CTR (link) | <0.5% | 0.5-1% | 1-2% | >2% |
| CPC | >$3 | $1.50-3 | $0.75-1.50 | <$0.75 |
| CPM | >$30 | $15-30 | $10-15 | <$10 |

---

## What You'll Learn From This Campaign

Even if you get zero signups, you'll have concrete data on:

1. **Which hook resonates** — know before you ask / we matched / you're great but
2. **Which gender cares more** — where to focus future spend
3. **Your CPC** — how much it costs to get someone to the match page
4. **Your CPM** — how expensive this audience is to reach
5. **Creative direction** — which visual style (deliberating / excited / bored) gets attention

This data is worth way more than $140. It tells you exactly what to build your next campaign around.

---

## Quick Reference — Campaign Structure

```
Campaign: Spontany — Match Check — Test
  Budget: $10/day, 14 days
  Objective: Traffic (link clicks)
  │
  └── Ad Set: Match Check — Core Audience
      Age: 30-55, US, interests in divorce/dating/co-parenting
      Placements: Advantage+
      │
      ├── Ad 1W: Hook1 — Know before you ask — W
      ├── Ad 1M: Hook1 — Know before you ask — M
      ├── Ad 2W: Hook2 — We matched — W
      ├── Ad 2M: Hook2 — We matched — M
      ├── Ad 3W: Hook3 — Great but — W
      └── Ad 3M: Hook3 — Great but — M
```

---

## Ad URLs (copy-paste ready)

**Hook 1:**
```
https://spontany.io/match?utm_source=meta&utm_medium=paid&utm_campaign=match-check&utm_content=hook1
```

**Hook 2:**
```
https://spontany.io/match?utm_source=meta&utm_medium=paid&utm_campaign=match-check&utm_content=hook2
```

**Hook 3:**
```
https://spontany.io/match?utm_source=meta&utm_medium=paid&utm_campaign=match-check&utm_content=hook3
```
