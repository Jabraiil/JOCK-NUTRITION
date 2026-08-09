const CACHE_VERSION = 'jack-nutrition-v37-2026-08-09'
const PRECACHE_URLS = [
    '/',
    '/index.html',
    '/offline.html',
    '/styles.css',
    '/app.js',
    '/scanner-worker.js',
    '/manifest.json',
    '/favicon.ico',
    '/assets/icons/icon-192.png',
    '/assets/icons/icon-192-maskable.png',
    '/assets/icons/icon-512.png',
    '/assets/icons/icon-512-maskable.png',
    '/assets/icons/favicon-16x16.png',
    '/assets/icons/favicon-32x32.png',
    '/assets/icons/apple-touch-icon.png',
    '/icons/apple-touch-icon.svg',
    '/icons/icon-192.svg',
    '/icons/icon-512.svg',
    '/icons/favicon.svg',
    '/admin/styles.css',
    '/admin/app.js'
]

const CACHE_STRATEGIES = {
    images: 'cache-first',
    fonts: 'cache-first',
    api: 'network-first',
    pages: 'stale-while-revalidate',
    static: 'cache-first'
}

function cacheName(type) {
    return `${type}-${CACHE_VERSION}`
}

function isImage(url) {
    return url.pathname.match(/\.(png|jpg|jpeg|webp|avif|gif|svg)$/i)
}

function isFont(url) {
    return url.pathname.match(/\.(woff|woff2|ttf|eot|otf)$/i)
}

function isAPI(url) {
    return url.pathname.startsWith('/rest/') ||
           url.pathname.startsWith('/functions/') ||
           url.pathname.startsWith('/auth/')
}

function isStaticAsset(url) {
    return url.pathname.match(/\.(css|js)$/)
}

async function precache() {
    const cache = await caches.open(cacheName('precache'))
    await cache.addAll(PRECACHE_URLS)
}

async function cleanOldCaches() {
    const keys = await caches.keys()
    await Promise.all(
        keys.filter(key => key !== cacheName('precache') && !key.startsWith('images-') && !key.startsWith('api-') && !key.startsWith('pages-'))
            .map(key => caches.delete(key))
    )
}

self.addEventListener('install', (event) => {
    event.waitUntil(
        precache()
            .then(() => self.skipWaiting())
    )
})

self.addEventListener('activate', (event) => {
    event.waitUntil(
        cleanOldCaches()
            .then(() => self.clients.claim())
    )
})

self.addEventListener('fetch', (event) => {
    const { request } = event

    if (request.method !== 'GET') return

    const url = new URL(request.url)
    const isSameOrigin = url.origin === self.location.origin

    if (!isSameOrigin) {
        if (isImage(url) || isFont(url)) {
            event.respondWith(
                caches.match(request).then(cached => {
                    if (cached) return cached
                    return fetch(request).then(response => {
                        if (response && response.status === 200) {
                            const type = isImage(url) ? 'images' : 'fonts'
                            caches.open(cacheName(type)).then(cache => {
                                cache.put(request, response.clone()).catch(() => {})
                            })
                        }
                        return response
                    })
                }).catch(() => new Response('Offline', { status: 503 }))
            )
        }
        return
    }

    if (isAPI(url)) {
        event.respondWith(
            fetch(request)
                .then(response => {
                    if (response && response.status === 200) {
                        const clone = response.clone()
                        caches.open(cacheName('api')).then(cache => cache.put(request, clone)).catch(() => {})
                    }
                    return response
                })
                .catch(() => {
                    return caches.match(request).then(cached => {
                        if (cached) return cached
                        return new Response(JSON.stringify({ error: 'Offline' }), {
                            headers: { 'Content-Type': 'application/json' },
                            status: 503
                        })
                    })
                })
        )
        return
    }

    if (isImage(url) || isFont(url)) {
        event.respondWith(
            caches.open(cacheName(isImage(url) ? 'images' : 'fonts')).then(cache => {
                return cache.match(request).then(cached => {
                    if (cached) return cached
                    return fetch(request).then(response => {
                        if (response && response.status === 200) {
                            cache.put(request, response.clone())
                        }
                        return response
                    }).catch(() => new Response('Offline', { status: 503 }))
                })
            })
        )
        return
    }

    if (isStaticAsset(url)) {
        event.respondWith(
            caches.match(request).then(cached => {
                if (cached) return cached
                return fetch(request).then(response => {
                    if (response && response.status === 200) {
                        const clone = response.clone()
                        caches.open(cacheName('static')).then(cache => cache.put(request, clone)).catch(() => {})
                    }
                    return response
                }).catch(() => new Response('Offline', { status: 503 }))
            })
        )
        return
    }

    const isHTML = request.headers.get('accept')?.includes('text/html')
    if (isHTML) {
        event.respondWith(
            fetch(request)
                .then(response => {
                    if (response && response.status === 200) {
                        const clone = response.clone()
                        caches.open(cacheName('pages')).then(cache => cache.put(request, clone)).catch(() => {})
                    }
                    return response
                })
                .catch(() => {
                    return caches.match('/offline.html').then(cached => {
                        if (cached) return cached
                        return caches.match('/index.html')
                    }).catch(() => new Response('Offline', { status: 503 }))
                })
        )
        return
    }

    event.respondWith(
        fetch(request).catch(() => new Response('Offline', { status: 503 }))
    )
})

self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting()
    }
})