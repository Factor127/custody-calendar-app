// ── SMS notification helper (Twilio) ─────────────────────────────────────────
'use strict';

const { q } = require('../db');

let twilioClient = null;

function getClient() {
  if (!twilioClient) {
    const SID   = process.env.TWILIO_ACCOUNT_SID;
    const TOKEN = process.env.TWILIO_AUTH_TOKEN;
    if (!SID || !TOKEN) return null;
    twilioClient = require('twilio')(SID, TOKEN);
  }
  return twilioClient;
}

const FROM_NUMBER = () => process.env.TWILIO_PHONE_NUMBER;

/**
 * Send an SMS notification. Fire-and-forget — logs errors but never throws.
 * Checks user's sms_opt_in preference before sending.
 *
 * @param {string} to       — E.164 phone number (e.g. "+14155551234")
 * @param {string} message  — SMS body (max ~160 chars recommended)
 * @param {{ event?: string, userId?: string }} ctx — optional context for logging
 */
async function sendSMS(to, message, ctx = {}) {
  const client = getClient();
  if (!client || !FROM_NUMBER()) {
    console.log('[sms] Twilio not configured — skipping SMS to', to?.slice(-4));
    return;
  }

  if (!to || typeof to !== 'string') return;

  // Normalise: strip spaces/dashes, ensure starts with +
  let phone = to.replace(/[\s\-()]/g, '');
  if (!phone.startsWith('+')) phone = '+1' + phone; // default US

  try {
    const result = await client.messages.create({
      body: message,
      from: FROM_NUMBER(),
      to:   phone,
    });
    console.log('[sms] Sent to', phone.slice(-4), '| SID:', result.sid, '| event:', ctx.event || '-');
  } catch (err) {
    console.error('[sms] Failed to send to', phone.slice(-4), ':', err.message);
  }
}

/**
 * Send SMS to a user by their user ID (looks up phone + checks opt-in).
 * Use this instead of sendSMS() when you have a userId.
 *
 * @param {string} userId
 * @param {string} message
 * @param {{ event?: string }} ctx
 */
async function sendSMSToUser(userId, message, ctx = {}) {
  try {
    const user = q.getUserById.get(userId);
    if (!user?.mobile) return;
    if (user.sms_opt_in === 0) return; // explicitly opted out
    await sendSMS(user.mobile, message, { ...ctx, userId });
  } catch (err) {
    console.error('[sms] sendSMSToUser error:', err.message);
  }
}

module.exports = { sendSMS, sendSMSToUser };
