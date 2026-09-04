/* Kiosk service worker (spec v1 §5.3).
 *
 * Two jobs:
 *   1. Cache the app shell, so a screen that has loaded once starts with no
 *      network at all — the gap the localStorage cache alone cannot close.
 *   2. Cache the last successful guest-list response, so a reload mid-event
 *      during a network drop still has data.
 *
 * The admin app is deliberately excluded: it must never be served stale.
 */

// Bump this whenever a cached file changes in a way a screen must not miss.
// activate() deletes every cache that is not the current version, so a new
// name forces the shell to be refetched on the next load rather than served
// stale once more.
const VERSION = 'kiosk-v4';
const SHELL = ['/', '/index.html', '/styles.css', '/app.js', '/config.js'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      // A single missing file must not fail the whole install, or the kiosk
      // ends up with no offline support at all.
      .then((cache) => Promise.allSettled(SHELL.map((path) => cache.add(path))))
      .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Never touch the admin app or anything that changes state.
  if (url.pathname.startsWith('/admin')) return;

  // The guest list: network first so an edit reaches the screen, falling back
  // to the last good copy when the network is gone.
  if (url.pathname.includes('/rest/v1/rpc/event_public_payload')) {
    event.respondWith(networkThenCache(request));
    return;
  }

  // Analytics must never be replayed from a cache.
  if (request.method !== 'GET') return;

  // Shell: cache first, refreshed in the background, so a screen starts
  // instantly and still picks up a deploy on the next load.
  if (url.origin === self.location.origin) {
    event.respondWith(cacheThenNetwork(request));
  }
});

async function networkThenCache(request) {
  const cache = await caches.open(VERSION);
  const key = await cacheKeyFor(request);
  try {
    const response = await fetch(request.clone());
    if (response.ok) cache.put(key, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(key);
    if (cached) return cached;
    throw error;
  }
}

async function cacheThenNetwork(request) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match(request);

  const network = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached);

  return cached || network;
}

/* The payload is fetched with POST, which the Cache API will not store as a
 * key. Rewrite it to a GET on a synthetic URL carrying the slug, so each event
 * caches separately.
 *
 * The slug comes from the request body. It must not be added to the request
 * URL: PostgREST rejects unrecognised query parameters on an RPC call, which
 * would break every fetch this worker is meant to be caching. */
async function cacheKeyFor(request) {
  let slug = 'unknown';
  try {
    const body = await request.clone().json();
    if (body && body.p_slug) slug = String(body.p_slug);
  } catch (error) {
    /* Unreadable body: fall back to a shared key rather than failing. */
  }
  return new Request(
    self.location.origin + '/__cached-payload?slug=' + encodeURIComponent(slug),
    { method: 'GET' });
}
