// Service worker for the M1 app shell (guarantee OfflineCapable, AC-F015-01,
// NFR-A1: the shell loads fully offline after one successful online load).
//
// Strategy: cache-first. The shell assets are precached at install time;
// every other same-origin GET is served from the cache when present and
// cached on first successful fetch. Contract LocalOnlyBoundary: this worker
// never initiates cross-origin traffic — anything that is not a same-origin
// GET is left entirely to the page.
const CACHE = "sng-shell-v1";

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
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    }),
  );
});
