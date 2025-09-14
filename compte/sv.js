const CACHE_NAME = 'atherion-v1';
const urlsToCache = ['/', 'index.html', 'sentiment.onnx'];

self.addEventListener('install', e => {
    e.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache)));
});

self.addEventListener('fetch', e => {
    e.respondWith(caches.match(e.request).then(res => res || fetch(e.request)));
});

// Push notifications (exp)
self.addEventListener('push', e => {
    self.registration.showNotification('Atherion Update', { body: e.data.text() });
});