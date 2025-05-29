const CACHE_NAME = 'wedding-gallery-v1';
// sw.js (same folder as index.html)
const ASSETS = [
  './',                 // → /wedding-photos/
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', evt => {
  evt.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache =>
        cache.addAll(ASSETS.map(u => new Request(u, {cache: 'reload'})))
      )
      .catch(err => {
        console.error('SW caching failed:', err);
        // Skip caching but still install
      })
  );
  self.skipWaiting();
});

self.addEventListener('activate', evt => {
  evt.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', evt => {
  evt.respondWith(
    caches.match(evt.request).then(cached => cached || fetch(evt.request))
  );
});
