// ============================================
// JACK NUTRITION - Service Worker
// Cache-busting для GitHub Pages: принудительно
// обновляет статику при изменении CACHE_VERSION.
// ============================================

const CACHE_VERSION = 'jack-nutrition-v11-2026-07-19'
const ASSETS = [
    '/',
    '/index.html',
    '/styles.css',
    '/app.js',
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

    // Supabase API/Edge Functions — не кешируем, всегда сеть.
    if (!isSameOrigin) return

    // Сетевой режим «сначала сеть, при ошибке — кеш».
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
