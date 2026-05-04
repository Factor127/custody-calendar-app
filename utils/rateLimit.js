'use strict';

// Process-local rate limiter. Single-dyno on Railway, so a Map is fine and
// resets on restart. If we ever scale horizontally, swap the bucket store
// for Redis without touching callers.
//
// Two ways to use:
//
//   1. As Express middleware (single key per limiter):
//        const ipLimit = rateLimit({ keyFn: r => r.ip, windowMs: 10*60_000, max: 10 });
//        router.post('/foo', ipLimit, handler);
//      Chain multiple middlewares for per-IP + per-email/phone gating.
//
//   2. Inline check (multi-key, normalized values, conditional gates):
//        const bucket = createBucket();
//        if (!rateLimitAllow(bucket, normalizedPhone, 24*60*60_000, 3)) ...

function createBucket() {
  const m = new Map();
  setInterval(() => {
    const cutoff = Date.now() - 60 * 60 * 1000;
    for (const [k, arr] of m) {
      const fresh = arr.filter(e => e.ts > cutoff);
      if (fresh.length === 0) m.delete(k); else m.set(k, fresh);
    }
  }, 10 * 60 * 1000).unref();
  return m;
}

function rateLimitAllow(bucket, key, windowMs, max) {
  if (!key) return true;  // no key → don't gate (caller is responsible for input validation)
  const now = Date.now();
  const cutoff = now - windowMs;
  const arr = (bucket.get(key) || []).filter(e => e.ts > cutoff);
  if (arr.length >= max) { bucket.set(key, arr); return false; }
  arr.push({ ts: now });
  bucket.set(key, arr);
  return true;
}

function rateLimit({ keyFn, windowMs, max, message }) {
  const bucket = createBucket();
  const errMsg = message || 'Too many requests. Please wait a few minutes before trying again.';
  return function rateLimitMiddleware(req, res, next) {
    const key = keyFn(req);
    if (!rateLimitAllow(bucket, key, windowMs, max)) {
      return res.status(429).json({ error: errMsg });
    }
    next();
  };
}

module.exports = { createBucket, rateLimitAllow, rateLimit };
