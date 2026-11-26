/*
 * Hand-written service worker, served as a plain file from the site root so it
 * is not bundled or hashed. Keeping it dependency-free means an update is a
 * cache-name bump plus a deploy.
 *
 * Strategy summary:
 *   /assets/*      cache-first (hashed, immutable)
 *   navigations    network-first with a timeout, falling back to the shell
 *   other statics  stale-while-revalidate
 *   /api/, media   network-only — responses are user-specific and must never
 *                  be replayed from a shared cache
 */

const VERSION = 'fala-v2';
const CACHE = `fala-${VERSION}`;

/* The shell is small and changes rarely; precaching it makes the offline
 * fallback available even before the user has navigated anywhere else. */
const SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/favicon.ico',
  '/favicon-16.png',
  '/favicon-32.png',
  '/favicon-48.png',
  '/favicon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png',
  '/apple-touch-icon.png',
];

/* Audio, artwork and API payloads are per-user and often streamed with range
 * requests; caching them would leak state between sessions and break seeking. */
const NETWORK_ONLY = /^\/(api|media|audio|artwork|stream|proxy)\//i;
const MEDIA_EXT = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|webm|mp4|hls|m3u8|ts|jpe?g|png|webp|gif|avif)$/i;

const NAV_TIMEOUT = 3000;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      /*
       * Each shell file is stored on its own. `addAll` rejects the whole batch
       * when a single request fails, which would leave the app with no worker at
       * all over one missing icon; a partial precache still installs and the
       * network-first navigation fills the shell in on the first visit.
       */
      await Promise.all(
        SHELL.map((url) => cache.add(url).catch(() => undefined))
      );
      // A new worker should not wait for every tab to close; the app is
      // single-page and safe to update underneath the user.
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

function isCacheableStatic(url) {
  return !NETWORK_ONLY.test(url.pathname) && !MEDIA_EXT.test(url.pathname);
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await withTimeout(fetch(request), NAV_TIMEOUT);
    // Only store a real, complete document — opaque or error responses would
    // poison the offline shell.
    if (response && response.ok && response.type === 'basic') {
      cache.put('/index.html', response.clone()).catch(() => undefined);
    }
    return response;
  } catch {
    const cached = await cache.match('/index.html');
    if (cached) return cached;
    return new Response('Offline', { status: 503, statusText: 'Offline' });
  }
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok) cache.put(request, response.clone()).catch(() => undefined);
  return response;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response && response.ok) cache.put(request, response.clone()).catch(() => undefined);
      return response;
    })
    .catch(() => undefined);
  return cached || (await network) || new Response('Offline', { status: 503, statusText: 'Offline' });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  // Cross-origin (fonts, CDNs) and anything we do not own passes straight
  // through; the browser's own HTTP cache handles those.
  if (url.origin !== self.location.origin) return;
  if (NETWORK_ONLY.test(url.pathname) || MEDIA_EXT.test(url.pathname)) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (isCacheableStatic(url)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});
