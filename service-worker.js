const CACHE_NAME = 'prettyus-pwa-v2-logo';
const BASE = self.registration.scope;
const FILES = [
  './', 'index.html', 'about.html', 'contact.html', 'submit-avon-order.html',
  'my-avon-journey.html', 'building-your-avon-business.html',
  'avon-representative-guide.html', 'more-ways-to-share-avon.html',
  'why-shop-with-me.html', 'style.css', 'avon-order.js', 'manifest.webmanifest', 'Icon-192.png', 'Icon-512.png'
].map(path => new URL(path, BASE).href);

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(FILES))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(Promise.all([
    caches.keys().then(keys => Promise.all(keys
      .filter(key => key.startsWith('prettyus-pwa-') && key !== CACHE_NAME)
      .map(key => caches.delete(key)))),
    self.clients.claim()
  ]));
});
self.addEventListener('fetch', event => {
  // Never intercept orders, Google Apps Script, Avon or other external services.
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== new URL(BASE).origin || !url.href.startsWith(BASE)) return;
  const navigation = event.request.mode === 'navigate';
  const publicAsset = !url.search && FILES.includes(url.href);
  if (!navigation && !publicAsset) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const response = await fetch(event.request);
      // Keep current public pages available offline, without caching query data.
      if (publicAsset && response.ok) {
        event.waitUntil(cache.put(event.request, response.clone()).catch(() => {}));
      }
      return response;
    } catch {
      const saved = publicAsset && await cache.match(event.request);
      if (saved) return saved;
      if (navigation) {
        const fallback = await cache.match(new URL('index.html', BASE).href);
        if (fallback) return fallback;
      }
      return Response.error();
    }
  })());
});
