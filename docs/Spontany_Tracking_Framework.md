# Spontany — Tracking & Measurement Framework

**Campaign:** "Know Before You Ask"
**Duration:** April 1–14, 2026

---

## UTM Naming Convention

Use consistent UTMs on every ad link so you can slice performance by platform, ad set, and creative variant.

**Structure:** `?utm_source={platform}&utm_medium=paid_social&utm_campaign=know_before_you_ask&utm_content={ad_set}_{variant}`

### Examples:

| Ad | UTM String |
|----|-----------|
| Meta — Ad Set A, Variant 1 | `?utm_source=meta&utm_medium=paid_social&utm_campaign=know_before_you_ask&utm_content=dating_a1` |
| Meta — Ad Set B, Variant 2 | `?utm_source=meta&utm_medium=paid_social&utm_campaign=know_before_you_ask&utm_content=friends_b2` |
| TikTok — Ad Set A, TT1 | `?utm_source=tiktok&utm_medium=paid_social&utm_campaign=know_before_you_ask&utm_content=dating_tt1` |
| TikTok — Ad Set B, TT2 | `?utm_source=tiktok&utm_medium=paid_social&utm_campaign=know_before_you_ask&utm_content=friends_tt2` |
| X — Ad Set A, Tweet 1 | `?utm_source=x&utm_medium=paid_social&utm_campaign=know_before_you_ask&utm_content=dating_x1` |
| X — Ad Set B, Tweet 2 | `?utm_source=x&utm_medium=paid_social&utm_campaign=know_before_you_ask&utm_content=friends_x2` |

---

## Pixel & Event Setup

### Meta (Facebook Pixel / Conversions API)
- Install Meta Pixel on landing page / app store redirect page
- Configure events: `PageView`, `Lead` (if signup page), `Purchase` or custom `AppInstall` event
- Set up Custom Conversions for app install tracking via deep link or App Events

### TikTok (TikTok Pixel)
- Install TikTok Pixel on landing page
- Configure events: `ViewContent`, `ClickButton`, `CompleteRegistration`
- Enable TikTok Events API for server-side tracking if possible

### X (Twitter Pixel)
- Install X conversion tag
- Configure events: `SiteVisit`, `SignUp` or `AppInstall`

### App Store Tracking
- Use a mobile measurement partner (MMP) if available (e.g., AppsFlyer, Adjust, Branch)
- If no MMP: use platform-native app install tracking + UTM parameters on landing page links
- At minimum: track installs by source using App Store Connect (iOS) and Google Play Console (Android)

---

## KPI Dashboard — What to Track Daily

| Metric | Where to Find It | Target | Check Frequency |
|--------|------------------|--------|-----------------|
| **Impressions** | Ad platform dashboards | — (awareness baseline) | Daily |
| **Clicks** | Ad platform dashboards | — | Daily |
| **CTR** | Ad platform dashboards | > 1.2% | Every 2 days |
| **CPC** | Ad platform dashboards | < $1.50 | Every 2 days |
| **App installs** | MMP or App Store analytics | 500+ total | Daily |
| **CPI (cost per install)** | Calculated: spend ÷ installs | < $2.00 | Every 2 days |
| **Ad Set A vs B performance** | Compare CTR + CPI between sets | Clear winner by Day 7 | Day 3, 5, 7 |
| **Platform comparison** | Compare CPI across Meta/TT/X | Identify best channel | Day 7 + 14 |

---

## Decision Triggers

These are the rules for optimizing mid-campaign:

| Signal | Action |
|--------|--------|
| Any creative with CTR < 0.8% after 1,000 impressions | Pause it |
| One ad set has 2x+ better CPI than the other by Day 5 | Shift 60% of remaining budget to winner |
| One platform has CPI > $3.00 by Day 7 | Reduce spend to minimum or pause |
| One platform has CPI < $1.50 by Day 7 | Increase spend, shift from weakest platform |
| Both ad sets performing similarly by Day 7 | Test a new creative angle combining elements of A and B |

---

## Reporting Cadence

| When | What |
|------|------|
| **Daily** | Quick glance: spend, installs, CPI |
| **Day 3** | First optimization pass — pause underperformers |
| **Day 7** | Week 1 full report — ad set winner, platform winner, budget reallocation |
| **Day 14** | Final campaign report — total installs, CPI, winner analysis, learnings for next campaign |

---

## Post-Campaign Report Template

After April 14, compile:

1. **Total spend by platform and ad set**
2. **Total installs by platform and ad set**
3. **CPI by platform and ad set**
4. **Best-performing creative** (which variant, which platform)
5. **Winning message angle** (dating vs. friend group)
6. **Cost efficiency ranking** (platforms ranked by CPI)
7. **Learnings and recommendations for next campaign sprint**
