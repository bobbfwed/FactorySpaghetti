// Factory Spaghetti service worker (plain JS, served as-is from public/).
//
// At build time vite.config.ts replaces the two placeholders below with the app version and the
// list of built files. Because the version is baked in, every deploy changes this file, so the
// browser installs the new worker and the page can show "Update ready — reload".
//
// Strategies:
//   page navigations          network first, fall back to the cached page (offline play)
//   built assets (assets/*)   cache first (Vite file names are content-hashed, so they never change)
//   other same-origin GETs    stale-while-revalidate (models, icons, manifest)

const VERSION = '__APP_VERSION__';
const PRECACHE = /* __PRECACHE_LIST__ */ [];

const PREFIX = 'factory-spaghetti-';
const SHELL_CACHE = `${PREFIX}shell-${VERSION}`; // page + hashed build files of this version
const RUNTIME_CACHE = `${PREFIX}runtime-v1`; // models, icons and other unhashed files; kept across versions

const SCOPE = self.registration.scope; // e.g. https://user.github.io/repo/
const ASSET_PREFIX = new URL('assets/', SCOPE).href;
const PAGE_URL = new URL('./', SCOPE).href;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      cache.addAll(['./', ...PRECACHE].map((url) => new Request(new URL(url, SCOPE).href, { cache: 'reload' }))),
    ),
  );
  // No skipWaiting() here: a new version waits until the page asks for it (see 'message').
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            // Only our own caches: other sites on the same github.io origin share this storage.
            .filter((name) => name.startsWith(PREFIX) && name !== SHELL_CACHE && name !== RUNTIME_CACHE)
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(SCOPE)) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
  } else if (url.href.startsWith(ASSET_PREFIX)) {
    event.respondWith(cacheFirst(request));
  } else {
    event.respondWith(staleWhileRevalidate(request, event));
  }
});

async function networkFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok && !response.redirected) {
      // Store under the page URL without the query (?join=CODE) so any link to the app works offline.
      const url = new URL(request.url);
      url.search = '';
      url.hash = '';
      await cache.put(url.href, response.clone());
    }
    return response;
  } catch (err) {
    const cached = (await cache.match(request, { ignoreSearch: true })) || (await cache.match(PAGE_URL));
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(SHELL_CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

async function staleWhileRevalidate(request, event) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  const refresh = fetch(request)
    .then((response) => {
      if (response.ok) event.waitUntil(cache.put(request, response.clone()));
      return response;
    })
    .catch(() => undefined);
  if (cached) {
    event.waitUntil(refresh);
    return cached;
  }
  const response = await refresh;
  return response || Response.error();
}
