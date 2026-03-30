// ── Push notification helper ──────────────────────────────────────────────────
const webpush = require('web-push');
const { q } = require('../db');

// VAPID keys — set via Railway env vars
const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const VAPID_EMAIL   = process.env.VAPID_EMAIL || 'mailto:info@spontany.club';

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE);
} else {
  console.warn('[push] VAPID keys not set — push notifications disabled');
}

/**
 * Send a push notification to all subscriptions for a user.
 * @param {string} userId
 * @param {{ title: string, body: string, tag?: string, url?: string, actions?: object[] }} payload
 */
async function sendPush(userId, payload) {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return;

  const subs = q.getPushSubsForUser.all(userId);
  if (!subs.length) return;

  const message = JSON.stringify({
    title:   payload.title   || 'Spontany',
    body:    payload.body    || '',
    tag:     payload.tag     || 'spontany-default',
    url:     payload.url     || '/calendar.html',
    icon:    '/icon-192.png',
    badge:   '/icon-192.png',
    actions: payload.actions || [],
  });

  await Promise.allSettled(
    subs.map(sub => {
      const pushSub = {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      };
      return webpush.sendNotification(pushSub, message)
        .catch(err => {
          // 410 Gone = subscription expired/unsubscribed — clean it up
          if (err.statusCode === 410) {
            q.deletePushSub.run(sub.endpoint, userId);
          } else {
            console.error('[push] Send error:', err.statusCode, err.body?.slice?.(0, 80));
          }
        });
    })
  );
}

module.exports = { sendPush, VAPID_PUBLIC };
