// Bump this any time the cached app shell changes.
const CACHE_VERSION = 'v2';
const CACHE_NAME = `pwa-sandbox-${CACHE_VERSION}`;

const APP_SHELL = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/manifest.json',
  '/offline.html',
  '/icons/icon.svg',
  '/icons/icon-maskable.svg',
];

// ─── Install: pre-cache the shell ───────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

// ─── Activate: drop old caches ──────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ─── Fetch: cache-first for shell, network-first elsewhere ──────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Don't intercept API calls — we want push trigger to go to the network.
  if (url.pathname.startsWith('/api/')) return;

  // Navigation requests: try network, fall back to cache, then offline page.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(request, copy));
          return res;
        })
        .catch(() =>
          caches.match(request).then((cached) => cached || caches.match('/offline.html'))
        )
    );
    return;
  }

  // Other GETs: cache-first.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((res) => {
          if (!res || res.status !== 200 || res.type !== 'basic') return res;
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(request, copy));
          return res;
        })
        .catch(() => caches.match('/offline.html'));
    })
  );
});

// ─── Push: show the notification ────────────────────────────────
self.addEventListener('push', (event) => {
  let payload = { title: 'PWA Sandbox', body: 'You have a new message.' };
  if (event.data) {
    try { payload = { ...payload, ...event.data.json() }; }
    catch { payload.body = event.data.text(); }
  }

  const options = {
    body: payload.body,
    icon: '/icons/icon.svg',
    badge: '/icons/icon.svg',
    data: { url: payload.url || '/' },
    tag: payload.tag || 'pwa-sandbox',
  };

  event.waitUntil(self.registration.showNotification(payload.title, options));
});

// ─── Notification click: focus or open the app ──────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ('focus' in w) return w.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});

// ─── Reply to a version query from the page ─────────────────────
self.addEventListener('message', (event) => {
  if (event.data === 'GET_VERSION') {
    event.source && event.source.postMessage({ type: 'VERSION', version: CACHE_VERSION });
  }
});
