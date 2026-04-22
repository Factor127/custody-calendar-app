'use strict';

const express = require('express');
const router  = express.Router();
const { db }  = require('../db');
const { sendSMS, toE164, isValidE164 } = require('../utils/sms');

const MAX_BODY_LEN = 160;                     // one SMS segment
const NUDGES_PER_PHONE_PER_24H = 1;           // rate limit

// ── Time-choice → UTC timestamp ────────────────────────────────────────────
// User picks a rough slot; we map to concrete UTC time based on their tz.
// Client supplies its tz_offset (minutes from UTC, getTimezoneOffset() style).
function computeSendAt(choice, tzOffsetMin) {
  const now = new Date();
  // Convert UTC "now" to the user's local clock
  const localNow = new Date(now.getTime() - (tzOffsetMin * 60 * 1000));
  let localTarget = new Date(localNow);

  switch (choice) {
    case 'tonight_9pm': {
      localTarget.setHours(21, 0, 0, 0);
      if (localTarget <= localNow) {
        // Too late for tonight - push to tomorrow 9am instead of next-day 9pm
        localTarget.setDate(localTarget.getDate() + 1);
        localTarget.setHours(9, 0, 0, 0);
      }
      break;
    }
    case 'tomorrow_9am': {
      localTarget.setDate(localTarget.getDate() + 1);
      localTarget.setHours(9, 0, 0, 0);
      break;
    }
    case 'this_weekend': {
      // Next Saturday 10am local
      const dayOfWeek = localTarget.getDay();              // 0=Sun..6=Sat
      const daysUntilSat = (6 - dayOfWeek + 7) % 7 || 7;   // at least +1
      localTarget.setDate(localTarget.getDate() + daysUntilSat);
      localTarget.setHours(10, 0, 0, 0);
      break;
    }
    default:
      // Fallback: 1 hour from now
      return new Date(now.getTime() + 60 * 60 * 1000);
  }

  // Convert the chosen local time back to UTC
  return new Date(localTarget.getTime() + (tzOffsetMin * 60 * 1000));
}

function isOptedOut(phone) {
  const row = db.prepare('SELECT 1 FROM sms_opt_outs WHERE phone = ?').get(phone);
  return !!row;
}

function recentNudgeCount(phone) {
  const row = db.prepare(`
    SELECT COUNT(*) AS cnt FROM nudges
    WHERE phone = ?
      AND created_at >= datetime('now', '-24 hours')
      AND status IN ('scheduled', 'sent')
  `).get(phone);
  return (row && row.cnt) || 0;
}

// ── POST /api/nudge/schedule ───────────────────────────────────────────────
// Body: { phone, first_name?, time_choice, tz_offset_min, variant, session_id,
//         utm_source?, utm_campaign?, utm_content? }
router.post('/nudge/schedule', (req, res) => {
  const b = req.body || {};

  if (!b.phone || !b.time_choice) {
    return res.status(400).json({ error: 'phone_and_time_required' });
  }

  const phone = toE164(b.phone);
  if (!phone) return res.status(400).json({ error: 'invalid_phone' });

  if (isOptedOut(phone)) {
    return res.status(200).json({ ok: true, note: 'opted_out' }); // silent no-op
  }

  if (recentNudgeCount(phone) >= NUDGES_PER_PHONE_PER_24H) {
    return res.status(429).json({ error: 'rate_limited' });
  }

  const tzOffset = Number.isFinite(b.tz_offset_min) ? b.tz_offset_min : 0;
  const sendAt   = computeSendAt(b.time_choice, tzOffset);

  const result = db.prepare(`
    INSERT INTO nudges (
      session_id, variant, channel, phone, first_name,
      send_at, time_choice, status,
      utm_source, utm_campaign, utm_content
    ) VALUES (?, ?, 'sms', ?, ?, ?, ?, 'scheduled', ?, ?, ?)
  `).run(
    b.session_id || null,
    b.variant || null,
    phone,
    (b.first_name || '').slice(0, 40) || null,
    sendAt.toISOString(),
    b.time_choice,
    b.utm_source || null,
    b.utm_campaign || null,
    b.utm_content || null,
  );

  res.json({ ok: true, id: result.lastInsertRowid, send_at: sendAt.toISOString() });
});

// ── POST /api/nudge/webhook ────────────────────────────────────────────────
// Twilio inbound SMS webhook. Detects STOP/HELP and records opt-outs.
// Configure in Twilio Console: Phone Numbers → your number → Messaging →
// "A message comes in" → Webhook → https://spontany.io/api/nudge/webhook
router.post('/nudge/webhook', express.urlencoded({ extended: false }), (req, res) => {
  const from = (req.body.From || '').trim();
  const raw  = (req.body.Body || '').trim();
  const body = raw.toUpperCase();

  // Twilio honors STOP at the carrier level already, but we also track locally
  // so we never re-scheduled nudges ignore opted-out numbers.
  const STOP_WORDS = ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'];
  const HELP_WORDS = ['HELP', 'INFO'];

  let reply = '';

  if (STOP_WORDS.includes(body)) {
    if (from && isValidE164(from)) {
      db.prepare(`
        INSERT OR IGNORE INTO sms_opt_outs (phone, source) VALUES (?, 'stop_keyword')
      `).run(from);

      db.prepare(`
        UPDATE nudges SET status = 'opted_out'
        WHERE phone = ? AND status = 'scheduled'
      `).run(from);
    }
    // Twilio auto-sends its own confirmation - empty TwiML keeps our reply out of the way
    reply = '';
  } else if (HELP_WORDS.includes(body)) {
    reply = 'Spontany: questions? Email hello@spontany.io. Reply STOP to opt out.';
  }

  res.set('Content-Type', 'text/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?><Response>${reply ? `<Message>${reply}</Message>` : ''}</Response>`);
});

// ── Worker: poll every minute, send due nudges ─────────────────────────────
let workerTimer = null;
function startNudgeWorker() {
  if (workerTimer) return;
  workerTimer = setInterval(processDueNudges, 60 * 1000);
  // Run once at startup in case of missed nudges during downtime
  setTimeout(processDueNudges, 5000);
  console.log('[nudge] Worker started (polls every 60s)');
}

async function processDueNudges() {
  let due;
  try {
    due = db.prepare(`
      SELECT * FROM nudges
      WHERE status = 'scheduled'
        AND send_at <= datetime('now')
      LIMIT 50
    `).all();
  } catch(e) {
    console.error('[nudge] Worker query error:', e.message);
    return;
  }

  for (const n of due) {
    if (n.channel !== 'sms') continue; // email nudges: handled elsewhere if ever

    if (isOptedOut(n.phone)) {
      db.prepare("UPDATE nudges SET status = 'opted_out' WHERE id = ?").run(n.id);
      continue;
    }

    const name = n.first_name ? n.first_name + ', ' : '';
    const body = truncate(
      `${name}here's your Spontany nudge - see how your schedule lines up: https://spontany.io/match?utm_source=nudge&utm_content=${encodeURIComponent(n.variant || 'lp')}  Reply STOP to opt out.`,
      MAX_BODY_LEN * 2 // allow 2 segments max
    );

    const result = await sendSMS(n.phone, body, { event: 'nudge', nudgeId: n.id });

    if (result && result.ok) {
      db.prepare(`
        UPDATE nudges SET status = 'sent', sent_at = datetime('now'), twilio_sid = ?
        WHERE id = ?
      `).run(result.sid, n.id);
    } else {
      db.prepare(`
        UPDATE nudges SET status = 'failed', error = ?
        WHERE id = ?
      `).run((result && result.error) || 'unknown', n.id);
    }
  }
}

function truncate(s, n) { return s.length <= n ? s : s.slice(0, n - 1) + '…'; }

module.exports = router;
module.exports.startNudgeWorker = startNudgeWorker;
