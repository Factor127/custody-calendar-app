'use strict';

let resendClient = null;

function getClient() {
  if (!resendClient) {
    const { Resend } = require('resend');
    resendClient = new Resend(process.env.RESEND_API_KEY);
  }
  return resendClient;
}

const FROM = () => process.env.FROM_EMAIL || 'Spontany <noreply@spontany.app>';

/**
 * Send a calendar invite (.ics attachment) via Resend.
 * Fire-and-forget safe - logs errors but doesn't throw.
 */
async function sendCalendarInvite({ to, subject, bodyText, icsContent, method = 'REQUEST' }) {
  if (!process.env.RESEND_API_KEY) {
    console.log('[email] RESEND_API_KEY not set - skipping invite to', to);
    return;
  }
  try {
    await getClient().emails.send({
      from: FROM(),
      to: [to],
      subject,
      text: bodyText,
      attachments: [{
        filename: method === 'CANCEL' ? 'cancel.ics' : 'invite.ics',
        content: Buffer.from(icsContent).toString('base64'),
        content_type: `text/calendar; method=${method}; charset=UTF-8`,
      }],
    });
    console.log('[email] Sent', method, 'to', to);
  } catch (err) {
    console.error('[email] Failed to send to', to, err.message);
  }
}

/**
 * Send a plain or HTML email (no ICS attachment).
 */
async function sendEmail({ to, subject, bodyText, html, from, replyTo }) {
  if (!process.env.RESEND_API_KEY) {
    console.log('[email] RESEND_API_KEY not set - skipping email to', to);
    return;
  }
  try {
    const payload = {
      from:     from    || FROM(),
      to:       [to],
      subject,
      text:     bodyText,
    };
    if (html)    payload.html     = html;
    if (replyTo) payload.reply_to = replyTo;
    await getClient().emails.send(payload);
    console.log('[email] Sent email to', to);
  } catch (err) {
    console.error('[email] Failed to send email to', to, err.message);
  }
}

module.exports = { sendCalendarInvite, sendEmail };
