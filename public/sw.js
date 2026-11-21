// Factory Spaghetti service worker (plain JS, served as-is from public/).
//
// At build time vite.config.ts replaces the two placeholders below with the app version and the
// list of every built file (src/app/precache.ts): the page, all script chunks (including the
// lazily loaded 3D table and Three.js), stylesheets, piece models, icons and the manifest, each
// with a content revision. Because the version is baked in, every deploy changes this file, so
// the browser installs the new worker and the page can show "Update ready — reload".
//
// Install stores every file of this version, so a solo game works offline after a single visit
// to the menu. Files whose revision did not change are copied from the previous version's store
// instead of being downloaded again. Install runs in the background after the page has loaded
// (the page registers the worker on 'load'), so it never delays the first paint.
//
// Strategies:
//   page navigations           network first, fall back to the stored page (offline play)
//   files of this version      from this version's store (they match the running scripts)
//   other same-origin GETs     network first, stored copy when offline
//   anything cross-origin      never touched (the PeerJS broker, STUN/TURN, ...)

const VERSION = '__APP_VERSION__';
const PRECACHE = /* __PRECACHE_LIST__ */ [];

const PREFIX = 'factory-spaghetti-';
const SHELL_CACHE = `${PREFIX}shell-${VERSION}`; // every built file of this version
const RUNTIME_CACHE = `${PREFIX}runtime-v1`; // same-origin files outside the build list
const REV_HEADER = 'X-FS-Rev';

const SCOPE = self.registration.scope; // e.g. https://user.github.io/repo/
const PAGE_URL = new URL('./', SCOPE).href;
const abs = (url) => new URL(url, SCOPE).href;
const LISTED = new Set(PRECACHE.map(([url]) => abs(url)));

/** A stored copy of `url` with revision `rev` in any of our older stores, or undefined. */
async function previousCopy(url, rev, older) {
  for (const name of older) {
    const cache = await caches.open(name);
    const hit = await cache.match(url);
    if (hit && hit.headers.get(REV_HEADER) === rev) return hit;
  }
  return undefined;
}

/** The response with its revision recorded, so the next version can reuse it. */
async function withRev(response, rev) {
  const headers = new Headers(response.headers);
  headers.set(REV_HEADER, rev);
  const body = await response.blob();
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

async function precache() {
  const cache = await caches.open(SHELL_CACHE);
  const older = (await caches.keys()).filter((n) => n.startsWith(`${PREFIX}shell-`) && n !== SHELL_CACHE);
  // The page is always fetched fresh (it names this version's script files).
  const page = await fetch(new Request(PAGE_URL, { cache: 'reload' }));
  if (!page.ok) throw new Error(`precache: page ${page.status}`);
  await cache.put(PAGE_URL, page);
  // A few at a time: quick on a good connection, gentle on a phone.
  const queue = PRECACHE.filter(([url]) => abs(url) !== PAGE_URL);
  const worker = async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      const [url, rev] = item;
      const href = abs(url);
      if (await cache.match(href)) continue;
      const reused = await previousCopy(href, rev, older);
      if (reused) { await cache.put(href, reused); continue; }
      const response = await fetch(new Request(href, { cache: 'reload' }));
      if (!response.ok) throw new Error(`precache: ${url} ${response.status}`);
      await cache.put(href, await withRev(response, rev));
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache());
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
  if (!event.data) return;
  if (event.data.type === 'SKIP_WAITING') self.skipWaiting();
  // The page asks how much is stored for offline play (for checks and the network page).
  if (event.data.type === 'OFFLINE_STATUS' && event.ports[0]) {
    offlineStatus().then((status) => event.ports[0].postMessage(status));
  }
});

async function offlineStatus() {
  const cache = await caches.open(SHELL_CACHE);
  const keys = await cache.keys();
  const stored = new Set(keys.map((r) => r.url));
  const missing = [...LISTED].filter((u) => !stored.has(u));
  return { version: VERSION, files: LISTED.size, missing: missing.length };
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(SCOPE)) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstPage(request));
  } else if (LISTED.has(url.origin + url.pathname)) {
    event.respondWith(fromThisVersion(request, url.origin + url.pathname));
  } else {
    event.respondWith(networkFirst(request));
  }
});

async function networkFirstPage(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok && !response.redirected) {
      // Store under the page URL without the query (?join=CODE) so any link to the app works offline.
      const url = new URL(request.url);
      url.search = '';
      url.hash = '';
      // Only the page of this version: a page of a newer deploy would name scripts this worker lacks.
      if (url.href !== PAGE_URL) await cache.put(url.href, response.clone());
    }
    return response;
  } catch (err) {
    const cached = (await cache.match(request, { ignoreSearch: true })) || (await cache.match(PAGE_URL));
    if (cached) return cached;
    throw err;
  }
}

async function fromThisVersion(request, href) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(href);
  if (cached) return cached;
  // Not stored yet (install still running): from the network, stored on the way.
  const response = await fetch(request);
  if (response.ok && response.type === 'basic') await cache.put(href, response.clone());
  return response;
}

async function networkFirst(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') await cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}
