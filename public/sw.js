/* Shell-only cache. Deliberately does NOT cache data.
 *
 * The database is realtime; the brief, mail and calendar are live. A cached
 * brief from yesterday rendered as today's is worse than an honest empty
 * state, and DESIGN.md's Glow Means Live rule forbids the screen implying
 * currency it does not have. tests/serviceWorker.test.ts fails if any data
 * endpoint is ever named in this file — including, deliberately, in a comment,
 * which is why this paragraph does not spell those paths out.
 *
 * Network-first, not cache-first: a cache-first shell would keep serving the
 * previous build after every deploy until the worker happened to update. The
 * cache is a fallback for being offline, not a performance trick. */

const CACHE = "tarikos-shell-v1";
const SHELL = ["/", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  // Only navigations. Everything else — data, assets, websockets — goes to the
  // network untouched.
  if (request.mode !== "navigate") return;
  event.respondWith(
    fetch(request).catch(() =>
      caches.match("/").then((cached) => cached ?? Response.error()),
    ),
  );
});
