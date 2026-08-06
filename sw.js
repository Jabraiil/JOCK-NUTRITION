const CACHE_VERSION = 'jack-nutrition-v15-2026-08-06'
const ASSETS = [
    '/',
    '/index.html',
    '/styles.css',
    '/app.js',
    '/scanner-worker.js',
    '/manifest.json',
    '/assets/icons/icon-192.png',
    '/assets/icons/icon-192-maskable.png',
    '/assets/icons/icon-512.png',
    '/assets/icons/icon-512-maskable.png',
    '/icons/apple-touch-icon.svg',
    '/admin/',
    '/admin/index.html',
    '/admin/styles.css',
    '/admin/app.js'
]

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_VERSION)
            .then((cache) => cache.addAll(ASSETS))
            .then(() => self.skipWaiting())
    )
})

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(
                keys.filter((key) => key !== CACHE_VERSION)
                    .map((key) => caches.delete(key))
            ))
            .then(() => self.clients.claim())
    )
})

self.addEventListener('fetch', (event) => {
    const { request } = event

    if (request.method !== 'GET') return

    const url = new URL(request.url)
    const isSameOrigin = url.origin === self.location.origin

    if (!isSameOrigin) return

    event.respondWith(
        fetch(request)
            .then((response) => {
                if (response && response.status === 200) {
                    const copy = response.clone()
                    caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy))
                }
                return response
            })
            .catch(() => caches.match(request).then((cached) => cached || caches.match('/index.html')))
    )
})