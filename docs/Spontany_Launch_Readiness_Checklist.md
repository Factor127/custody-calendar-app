# Spontany — Launch Readiness Checklist

**Current state:** Functional MVP/PWA with calendar, partner flows, admin, push notifications, and engagement tracking.
**Stack:** Node.js + Express + SQLite + Vanilla frontend, deployed on Railway
**Assessment date:** March 31, 2026

---

## Launch Decision: Waitlist or Go Live?

Given the state of the codebase, Ran is approximately **1–2 weeks from being able to run ads directly to the live product** (Option B). The app is functional — the remaining work is testing, polish, and deploy hardening.

**Recommendation:** Spend the next 1–2 weeks on the checklist below, then launch ads pointing directly to the live PWA. Skip the waitlist — you're close enough that the friction of "join waitlist → wait → eventually try the app" would lose more people than the extra 1–2 weeks of prep.

---

## Week 1: Test & Fix (April 1–7)

### Core Flow Testing
Test each of these end-to-end with real people (not just yourself):

- [ ] **New user signup flow** — First visit → enter name → get personal calendar URL. Is it clear? Does it feel welcoming?
- [ ] **Partner invite flow** — You invite someone → they open link → answer 7 custody questions → request access → you approve → they see your calendar. Any friction points?
- [ ] **Calendar daily use** — Mark days, view partner's days, check friend availability. Does it feel intuitive on mobile?
- [ ] **Push notifications** — Do they arrive reliably? Are they useful or annoying?
- [ ] **URL submission** — Submit an event/venue URL → does it parse correctly? How's the confidence score?
- [ ] **Plans & outings** — Create a plan from an opportunity → does the flow make sense?
- [ ] **PWA install** — Install on iOS Safari and Android Chrome. Does it work as a standalone app? Icon correct? Splash screen OK?

### Bug Triage
After testing, categorize bugs as:
- **P0 — Launch blocker:** Crashes, data loss, broken core flows → fix before launch
- **P1 — Launch with warning:** Rough edges, cosmetic issues → fix in week 2 or post-launch
- **P2 — Post-launch:** Nice-to-haves, minor improvements → backlog

---

## Week 2: Polish & Deploy (April 8–14)

### Production Hardening
- [ ] **Railway deployment stable** — Persistent volume mounted at `/data`, `BASE_URL` and `DATABASE_PATH` env vars set correctly
- [ ] **Database backups** — Set up a daily backup of `calendar.db` (even a simple cron copying to a Railway volume or S3)
- [ ] **Error handling** — What happens when the server crashes? Does Railway auto-restart? Test this
- [ ] **Rate limiting** — Basic protection against abuse on API endpoints (especially partner invite and admin)
- [ ] **HTTPS confirmed** — Railway provides this by default, but verify

### Domain Setup
- [ ] **Point spontany.io to Railway** — Add custom domain in Railway settings, update DNS at GoDaddy
- [ ] **SSL certificate active** — Railway auto-provisions via Let's Encrypt
- [ ] **Test the full URL** — `https://spontany.io` loads the app correctly

### PWA Polish
- [ ] **Manifest verified** — Name, icons, theme color all correct (✅ already looks good)
- [ ] **Service worker** — Confirm offline behavior is acceptable (or at minimum doesn't crash)
- [ ] **iOS quirks** — Test "Add to Home Screen" on Safari. Check splash screen, status bar color

### Legal Minimum
- [ ] **Privacy policy page** — Simple page explaining what data you collect (names, emails, custody patterns), how it's stored, how to request deletion. Required for ads and good practice
- [ ] **Terms of service** — Basic terms. Can be simple for MVP. Consider a template
- [ ] **Cookie/tracking notice** — If you add Meta/TikTok pixels, you need to disclose tracking

### Content & Messaging
- [ ] **Landing/home page** — What does a new visitor see at `spontany.io`? Currently goes straight to `calendar.html`. Consider a brief landing page that explains what Spontany is before asking them to sign up
- [ ] **Onboarding copy** — Review all text the user sees during signup and partner invite. Is it clear? Does it match the brand voice (smart, fun, mature)?
- [ ] **Empty states** — What does the calendar look like with no data? Is there helpful guidance?

---

## Launch Day: Go Live (April 15ish)

### Ad Setup (do this 2–3 days before launch)
- [ ] Ad accounts created and approved (Meta, TikTok, X) — see Setup Guide
- [ ] Tracking pixels installed on spontany.io
- [ ] UTM links built and tested
- [ ] Creatives downloaded from Canva and uploaded to ad platforms
- [ ] Ad copy finalized — update CTAs to "Try Spontany" / "Get started free" (not waitlist language)
- [ ] Ads submitted for review (24hr approval buffer)

### Launch Day
- [ ] Ads go live
- [ ] Monitor: server load, error logs, signup funnel
- [ ] Day 1 check-in: Are people signing up? Any crashes?
- [ ] Respond to any issues within 2 hours

### Day 3
- [ ] First ad optimization pass (pause underperformers)
- [ ] Check: Are people completing the full flow (signup → invite partner → use calendar)?
- [ ] Identify drop-off points in the funnel

### Day 7
- [ ] Full performance review
- [ ] Which ad set is winning? Which platform?
- [ ] Reallocate budget to winners

---

## Things That Can Wait (Post-Launch Backlog)

These are real but NOT launch blockers:

- [ ] Email verification for signups
- [ ] Password reset flow (if applicable)
- [ ] Friend group features (multi-person availability view — this is the "friend group" use case from the ads)
- [ ] App Store listing (native wrapper via PWABuilder if you want App Store presence later)
- [ ] Analytics dashboard beyond admin panel
- [ ] Onboarding tutorial / tooltips
- [ ] Performance optimization (lazy loading, caching)

---

## Key Risks to Watch

**Risk: Server can't handle ad traffic**
Your SQLite setup is fine for early users but monitor closely. Railway's free/starter tier may throttle under load. If you're getting 500+ signups in 2 weeks, you're in a good spot but watch for slowdowns.

**Risk: Partner invite flow is confusing**
This is the core loop — if someone signs up from an ad but can't figure out how to invite their partner or friends, the product doesn't work. Test this heavily with non-technical people.

**Risk: PWA install friction**
PWAs don't have the "Download from App Store" simplicity. Users need to know to "Add to Home Screen." Consider a banner or prompt explaining this on first visit.

**Risk: Custody data sensitivity**
You're storing custody schedules. People will ask about privacy and data security. Have a clear answer ready, both on the site and for ad comments.
