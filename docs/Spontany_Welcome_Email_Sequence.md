# Spontany — Welcome Email Sequence

**Type:** Onboarding
**Goal:** Activate new signups → set up calendar → invite a partner or friend → become a daily user
**Audience:** Divorcees 35–55 with kids 0–14, arriving from paid ads (Meta, TikTok, X)
**Emails:** 5 over 14 days
**Sending via:** Resend (transactional API)
**Brand voice:** Smart. Fun. Mature. Sexy.

---

## Sequence Overview

| # | Email | Subject Line | Timing | Purpose | CTA |
|---|-------|-------------|--------|---------|-----|
| 1 | Welcome | "You're in. Here's your unfair advantage." | Immediately | Set the tone, get them into the app | Open Spontany |
| 2 | Quick Win | "2 minutes. That's all your calendar needs." | Day 1 | Get them to enter their custody schedule | Set up my calendar |
| 3 | Invite | "Spontany alone is nice. Together is powerful." | Day 3 | Get them to invite a partner or friend | Send an invite |
| 4 | Social Proof | "Why Daniel stopped texting 'Do you have the kids?'" | Day 7 | Reinforce value with a relatable story | Try it this weekend |
| 5 | Check-in | "How's it going?" | Day 14 | Re-engage or collect feedback | Reply to this email |

---

## Sequence Flow

```
[Signup] ──→ Email 1: Welcome (Day 0, immediate)
                │
                ▼
         Email 2: Quick Win (Day 1)
                │
          Has custody schedule? ──Yes──→ Email 3: Invite (Day 3)
                │                              │
                No                       Has connections? ──Yes──→ Skip to Email 5
                │                              │
                ▼                              No
         Email 2b: Gentle nudge (Day 2)        │
                │                              ▼
                └──────────────────────→ Email 4: Social Proof (Day 7)
                                               │
                                               ▼
                                        Email 5: Check-in (Day 14)
                                               │
                                        [EXIT: Sequence complete]

Exit conditions:
  • User has custody schedule + at least 1 connection → exit after Email 3
  • User unsubscribes → exit immediately
  • User deletes account → exit immediately
```

---

## Email 1: Welcome

**Timing:** Immediately after signup
**Purpose:** Make them feel like they made a smart decision. Get them to open the app.

**Subject line options:**
1. "You're in. Here's your unfair advantage."
2. "Welcome to fewer awkward texts."
3. "Spontany is ready when you are."

**Preview text:** "The guessing game is over."

**Body:**

> Hey {{first_name}},
>
> Welcome to Spontany.
>
> You just joined a smarter way to handle the scheduling chaos that comes with life after divorce. No more "do you have the kids this weekend?" texts. No more group chat ping-pong trying to find a night that works.
>
> Here's how it works:
>
> **1. Add your custody schedule** — takes 2 minutes.
> **2. Invite your people** — partner, co-parent, friends.
> **3. See who's actually free** — and make the plan.
>
> That's it. No guesswork. No awkward questions.
>
> **[Open Spontany →]({{app_url}})**
>
> Welcome aboard,
> Ran @ Spontany
>
> P.S. — Got questions? Just reply to this email. I read every one.

**Segment notes:** Send to all new signups. No conditions.

---

## Email 2: Quick Win

**Timing:** Day 1 (24 hours after signup)
**Purpose:** Get them to complete the single most important action — entering their custody schedule.
**Condition:** Only send if user has NOT yet added a custody schedule.

**Subject line options:**
1. "2 minutes. That's all your calendar needs."
2. "Your calendar is empty. Let's fix that."
3. "One step between you and zero scheduling stress."

**Preview text:** "The fastest setup you'll do all week."

**Body:**

> Hey {{first_name}},
>
> The hardest part of any app is getting started. Good news — Spontany's setup takes about as long as ordering a coffee.
>
> Open the app and add your custody days. That's it. R days, Z days — just tap the calendar and mark which days are yours.
>
> Once that's in, everything else clicks into place. Your partner sees when you're free. Your friends stop guessing. Plans happen faster.
>
> **[Set up my calendar →]({{app_url}}/calendar.html)**
>
> Two minutes now saves you hours of texting later.
>
> — Ran

**Segment notes:** Skip this email if the user has already entered custody data. If skipped, proceed directly to Email 3.

---

## Email 2b: Gentle Nudge (Branch)

**Timing:** Day 2 (only if Email 2 was opened but calendar still not set up)
**Purpose:** Softer re-ask for people who opened but didn't act.

**Subject line options:**
1. "Still thinking about it?"
2. "Your calendar is waiting."

**Preview text:** "No pressure — just a quick reminder."

**Body:**

> Hey {{first_name}},
>
> Totally get it — life's busy. Just a quick note: your Spontany calendar is set up and ready for you. All it needs is your custody schedule.
>
> Once your days are in, the people you invite can see when you're available without asking. That's the whole point — fewer texts, more plans.
>
> **[Add my schedule →]({{app_url}}/calendar.html)**
>
> Takes less time than this email did.
>
> — Ran

**Segment notes:** Only send if user opened Email 2 but hasn't set up their calendar. If they didn't open Email 2 at all, skip 2b and continue to Email 3 on schedule.

---

## Email 3: Invite

**Timing:** Day 3
**Purpose:** Get them to invite at least one person — this is what makes Spontany sticky.
**Condition:** Only send if user has set up their calendar but hasn't invited anyone yet.

**Subject line options:**
1. "Spontany alone is nice. Together is powerful."
2. "Know who's free without asking? Invite them."
3. "The person you keep texting 'are you free?' — invite them."

**Preview text:** "One invite changes everything."

**Body:**

> Hey {{first_name}},
>
> Your calendar's looking good. But here's the thing — Spontany gets really powerful when someone else is on it too.
>
> Think about the person you coordinate with most. The one where every plan starts with three messages just to figure out if the timing works.
>
> Invite them. Here's what happens:
>
> They answer 7 quick questions. You approve the connection. And suddenly you can see each other's availability without the back-and-forth.
>
> **Partner?** They see your shared custody calendar.
> **Friend?** They see when you're free — not the custody details.
>
> Everyone sees exactly what they need. Nothing more.
>
> **[Send an invite →]({{app_url}}/calendar.html)**
>
> One invite. That's all it takes to see the magic.
>
> — Ran

**Segment notes:** Skip if user already has at least one approved connection. If user hasn't set up their calendar yet, delay this email until 1 day after they do (or send on Day 5, whichever comes first).

---

## Email 4: Social Proof

**Timing:** Day 7
**Purpose:** Reinforce the value with a relatable scenario. Re-engage anyone who stalled.

**Subject line options:**
1. "Why Daniel stopped texting 'Do you have the kids?'"
2. "What scheduling looks like without the awkward."
3. "'She just knew I was free.' — That's Spontany."

**Preview text:** "A story that might sound familiar."

**Body:**

> Hey {{first_name}},
>
> Quick story.
>
> Daniel has his kids every other week. His girlfriend has hers on a different schedule. Every time they wanted to plan a date, it turned into a 20-message investigation: "Wait, is this your week? What about Saturday? Oh, your ex moved pickup to 6?"
>
> Then they got on Spontany.
>
> Now Daniel opens the app, sees the overlap in their free time, and texts: "Thursday looks good. Italian?" One message. Done.
>
> That's what this is built for. Not just seeing your own schedule — seeing the moments where your life and someone else's actually line up.
>
> **[Try it this weekend →]({{app_url}}/calendar.html)**
>
> — Ran
>
> P.S. — Daniel isn't a real person (yet). But his story is real for thousands of people. Including, probably, you.

**Segment notes:** Send to all active users regardless of setup status. This is a re-engagement touchpoint for those who stalled and a reinforcement for those who are active.

---

## Email 5: Check-in

**Timing:** Day 14
**Purpose:** Personal check-in. Collect feedback. Make them feel heard.

**Subject line options:**
1. "How's it going?"
2. "Quick question from the founder."
3. "2 weeks in — is Spontany working for you?"

**Preview text:** "I genuinely want to know."

**Body:**

> Hey {{first_name}},
>
> It's been two weeks since you signed up. I wanted to check in personally.
>
> Is Spontany helping? Is something confusing? Is there a feature you wish existed?
>
> I'm building this because I've lived the scheduling chaos myself. Every reply I get makes the app better for everyone.
>
> Just hit reply and tell me:
>
> **What's one thing you'd change about Spontany?**
>
> That's it. No survey. No form. Just talk to me.
>
> Thanks for being an early user. It means more than you know.
>
> — Ran
> Founder, Spontany

**Segment notes:** Send to all users who haven't unsubscribed. This is a plain-text email — no buttons, no images. It should feel like a real person writing, not a marketing system.

---

## Branching Logic Summary

| Condition | Action |
|-----------|--------|
| User sets up calendar before Email 2 | Skip Email 2, send Email 3 on Day 3 |
| User opens Email 2 but no calendar by Day 2 | Send Email 2b on Day 2 |
| User doesn't open Email 2 | Skip 2b, continue to Email 3 on Day 3 |
| User has calendar + connection before Email 3 | Skip Email 3, continue to Email 4 |
| User completes calendar + invite + used app 3+ days | Mark as "activated" — exit sequence after Email 4 |
| User unsubscribes | Exit immediately |

---

## Exit Conditions

- **Activated:** User has custody schedule + at least 1 connection + opened app 3+ times → exit after current email
- **Unsubscribed:** Exit immediately, suppress from all future sequences
- **Account deleted:** Exit immediately, remove from all lists

---

## A/B Test Suggestions

| Test | What | How | Measure |
|------|------|-----|---------|
| Email 1 subject | "You're in" (exclusive) vs. "Welcome to fewer awkward texts" (benefit) | 50/50 split | Open rate |
| Email 3 CTA | "Send an invite" vs. "Get them on Spontany" | 50/50 split | Click-through rate |
| Email 5 format | HTML with button vs. plain text | 50/50 split | Reply rate |

---

## Performance Benchmarks

Since Spontany is a new product with warm traffic (paid ad signups who opted in), expect slightly above-average onboarding metrics:

| Metric | Target | Good | Great |
|--------|--------|------|-------|
| Email 1 open rate | 60% | 65% | 70%+ |
| Email 1 click rate | 15% | 20% | 25%+ |
| Calendar setup rate (by Day 3) | 30% | 40% | 50%+ |
| Invite sent rate (by Day 7) | 15% | 20% | 30%+ |
| Overall activation rate | 15% | 25% | 35%+ |
| Unsubscribe rate (sequence) | <1% | <0.5% | <0.3% |

---

## Resend Implementation Notes

Since you're using Resend (not a marketing automation platform), here's how to set this up:

1. **Trigger emails from your Express backend** — when a user signs up, queue Email 1 immediately via Resend's API
2. **Use a simple scheduler** — a cron job or setTimeout-based queue that checks user state and sends the next email at the right time
3. **Track state in SQLite** — add columns to your users table:
   - `email_sequence_step` (integer, 1-5)
   - `email_sequence_last_sent` (timestamp)
   - `has_custody_schedule` (boolean)
   - `has_connections` (boolean)
   - `activated` (boolean)
4. **Check conditions before each send** — query user state, apply branching logic, then call Resend
5. **Plain-text fallback** — Resend supports both HTML and text. Send both for maximum deliverability.

### Resend API pattern:

```javascript
const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

async function sendSequenceEmail(user, emailNumber) {
  const templates = getEmailTemplates(); // your email copy
  const email = templates[emailNumber];

  await resend.emails.send({
    from: 'Ran <hello@spontany.io>',
    to: user.email,
    subject: email.subject,
    html: email.html,
    text: email.text,
    reply_to: 'ran@spontany.io'
  });

  // Update user's sequence state
  db.prepare('UPDATE users SET email_sequence_step = ?, email_sequence_last_sent = ? WHERE id = ?')
    .run(emailNumber, Date.now(), user.id);
}
```

### Cron job pattern (runs every hour):

```javascript
function processEmailQueue() {
  const now = Date.now();
  const users = db.prepare(`
    SELECT * FROM users
    WHERE email_sequence_step < 5
    AND activated = 0
    AND unsubscribed = 0
  `).all();

  for (const user of users) {
    const hoursSinceLastEmail = (now - user.email_sequence_last_sent) / (1000 * 60 * 60);
    const nextStep = user.email_sequence_step + 1;

    // Check timing for next email
    const delays = { 2: 24, 3: 72, 4: 168, 5: 336 }; // hours
    if (hoursSinceLastEmail >= delays[nextStep]) {
      // Apply branching logic here
      if (shouldSendEmail(user, nextStep)) {
        sendSequenceEmail(user, nextStep);
      }
    }
  }
}
```

---

## From Address

Send all emails from: **Ran <hello@spontany.io>**
Reply-to: **ran@spontany.io** (or wherever you want replies to land)

This keeps it personal — a real name, not "Spontany Team" or "no-reply." For a product this intimate, the founder's name builds trust.
