/**
 * Offline shell.
 *
 * Bump CACHE on every deploy — that is the whole upgrade mechanism.
 * App data lives in IndexedDB and is untouched by cache changes.
 *
 * Strategy: cache-first for the shell (it is versioned, so staleness is
 * impossible), network-only for the model proxy (never cache an estimate).
 */

const CACHE = 'baseline-v3';

const SHELL = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './src/main.js',
  './src/core/dom.js',
  './src/core/db.js',
  './src/core/store.js',
  './src/core/router.js',
  './src/core/format.js',
  './src/domain/targets.js',
  './src/domain/trends.js',
  './src/domain/engine.js',
  './src/domain/foods.js',
  './src/domain/questions.js',
  './src/services/ai.js',
  './src/services/image.js',
  './src/ui/chart.js',
  './src/ui/components.js',
  './src/views/home.js',
  './src/views/food.js',
  './src/views/progress.js',
  './src/views/training.js',
  './src/views/insights.js',
  './src/views/profile.js',
  './src/views/onboarding.js',
  './src/views/dev.js',
  './src/views/account.js',
  './src/services/firebase.js',
  './src/services/sync.js',
  './src/dev/scenarios.js'
];

// Deliberately NOT cached: src/config.js (may not exist, and is per-install)
// and the Firebase SDK, which is cross-origin and handled by the early return
// in the fetch handler below.

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // proxy calls go straight to the network

  event.respondWith(
    caches.match(request).then((hit) => {
      if (hit) return hit;
      return fetch(request)
        .then((response) => {
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match('./index.html'));
    })
  );
});
