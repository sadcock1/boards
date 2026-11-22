// Service worker: makes the app open offline.
// - App shell (index.html) is network-first, falling back to the cached copy.
// - Hashed build assets and icons are cache-first (they never change).
// - /api is never cached: data sync is handled by the app itself.
const CACHE = 'boards-v4';
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/favicon-32.png', '/icons/icon.svg', '/icons/favicon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    (async () => {
      const c = await caches.open(CACHE);
      await c.addAll(SHELL);
      // Also precache the JS/CSS the current index.html points at, so the very first visit works offline
      const html = await (await c.match('/')).text();
      const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
      await c.addAll(assets);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('/', copy));
          return res;
        })
        .catch(() => caches.match('/')),
    );
    return;
  }

  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
  }
});
