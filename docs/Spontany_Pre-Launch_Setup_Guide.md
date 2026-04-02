# Spontany — Pre-Launch Campaign Setup Guide

**Goal:** Get all accounts and your landing page ready so you can start running ads the moment everything is approved.

**Estimated total setup time:** 2–3 hours (spread across a couple of days while accounts get approved)

---

## Step 1: Build Your Pre-Launch Landing Page (Day 1)

This is where all your ads will point. Keep it simple — one page, one goal: collect emails.

### Recommended tool: Carrd.co ($19/year)

1. Go to [carrd.co](https://carrd.co) and sign up
2. Pick a dark-themed template (to match Spontany's brand)
3. Build a single page with:
   - Your Spontany logo at the top
   - Headline: **"Know before you ask."**
   - Subline: *"The scheduling app for people with complicated calendars. Coming soon."*
   - Email capture form (Carrd has built-in form support, or connect to Mailchimp/ConvertKit)
   - A brief 2-3 sentence description of what Spontany does
   - Optional: a screenshot or mockup of the app UI you shared with me
4. Connect a custom domain if you have one (e.g., spontany.app or getspontany.com)
5. Publish

### What you need before moving on:
- [ ] Landing page live with a working URL
- [ ] Email capture form tested (submit a test email to yourself)
- [ ] Page looks good on mobile (this is where 80%+ of ad traffic will land)

---

## Step 2: Set Up Meta Business Suite + Ad Account (Day 1)

This is your biggest platform (50% of budget), so do this first. It can take 24–48 hours for full approval.

### What you need to get started:
- A personal Facebook account (you probably have one)
- A business email address
- Your business name, phone number, and address

### Steps:

1. **Create a Facebook Business Page**
   - Go to [facebook.com/pages/create](https://www.facebook.com/pages/create)
   - Choose "Business or Brand"
   - Name it "Spontany" — add your logo as the profile picture
   - Fill in the basics (category: "App" or "Software", description, website URL once your landing page is live)

2. **Set up Meta Business Suite**
   - Go to [business.facebook.com](https://business.facebook.com)
   - Click "Create Account"
   - Enter your business name, your name, and business email
   - Confirm your email
   - This gives you access to Ads Manager, Audience tools, and Pixel

3. **Create an Ad Account**
   - Inside Business Suite → Settings → Ad Accounts → "Add"
   - Set your currency (choose carefully — can't change later)
   - Set your timezone
   - Add a payment method (credit/debit card)

4. **Connect your Instagram account**
   - On your phone: Instagram → Settings → Account → Switch to Professional Account → Business
   - In Meta Business Suite: Settings → Instagram Accounts → Connect
   - This lets your ads appear on both Facebook and Instagram

5. **Install the Meta Pixel**
   - In Business Suite → Events Manager → Connect Data Sources → Web → Meta Pixel
   - Copy the pixel code and add it to your Carrd landing page (Carrd has a "Head" section in settings where you can paste it)
   - This tracks who visits your page from your ads

### What you need before moving on:
- [ ] Facebook Business Page created with logo and basic info
- [ ] Meta Business Suite account active
- [ ] Ad Account created with payment method
- [ ] Instagram connected as Professional account
- [ ] Meta Pixel installed on landing page

---

## Step 3: Set Up TikTok Ads Manager (Day 1–2)

### Important 2026 change:
TikTok now requires a verified TikTok profile linked to your ad account. Custom Identity (running ads without a profile) is being phased out.

### What you need:
- A TikTok account for Spontany (create one if you don't have one)
- Your legal business name (must match exactly for verification)
- Business verification documents (business registration or equivalent)

### Steps:

1. **Create a TikTok account for Spontany**
   - Download TikTok → Sign up → Set username to @spontany or similar
   - Switch to a Business Account: Settings → Manage Account → Switch to Business Account
   - Add your logo, bio, and landing page link

2. **Set up TikTok Ads Manager**
   - Go to [ads.tiktok.com](https://ads.tiktok.com)
   - Click "Create an ad" or "Get Started"
   - Enter your country, industry (Technology/App), legal business name, timezone, currency
   - **Warning:** You can't change timezone, region, business name, or currency after creation

3. **Complete Business Verification**
   - You'll be prompted to upload a document verifying your business
   - Acceptable docs vary by country — typically business registration, tax certificate, or government-issued business license
   - If you're operating as a sole proprietor, check [TikTok's verification docs page](https://ads.tiktok.com/help/article/acceptable-documents-for-business-verification) for accepted alternatives

4. **Link your TikTok profile to Ads Manager**
   - In Ads Manager → Assets → TikTok Account → Link your @spontany account
   - This is now required for running ads in 2026

5. **Install TikTok Pixel**
   - In Ads Manager → Assets → Events → Website Pixel
   - Copy the pixel code and add it to your Carrd landing page's Head section

### What you need before moving on:
- [ ] TikTok @spontany (or similar) account created and set to Business
- [ ] TikTok Ads Manager account created
- [ ] Business verification submitted (may take 1–2 days)
- [ ] TikTok profile linked to Ads Manager
- [ ] TikTok Pixel installed on landing page

---

## Step 4: Set Up X (Twitter) Ads Account (Day 1–2)

### What you need:
- An X account for Spontany (or your personal one)
- The account must be verified (X Premium or Verified Organizations)
- A credit/debit card for billing

### Steps:

1. **Create or prep your X account**
   - Create @spontany (or similar) on X if you don't have one
   - Make sure posts are set to public (required for ads)
   - Add your logo, banner, bio, and landing page URL
   - Your profile must comply with X's ad policies (professional bio, no policy violations)

2. **Get verified**
   - For a business: Apply for Verified Organizations at [x.com/i/verified-orgs-signup](https://x.com/i/verified-orgs-signup) — costs ~$200/month but adds credibility
   - For an individual: Subscribe to X Premium (~$8/month) — simpler and cheaper for a startup
   - Verification is required to run ads in 2026

3. **Set up your Ads Account**
   - Go to [ads.x.com](https://ads.x.com)
   - Select your country and timezone (can't change later)
   - Add billing information
   - Set your initial funding amount or enable automatic payments

4. **Install X Conversion Tag**
   - In Ads Manager → Tools → Conversion Tracking → Create new tag
   - Copy the tag code and add it to your Carrd landing page's Head section

### What you need before moving on:
- [ ] X account created with professional profile
- [ ] Account verified (Premium or Verified Organizations)
- [ ] X Ads account created with billing
- [ ] Conversion tag installed on landing page

---

## Step 5: Update Your Ad Links (Day 2–3)

Once your landing page is live and pixels are installed:

1. Build your UTM links using the naming convention from the Tracking Framework doc
2. Test each link to make sure it lands on the right page
3. Check that each pixel fires when you visit the landing page (use Meta Pixel Helper Chrome extension, TikTok Pixel Helper, etc.)

### Master link template:
```
https://yourdomain.com/?utm_source={platform}&utm_medium=paid_social&utm_campaign=know_before_you_ask&utm_content={ad_set}_{variant}
```

---

## Step 6: Upload Creatives and Launch (Day 3+)

Once all accounts are approved:

1. Download your chosen Canva creatives as PNG (for static) or MP4 (for motion)
2. Upload them to each ad platform
3. Paste the ad copy from the Ad Copy Deck (update CTAs to waitlist language)
4. Set targeting: Age 35–55, interests in dating, parenting, divorce-related topics
5. Set daily budgets per the Campaign Plan
6. Submit ads for review (usually approved within 24 hours)
7. Go live!

---

## Quick Reference: Cost Summary

| Item | Cost | Notes |
|------|------|-------|
| Carrd landing page | $19/year | Or free tier with carrd.co subdomain |
| Meta Business Suite | Free | |
| Meta ad spend | ~$500 | From campaign budget |
| TikTok Ads Manager | Free | |
| TikTok ad spend | ~$300 | From campaign budget |
| X Premium (verification) | ~$8/month | Minimum for ad eligibility |
| X ad spend | ~$200 | From campaign budget |
| **Total setup costs** | **~$27** | Plus your $1K ad spend |

---

## Checklist: Ready to Launch?

- [ ] Landing page live with email capture
- [ ] Meta: Business Page + Ad Account + Pixel
- [ ] Instagram: Connected as Professional account
- [ ] TikTok: Business account + Ads Manager + Verified + Pixel
- [ ] X: Verified account + Ads account + Conversion tag
- [ ] All pixels tested and firing
- [ ] UTM links built and tested
- [ ] Creatives downloaded from Canva
- [ ] Ad copy updated with waitlist CTAs
- [ ] Ads submitted for review
