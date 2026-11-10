// Service worker for the M1 app shell (guarantee OfflineCapable, AC-F015-01,
// NFR-A1: the shell loads fully offline after one successful online load).
//
// Strategy: network-first. Every same-origin GET is tried against the
// network first and a successful response refreshes the cache; the cache is
// only the offline fallback. This keeps the shell loadable offline while
// guaranteeing a deploy reaches returning users — a cache-first worker with
// a fixed cache name pins the first-seen bundle forever, so fixes never
// land. The cache name is versioned so a strategy change purges entries
// written under the old policy.
// Contract LocalOnlyBoundary: this worker never initiates cross-origin
// traffic — anything that is not a same-origin GET is left entirely to the
// page.
const CACHE = "sng-shell-v2";

const PRECACHE = [
  "/",
  "/index.html",
  "/bootstrap.mjs",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() =>
        // Offline fallback: the precached shell plus anything cached on a
        // previous online load (AC-F015-01, NFR-A1).
        caches.match(request).then((cached) => cached || Response.error()),
      ),
  );
});
