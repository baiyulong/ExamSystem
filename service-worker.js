const CACHE_NAME = 'architect-exam-study-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/src/app.js',
  '/src/data.js',
  '/src/studyEngine.js',
  '/manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => cached ?? fetch(event.request)),
  );
});
