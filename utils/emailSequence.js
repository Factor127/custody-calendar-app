'use strict';

/**
 * Spontany — Welcome Email Sequence
 * 5 emails over 14 days with branching logic.
 * Runs an in-process hourly tick (no external cron needed).
 */

const { sendEmail } = require('./email');

// ── Lazy DB reference (avoids circular require at module load) ─────────────────
let _db = null;
function getDb() {
  if (!_db) _db = require('../db').db;
  return _db;
}

// ── Config ────────────────────────────────────────────────────────────────────
const FROM        = 'Ran @ Spontany <hello@spontany.io>';
const REPLY_TO    = 'hello@spontany.io';
const BASE_URL    = () => process.env.BASE_URL || 'https://spontany.io';

// Delays from signup in hours
const STEP_DELAY  = { 2: 24, 3: 72, 4: 168, 5: 336 }; // Email 1 fires immediately

// ── Helpers ───────────────────────────────────────────────────────────────────

function hoursSince(isoStr) {
  if (!isoStr) return Infinity;
  return (Date.now() - new Date(isoStr).getTime()) / 3_600_000;
}

function hasSchedule(userId) {
  const row = getDb().prepare(
    'SELECT 1 FROM calendar_days WHERE user_id = ? LIMIT 1'
  ).get(userId);
  return Boolean(row);
}

function hasConnections(userId) {
  const row = getDb().prepare(
    "SELECT 1 FROM connections WHERE (requester_id = ? OR target_id = ?) AND status = 'approved' LIMIT 1"
  ).get(userId, userId);
  return Boolean(row);
}

function markStep(userId, step) {
  getDb().prepare(
    'UPDATE users SET email_seq_step = ?, email_seq_last_sent = ? WHERE id = ?'
  ).run(step, new Date().toISOString(), userId);
}

function markOpened(userId, step) {
  const user = getDb().prepare('SELECT email_seq_opened FROM users WHERE id = ?').get(userId);
  if (!user) return;
  let opened = [];
  try { opened = JSON.parse(user.email_seq_opened || '[]'); } catch(e) {}
  if (!opened.includes(step)) {
    opened.push(step);
    getDb().prepare("UPDATE users SET email_seq_opened = ? WHERE id = ?")
      .run(JSON.stringify(opened), userId);
  }
}

function hasOpened(user, step) {
  try {
    const opened = JSON.parse(user.email_seq_opened || '[]');
    return opened.includes(step);
  } catch(e) { return false; }
}

// ── Tracking helpers ──────────────────────────────────────────────────────────
// Appended to emails as a 1×1 pixel for open tracking.
function trackingPixel(userId, step) {
  return `<img src="${BASE_URL()}/api/email/open?u=${userId}&s=${step}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;outline:0;">`;
}

// Unsubscribe link using the user's access token (already a secret — no extra token needed).
function unsubLink(token) {
  return `${BASE_URL()}/api/email/unsubscribe?token=${token}`;
}

// ── Shared layout wrapper ─────────────────────────────────────────────────────
function layout({ title, preheader, body, ctaText, ctaUrl, userId, step, token }) {
  const unsub = unsubLink(token);
  const pixel = trackingPixel(userId, step);
  const btn   = ctaText && ctaUrl
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0;">
        <tr><td>
          <a href="${ctaUrl}"
             style="display:inline-block;background:#7c5cbf;color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
                    font-size:15px;font-weight:700;text-decoration:none;padding:13px 28px;border-radius:8px;letter-spacing:0.01em;">
            ${ctaText} →
          </a>
        </td></tr>
      </table>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,sans-serif;">
  <!--[if mso]><table width="600" align="center"><tr><td><![endif]-->
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f4f4f8;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;">

        <!-- Header -->
        <tr><td style="padding-bottom:20px;">
          <span style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
                       font-size:22px;font-weight:900;letter-spacing:0.04em;color:#0c0c15;">
            SPONTANY
          </span>
        </td></tr>

        <!-- Card -->
        <tr><td style="background:#ffffff;border-radius:12px;padding:36px 40px;
                       border:1px solid #e2e2ee;box-shadow:0 2px 8px rgba(0,0,0,0.04);">
          <div style="font-size:15px;line-height:1.75;color:#1a1a2e;">
            ${body}
          </div>
          ${btn}
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:20px 0 8px;text-align:center;font-size:12px;color:#888;">
          <a href="${unsub}" style="color:#888;text-decoration:underline;">Unsubscribe</a>
          &nbsp;·&nbsp; Spontany · operated by Ran Mer
        </td></tr>

      </table>
    </td></tr>
  </table>
  ${pixel}
  <!--[if mso]></td></tr></table><![endif]-->
</body>
</html>`;
}

// ── Email templates ───────────────────────────────────────────────────────────

function email1(user) {
  const firstName = user.name.split(' ')[0];
  const appUrl = `${BASE_URL()}/calendar.html?token=${user.access_token}`;
  const body = `
    <p>Hey ${firstName},</p>
    <p>Welcome to Spontany.</p>
    <p>You just joined a smarter way to handle the scheduling chaos that comes with life after divorce.
       No more "do you have the kids this weekend?" texts. No more group chat ping-pong trying to find a night that works.</p>
    <p>Here's how it works:</p>
    <p>
      <strong>1. Add your custody schedule</strong> — takes 2 minutes.<br>
      <strong>2. Invite your people</strong> — partner, co-parent, friends.<br>
      <strong>3. See who's actually free</strong> — and make the plan.
    </p>
    <p>That's it. No guesswork. No awkward questions.</p>
    <p style="margin-top:8px;font-size:13px;color:#666;">
      P.S. — Got questions? Just reply to this email. I read every one.
    </p>`;
  return {
    subject: "You're in. Here's your unfair advantage.",
    preview: 'The guessing game is over.',
    html: layout({ title: 'Welcome to Spontany', preheader: 'The guessing game is over.',
                   body, ctaText: 'Open Spontany', ctaUrl: appUrl,
                   userId: user.id, step: 1, token: user.access_token }),
    text: `Hey ${firstName},\n\nWelcome to Spontany.\n\nYou just joined a smarter way to handle the scheduling chaos that comes with life after divorce.\n\nHere's how it works:\n1. Add your custody schedule — takes 2 minutes.\n2. Invite your people — partner, co-parent, friends.\n3. See who's actually free — and make the plan.\n\nOpen Spontany: ${appUrl}\n\nWelcome aboard,\nRan @ Spontany\n\nP.S. — Got questions? Just reply to this email. I read every one.\n\nUnsubscribe: ${unsubLink(user.access_token)}`,
  };
}

function email2(user) {
  const firstName = user.name.split(' ')[0];
  const calUrl = `${BASE_URL()}/calendar.html?token=${user.access_token}`;
  const body = `
    <p>Hey ${firstName},</p>
    <p>The hardest part of any app is getting started. Good news — Spontany's setup takes about as long as ordering a coffee.</p>
    <p>Open the app and add your custody days. That's it. R days, Z days — just tap the calendar and mark which days are yours.</p>
    <p>Once that's in, everything else clicks into place. Your partner sees when you're free. Your friends stop guessing. Plans happen faster.</p>
    <p style="margin-top:8px;color:#666;font-size:13px;">Two minutes now saves you hours of texting later.</p>
    <p style="margin-top:24px;">— Ran</p>`;
  return {
    subject: '2 minutes. That\'s all your calendar needs.',
    preview: 'The fastest setup you\'ll do all week.',
    html: layout({ title: 'Set up your calendar', preheader: 'The fastest setup you\'ll do all week.',
                   body, ctaText: 'Set up my calendar', ctaUrl: calUrl,
                   userId: user.id, step: 2, token: user.access_token }),
    text: `Hey ${firstName},\n\nThe hardest part of any app is getting started. Good news — Spontany's setup takes about as long as ordering a coffee.\n\nOpen the app and add your custody days. That's it. R days, Z days — just tap the calendar and mark which days are yours.\n\nSet up my calendar: ${calUrl}\n\nTwo minutes now saves you hours of texting later.\n\n— Ran\n\nUnsubscribe: ${unsubLink(user.access_token)}`,
  };
}

function email2b(user) {
  const firstName = user.name.split(' ')[0];
  const calUrl = `${BASE_URL()}/calendar.html?token=${user.access_token}`;
  const body = `
    <p>Hey ${firstName},</p>
    <p>Totally get it — life's busy. Just a quick note: your Spontany calendar is set up and ready for you. All it needs is your custody schedule.</p>
    <p>Once your days are in, the people you invite can see when you're available without asking. That's the whole point — fewer texts, more plans.</p>
    <p style="margin-top:8px;color:#666;font-size:13px;">Takes less time than this email did.</p>
    <p style="margin-top:24px;">— Ran</p>`;
  return {
    subject: 'Your calendar is waiting.',
    preview: 'No pressure — just a quick reminder.',
    html: layout({ title: 'Your calendar is waiting', preheader: 'No pressure — just a quick reminder.',
                   body, ctaText: 'Add my schedule', ctaUrl: calUrl,
                   userId: user.id, step: 2, token: user.access_token }),
    text: `Hey ${firstName},\n\nTotally get it — life's busy. Just a quick note: your Spontany calendar is set up and ready for you. All it needs is your custody schedule.\n\nAdd my schedule: ${calUrl}\n\nTakes less time than this email did.\n\n— Ran\n\nUnsubscribe: ${unsubLink(user.access_token)}`,
  };
}

function email3(user) {
  const firstName = user.name.split(' ')[0];
  const calUrl = `${BASE_URL()}/calendar.html?token=${user.access_token}`;
  const body = `
    <p>Hey ${firstName},</p>
    <p>Your calendar's looking good. But here's the thing — Spontany gets really powerful when someone else is on it too.</p>
    <p>Think about the person you coordinate with most. The one where every plan starts with three messages just to figure out if the timing works.</p>
    <p>Invite them. Here's what happens:</p>
    <p>They answer 7 quick questions. You approve the connection. And suddenly you can see each other's availability without the back-and-forth.</p>
    <p>
      <strong>Partner?</strong> They see your shared custody calendar.<br>
      <strong>Friend?</strong> They see when you're free — not the custody details.
    </p>
    <p>Everyone sees exactly what they need. Nothing more.</p>
    <p style="margin-top:8px;color:#666;font-size:13px;">One invite. That's all it takes to see the magic.</p>
    <p style="margin-top:24px;">— Ran</p>`;
  return {
    subject: 'Spontany alone is nice. Together is powerful.',
    preview: 'One invite changes everything.',
    html: layout({ title: 'Invite your people', preheader: 'One invite changes everything.',
                   body, ctaText: 'Send an invite', ctaUrl: calUrl,
                   userId: user.id, step: 3, token: user.access_token }),
    text: `Hey ${firstName},\n\nYour calendar's looking good. But Spontany gets really powerful when someone else is on it too.\n\nInvite the person you coordinate with most. They answer 7 quick questions. You approve. And suddenly — no more back-and-forth.\n\nSend an invite: ${calUrl}\n\nOne invite. That's all it takes to see the magic.\n\n— Ran\n\nUnsubscribe: ${unsubLink(user.access_token)}`,
  };
}

function email4(user) {
  const firstName = user.name.split(' ')[0];
  const calUrl = `${BASE_URL()}/calendar.html?token=${user.access_token}`;
  const body = `
    <p>Hey ${firstName},</p>
    <p>Quick story.</p>
    <p>Daniel has his kids every other week. His girlfriend has hers on a different schedule. Every time they wanted to plan a date, it turned into a 20-message investigation: <em>"Wait, is this your week? What about Saturday? Oh, your ex moved pickup to 6?"</em></p>
    <p>Then they got on Spontany.</p>
    <p>Now Daniel opens the app, sees the overlap in their free time, and texts: <strong>"Thursday looks good. Italian?"</strong> One message. Done.</p>
    <p>That's what this is built for. Not just seeing your own schedule — seeing the moments where your life and someone else's actually line up.</p>
    <p style="margin-top:24px;">— Ran</p>
    <p style="margin-top:8px;color:#666;font-size:13px;">P.S. — Daniel isn't a real person (yet). But his story is real for thousands of people. Including, probably, you.</p>`;
  return {
    subject: "Why Daniel stopped texting 'Do you have the kids?'",
    preview: 'A story that might sound familiar.',
    html: layout({ title: 'A story that might sound familiar', preheader: 'A story that might sound familiar.',
                   body, ctaText: 'Try it this weekend', ctaUrl: calUrl,
                   userId: user.id, step: 4, token: user.access_token }),
    text: `Hey ${firstName},\n\nQuick story.\n\nDaniel has his kids every other week. His girlfriend has hers on a different schedule. Every time they wanted to plan a date, it turned into a 20-message investigation.\n\nThen they got on Spontany.\n\nNow Daniel opens the app, sees the overlap in their free time, and texts: "Thursday looks good. Italian?" One message. Done.\n\nTry it this weekend: ${calUrl}\n\n— Ran\n\nP.S. — Daniel isn't a real person (yet). But his story is real for thousands of people. Including, probably, you.\n\nUnsubscribe: ${unsubLink(user.access_token)}`,
  };
}

function email5(user) {
  const firstName = user.name.split(' ')[0];
  // Email 5 is plain-text only — intentionally personal, no button
  const body = `
    <p>Hey ${firstName},</p>
    <p>It's been two weeks since you signed up. I wanted to check in personally.</p>
    <p>Is Spontany helping? Is something confusing? Is there a feature you wish existed?</p>
    <p>I'm building this because I've lived the scheduling chaos myself. Every reply I get makes the app better for everyone.</p>
    <p>Just hit reply and tell me:</p>
    <p style="font-size:17px;font-weight:700;color:#1a1a2e;padding:12px 0;"><strong>What's one thing you'd change about Spontany?</strong></p>
    <p>That's it. No survey. No form. Just talk to me.</p>
    <p>Thanks for being an early user. It means more than you know.</p>
    <p style="margin-top:24px;">— Ran<br><span style="color:#666;font-size:13px;">Founder, Spontany</span></p>`;
  return {
    subject: "How's it going?",
    preview: 'I genuinely want to know.',
    html: layout({ title: "How's it going?", preheader: 'I genuinely want to know.',
                   body, ctaText: null, ctaUrl: null,
                   userId: user.id, step: 5, token: user.access_token }),
    text: `Hey ${firstName},\n\nIt's been two weeks since you signed up. I wanted to check in personally.\n\nIs Spontany helping? Is something confusing? Is there a feature you wish existed?\n\nJust hit reply and tell me: What's one thing you'd change about Spontany?\n\nNo survey. No form. Just talk to me.\n\nThanks for being an early user.\n\n— Ran\nFounder, Spontany\n\nUnsubscribe: ${unsubLink(user.access_token)}`,
  };
}

// ── Send a sequence email ────────────────────────────────────────────────────

async function sendSequenceEmail(user, step, is2b = false) {
  if (!user.email) {
    console.log(`[seq] Skipping step ${step} for ${user.id} — no email address`);
    return;
  }

  const templates = { 1: email1, 2: email2, 3: email3, 4: email4, 5: email5 };
  const fn = is2b ? email2b : templates[step];
  if (!fn) return;

  const tpl = fn(user);

  await sendEmail({
    to:        user.email,
    from:      FROM,
    replyTo:   REPLY_TO,
    subject:   tpl.subject,
    bodyText:  tpl.text,
    html:      tpl.html,
  });

  if (is2b) {
    getDb().prepare('UPDATE users SET email_seq_2b_sent = 1, email_seq_last_sent = ? WHERE id = ?')
      .run(new Date().toISOString(), user.id);
    console.log(`[seq] Sent Email 2b to ${user.email}`);
  } else {
    markStep(user.id, step);
    console.log(`[seq] Sent Email ${step} to ${user.email}`);
  }
}

// ── Entry point: start sequence for a new user ────────────────────────────────

async function startSequence(user) {
  if (!user.email || user.unsubscribed) return;

  // Stamp the sequence start time
  getDb().prepare('UPDATE users SET email_seq_started = ? WHERE id = ?')
    .run(new Date().toISOString(), user.id);

  await sendSequenceEmail(user, 1);
}

// ── Hourly processor ──────────────────────────────────────────────────────────

async function processQueue() {
  if (!process.env.RESEND_API_KEY) return; // silently skip if email not configured

  const users = getDb().prepare(`
    SELECT * FROM users
    WHERE unsubscribed = 0
      AND email_seq_step > 0
      AND email_seq_step < 5
      AND email IS NOT NULL
      AND email_seq_started IS NOT NULL
  `).all();

  let sent = 0;

  for (const user of users) {
    try {
      const hoursSinceStart  = hoursSince(user.email_seq_started);
      const hoursSinceLast   = hoursSince(user.email_seq_last_sent);
      const currentStep      = user.email_seq_step;
      const nextStep         = currentStep + 1;
      const delayHours       = STEP_DELAY[nextStep];

      if (!delayHours) continue; // step 1 already sent, no step 0 delay
      if (hoursSinceLast < delayHours) continue; // not time yet

      // ── Branching logic ──
      const schedule  = hasSchedule(user.id);
      const connected = hasConnections(user.id);

      // Email 2 (Day 1) — skip if already has custody schedule
      if (nextStep === 2) {
        if (schedule) {
          // Jump past Email 2 — advance step silently and loop to check Email 3
          getDb().prepare('UPDATE users SET email_seq_step = 2, email_seq_last_sent = ? WHERE id = ?')
            .run(new Date().toISOString(), user.id);
          continue;
        }
        await sendSequenceEmail(user, 2);
        sent++;
        continue;
      }

      // Email 2b (Day 2) — only if Email 2 was opened but no schedule yet, and 2b not already sent
      if (currentStep === 2 && !user.email_seq_2b_sent) {
        const hoursAfterEmail2 = hoursSinceLast;
        if (hoursAfterEmail2 >= 24 && hasOpened(user, 2) && !schedule) {
          await sendSequenceEmail(user, 2, true); // is2b = true
          sent++;
          // Don't advance step — 2b is a branch, not a progression
          continue;
        }
      }

      // Email 3 (Day 3) — skip if already has connections
      if (nextStep === 3) {
        if (connected) {
          getDb().prepare('UPDATE users SET email_seq_step = 3, email_seq_last_sent = ? WHERE id = ?')
            .run(new Date().toISOString(), user.id);
          continue;
        }
        await sendSequenceEmail(user, 3);
        sent++;
        continue;
      }

      // Email 4 (Day 7) — send to all regardless of state
      if (nextStep === 4) {
        await sendSequenceEmail(user, 4);
        sent++;
        continue;
      }

      // Email 5 (Day 14) — send to all non-unsubscribed
      if (nextStep === 5) {
        await sendSequenceEmail(user, 5);
        sent++;
        continue;
      }

    } catch(e) {
      console.error(`[seq] Error processing user ${user.id}:`, e.message);
    }
  }

  if (sent > 0) console.log(`[seq] Processed queue — sent ${sent} emails`);
}

// ── Start the hourly tick ─────────────────────────────────────────────────────

function startSequenceProcessor() {
  // Run once on startup (catches any missed sends after a restart)
  processQueue().catch(e => console.error('[seq] Startup run error:', e.message));

  // Then every hour
  setInterval(() => {
    processQueue().catch(e => console.error('[seq] Queue error:', e.message));
  }, 60 * 60 * 1000);

  console.log('  → Email sequence processor: active (runs hourly)');
}

module.exports = { startSequence, startSequenceProcessor, markOpened };
