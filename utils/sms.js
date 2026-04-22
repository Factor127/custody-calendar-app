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

const FROM_NUMBER = () => process.env.TWILIO_FROM_NUMBER || process.env.TWILIO_PHONE_NUMBER;

function isConfigured() {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && FROM_NUMBER());
}

function isValidE164(raw) {
  if (!raw) return false;
  return /^\+[1-9]\d{7,15}$/.test(String(raw).trim());
}

function toE164(raw, defaultCountry = '+1') {
  if (!raw) return null;
  const s = String(raw).trim();
  if (s.startsWith('+')) {
    const cleaned = '+' + s.slice(1).replace(/\D/g, '');
    return isValidE164(cleaned) ? cleaned : null;
  }
  const digits = s.replace(/\D/g, '');
  if (!digits) return null;
  if (defaultCountry === '+1') {
    if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
    if (digits.length === 10) return '+1' + digits;
  }
  const guess = defaultCountry + digits;
  return isValidE164(guess) ? guess : null;
}

/**
 * Send an SMS. Returns { ok, sid?, error? }.
 * Legacy callers that ignore the return value continue to work.
 *
 * @param {string} to       - E.164 phone number (e.g. "+14155551234")
 * @param {string} message  - SMS body
 * @param {{ event?: string, userId?: string }} ctx - optional context for logging
 */
async function sendSMS(to, message, ctx = {}) {
  const client = getClient();
  if (!client || !FROM_NUMBER()) {
    console.log('[sms] Twilio not configured - skipping SMS to', to?.slice(-4));
    return { ok: false, error: 'not_configured' };
  }

  if (!to || typeof to !== 'string') {
    return { ok: false, error: 'invalid_to' };
  }

  let phone = to.replace(/[\s\-()]/g, '');
  if (!phone.startsWith('+')) phone = '+1' + phone;

  if (!isValidE164(phone)) {
    return { ok: false, error: 'invalid_e164' };
  }

  try {
    const result = await client.messages.create({
      body: message,
      from: FROM_NUMBER(),
      to:   phone,
    });
    console.log('[sms] Sent to', phone.slice(-4), '| SID:', result.sid, '| event:', ctx.event || '-');
    return { ok: true, sid: result.sid };
  } catch (err) {
    console.error('[sms] Failed to send to', phone.slice(-4), ':', err.message);
    return { ok: false, error: err.message };
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

module.exports = { sendSMS, sendSMSToUser, isValidE164, toE164, isConfigured };
