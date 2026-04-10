# Spontany Campaign Analytics Manual

## What this system does

You have a first-party analytics system that tracks every step of the match flow funnel. When someone clicks your Meta ad, their journey is recorded: which ad hook brought them, what device they're on, how far they get in the flow, and whether they sign up or send an invite.

This gives you data Meta can't: not just who clicked, but who actually engaged.

---

## Part 1: Pre-Launch Prep

### 1.1 Set up your ad links with UTM parameters

Every ad link must include UTM parameters. This is how the system knows which ad brought each user.

**Format:**
```
https://spontany.io/match?utm_source=meta&utm_medium=paid&utm_campaign=CAMPAIGN_NAME&utm_content=HOOK_NAME
```

**What each parameter means:**

| Parameter | What to put | Example |
|-----------|------------|---------|
| `utm_source` | The platform | `meta`, `tiktok`, `x`, `google` |
| `utm_medium` | Paid or organic | `paid`, `organic`, `social` |
| `utm_campaign` | Your campaign name | `know_before_you_ask`, `dfw_launch` |
| `utm_content` | **The specific ad creative/hook** | `hook_groupchat`, `hook_custody_overlap`, `hook_weekend` |

**`utm_content` is the most important one.** This is how you compare which hooks work. Use a short, descriptive name for each creative variation. Keep it lowercase, use underscores.

**Example ad links for 4 different creatives:**
```
https://spontany.io/match?utm_source=meta&utm_medium=paid&utm_campaign=know_before_you_ask&utm_content=hook_groupchat
https://spontany.io/match?utm_source=meta&utm_medium=paid&utm_campaign=know_before_you_ask&utm_content=hook_custody_overlap
https://spontany.io/match?utm_source=meta&utm_medium=paid&utm_campaign=know_before_you_ask&utm_content=hook_weekend_plans
https://spontany.io/match?utm_source=meta&utm_medium=paid&utm_campaign=know_before_you_ask&utm_content=hook_sexy_freedom
```

### 1.2 Where to put the link in Meta Ads Manager

1. Go to **Ads Manager > Create Campaign**
2. At the **Ad level**, find the **Website URL** field
3. Paste your full UTM link there (not just `spontany.io`)
4. Meta will automatically append `fbclid` to the URL -- the system captures that too

### 1.3 Test the tracking before going live

Before spending money, verify everything works:

1. Open your ad link in a browser (or incognito window):
   ```
   https://spontany.io/match?utm_source=meta&utm_medium=paid&utm_campaign=test&utm_content=test_hook
   ```

2. Click through the match flow: splash > schedule > fork > result

3. Open your admin dashboard:
   ```
   https://spontany.io/admin?token=YOUR_ADMIN_TOKEN
   ```

4. Click the **Analytics** tab

5. You should see:
   - 1 session under `test_hook` in the funnel table
   - The steps you completed should show as numbers
   - Device should show `mobile` or `desktop`

6. **Delete test data** before launch (optional -- a few test rows won't matter with real traffic)

### 1.4 Verify Meta Pixel is firing

1. Install the **Meta Pixel Helper** Chrome extension
2. Visit `https://spontany.io/match?utm_source=test`
3. The extension icon should show a green checkmark
4. Events you should see: `PageView`, then `MatchStarted` when you enter the schedule screen

### 1.5 Pre-launch checklist

- [ ] Each ad creative has a unique `utm_content` value
- [ ] All ad links point to `/match?utm_source=...` (not just `/match`)
- [ ] Test click-through works in incognito
- [ ] Admin dashboard Analytics tab loads and shows test data
- [ ] Meta Pixel Helper shows events firing
- [ ] DFW opportunities are preloaded in the database (so the result screen has real suggestions)

---

## Part 2: How to See the Data

### 2.1 The Admin Dashboard

**URL:** `https://spontany.io/admin?token=YOUR_ADMIN_TOKEN`

Click the **Analytics** tab. Everything is here.

### 2.2 What's on the dashboard

**Summary cards (top row):**
- **Total Sessions** -- how many people landed on the match page
- **Signups** -- how many entered their email to create an account
- **Invites Sent** -- how many sent a date invite to their match partner
- **Conv Rate** -- signups / sessions (your overall conversion rate)

**Match Funnel by Ad Hook (main table):**

| Column | What it means |
|--------|--------------|
| Hook | The `utm_content` value -- your ad creative name |
| Sessions | People who landed on the match splash screen |
| Started | People who entered the custody schedule picker |
| Fork | People who reached the "manual entry or send link" choice |
| Result | People who saw their match result |
| Signup | People who entered email to create an account |
| Invite | People who sent a date invite |
| Conv % | Signup / Sessions -- conversion rate for this hook |

**Person B Viral Loop:**
- **B Started** -- how many Person B's arrived via a shared match link
- **B Filled Schedule** -- how many entered their schedule
- **B Completed** -- how many finished the flow
- **B Conv %** -- completion rate of Person B's

**Device Breakdown:** Sessions split by mobile / tablet / desktop

**Source Breakdown:** Sessions by platform (meta, tiktok, etc.)

**Step Timing:** Average time (in seconds) users spend reaching each step. High numbers = friction. Low numbers = smooth flow.

**Daily Sessions:** Sessions per day -- shows your traffic pattern over the campaign.

### 2.3 When to check

- **Day 1:** Check within a few hours of launch to make sure events are flowing
- **Day 2-3:** First meaningful data. Look at the funnel shape.
- **Day 7:** Mid-campaign review. Make budget decisions.
- **Day 14:** Campaign wrap-up. Full analysis.

Don't check every hour. The numbers need time to accumulate.

---

## Part 3: What to Look For

### 3.1 The funnel shape tells you WHERE the problem is

A healthy match funnel looks like:
```
Sessions:  100
Started:    70  (30% drop at splash -- normal, some are accidental clicks)
Fork:       50  (30% drop at schedule -- might be confusing)  
Result:     40  (20% drop -- some abandon at the choice screen)
Signup:     15  (25% convert to signup from result)
Invite:      8  (half of signups send an invite)
```

**What each drop-off tells you:**

| Drop-off point | What it means | What to do |
|---------------|---------------|------------|
| Sessions > Started is huge (>50%) | Your splash screen isn't compelling, or the ad attracted wrong audience | Change splash copy, or tighten ad targeting |
| Started > Fork is huge | The custody schedule picker is confusing | Simplify the picker UX |
| Fork > Result is huge | People are dropping at the manual/link choice | Reduce friction at fork, maybe auto-choose |
| Result > Signup is low | The result screen isn't convincing enough to sign up | Improve value prop on result page |
| Signup > Invite is low | People sign up but don't engage with suggestions | Better activity suggestions, clearer CTA |

### 3.2 Compare hooks -- this is the money insight

The funnel table is grouped by `utm_content` (your ad hook). Compare them:

```
hook_groupchat:       100 sessions → 15 signups (15% conv)
hook_custody_overlap:  80 sessions → 18 signups (22% conv)  <-- WINNER
hook_weekend_plans:   120 sessions → 10 signups  (8% conv)  <-- waste
hook_sexy_freedom:     60 sessions →  3 signups  (5% conv)  <-- cut this
```

**The hook with the highest Conv % is your winner**, not the one with the most sessions. Meta optimizes for clicks, but you want signups.

**Action:** After day 3-5, shift budget toward the highest-converting hooks. Kill hooks below 5% conversion.

### 3.3 Device tells you if it's a UX problem or an ad problem

If mobile converts at 5% but desktop converts at 20%, the match flow has a mobile UX issue -- not a hook problem. Fix the UX before scaling spend.

Typical expectation: 80%+ of Meta ad traffic will be mobile.

### 3.4 Person B is your viral coefficient

This measures free growth:
- If 50 Person A's create matches and 20 Person B's complete theirs, your viral coefficient is 0.4
- Anything above 0.3 is good for this type of tool
- If B Conv % is low, the shared link experience needs work

### 3.5 Step timing reveals hidden friction

Look at the **avg seconds** column:

| Step | Healthy | Problem |
|------|---------|---------|
| splash → your_schedule | 3-10s | >30s means people are hesitating |
| your_schedule → fork | 20-60s | >120s means the picker is confusing |
| fork → result | 10-30s | >60s means the choice screen is unclear |

### 3.6 Daily sessions show campaign health

- **Steady line:** Campaign is running normally
- **Spike then drop:** Meta exhausted your audience, consider broadening targeting
- **Climbing:** Meta's algorithm is finding your audience, good sign

---

## Part 4: Decision Framework

### After Day 3: First decisions

| Signal | Action |
|--------|--------|
| One hook converts 2x better than others | Shift 50% of budget to winner |
| A hook has <3% conversion | Pause it |
| Mobile conv is half of desktop | Prioritize mobile UX fix |
| Person B completion is <20% | Improve the shared match link experience |

### After Day 7: Mid-campaign

| Signal | Action |
|--------|--------|
| Clear winner hook emerged | Shift 70%+ budget to it |
| Daily sessions declining | Broaden audience or refresh creatives |
| Funnel drops sharply at one step | Fix that step's UX before spending more |
| Person B traffic is growing | Your viral loop is working -- double down |

### After Day 14: Wrap-up

Calculate your actual cost per engaged user:

```
Total ad spend:           $1,000
Total signups:            150
Cost per signup:          $6.67

Best hook signups:        80
Best hook spend:          $400
Best hook cost/signup:    $5.00  <-- this is what matters for next campaign
```

Compare this to Meta's reported cost-per-click. Your cost-per-signup is the real number.

---

## Part 5: Quick Reference

### Your key URLs

| What | URL |
|------|-----|
| Match page (with UTM) | `https://spontany.io/match?utm_source=meta&utm_medium=paid&utm_campaign=YOUR_CAMPAIGN&utm_content=YOUR_HOOK` |
| Admin dashboard | `https://spontany.io/admin?token=YOUR_ADMIN_TOKEN` |
| Landing page | `https://spontany.io` |

### Events tracked (in funnel order)

| Event | Fires when |
|-------|-----------|
| `match_splash` | User lands on match page |
| `match_your_schedule` | User enters schedule picker |
| `match_fork` | User reaches manual/link choice |
| `match_their_schedule` | User enters partner's schedule manually |
| `match_send_link` | User chooses to send a link |
| `match_signup_wait` | User enters name + email |
| `match_waiting` | User is waiting for Person B |
| `match_result` | User sees match result |
| `match_created` | Match request saved to database |
| `match_signup` | User signs up for full account |
| `match_invite_sent` | User sends a date invite |

### Data captured with every event

- UTM source, medium, campaign, content
- Facebook click ID (fbclid)
- Referrer URL
- Device type (mobile/tablet/desktop)
- Timezone + offset
- Person A or Person B role
- Elapsed time since session start
- Session ID (groups all events from one visit)

### Meta Pixel events (sent to Facebook for ad optimization)

| Event | Where |
|-------|-------|
| `PageView` | Match page load + Landing page load |
| `MatchStarted` | Schedule picker entered |
| `MatchCompleted` | Result screen reached |
| `Lead` | Signup submitted (match + landing page) |
| `MatchInviteSent` | Date invite sent |
