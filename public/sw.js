// ── Spontany Service Worker ───────────────────────────────────────────────
// Phase 1: Offline shell + static asset caching
// Phase 2: Push notification handling (added below)

const CACHE_VERSION = 'spontany-v2';
const STATIC_ASSETS = [
  '/styles.css',
  '/logo.svg',
  '/calendar.html',
  '/login.html',
  '/onboard.html',
  '/partner.html',
];

// ── Install: pre-cache static shell ──────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: wipe old caches ─────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch: routing strategy ───────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin GET requests
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  // API calls: always network-only — never cache auth/data responses
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) return;

  // HTML navigation: network-first, fall back to cached page
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(res => {
          // Update cache in the background
          const clone = res.clone();
          caches.open(CACHE_VERSION).then(c => c.put(request, clone));
          return res;
        })
        .catch(() =>
          caches.match(request)
            .then(cached => cached || caches.match('/calendar.html'))
        )
    );
    return;
  }

  // Static assets (CSS, SVG, fonts, images): cache-first, update in background
  event.respondWith(
    caches.match(request).then(cached => {
      const networkFetch = fetch(request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_VERSION).then(c => c.put(request, clone));
        }
        return res;
      });
      return cached || networkFetch;
    })
  );
});

// ── Push notifications (Phase 2) ─────────────────────────────────────────
self.addEventListener('push', event => {
  if (!event.data) return;
  let data;
  try { data = event.data.json(); } catch { data = { title: 'Spontany', body: event.data.text() }; }

  const options = {
    body:    data.body  || '',
    icon:    data.icon  || '/logo.svg',
    badge:   data.badge || '/logo.svg',
    tag:     data.tag   || 'spontany',
    data:    data.url   ? { url: data.url } : {},
    vibrate: [100, 50, 100],
    actions: data.actions || [],
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'Spontany', options)
  );
});

// ── Notification click: open/focus the app ───────────────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = event.notification.data?.url || '/calendar.html';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(windowClients => {
        const match = windowClients.find(c => c.url.includes(self.location.origin));
        if (match) return match.focus();
        return clients.openWindow(target);
      })
  );
});
