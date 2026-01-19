const CACHE_NAME = 'atd-studio-v1';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './favicon.png'
];

// 1. Install Event: Cache static assets
self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
});

// 2. Fetch Event: Network First, Fallback to Cache
self.addEventListener('fetch', (e) => {
    // Only handle GET requests
    if (e.request.method !== 'GET') return;

    e.respondWith(
        fetch(e.request)
            .then((response) => {
                // If valid response, clone it to cache (for next time)
                const resClone = response.clone();
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put(e.request, resClone);
                });
                return response;
            })
            .catch(() => {
                // Network failed? Try serving from cache
                return caches.match(e.request);
            })
    );
});