const CACHE_NAME = 'rangrasiya-app-v1';

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const response = await fetch('/', { cache: 'reload' });
    if (!response.ok) throw new Error(`App shell request failed (${response.status}).`);
    await cache.put('/', response.clone());

    const html = await response.text();
    const resources = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
      .map(([, path]) => new URL(path, self.location.origin))
      .filter(url => url.origin === self.location.origin)
      .map(url => `${url.pathname}${url.search}`);
    await cache.addAll([...new Set(resources)]);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames
        .filter(name => name.startsWith('rangrasiya-app-') && name !== CACHE_NAME)
        .map(name => caches.delete(name)),
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put('/', response.clone());
        }
        return response;
      } catch (error) {
        const cached = await caches.match('/');
        if (cached) return cached;
        throw error;
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  })());
});
