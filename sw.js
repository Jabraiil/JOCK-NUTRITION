const CACHE_VERSION = 'jock-nutrition-v39-2026-08-10'
const PRECACHE_URLS = [
    'index.html',
    'offline.html',
    'styles.css?v=38',
    'app.js?v=38',
    'scanner-worker.js',
    'manifest.json',
    'favicon.ico',
    'privacy.html',
    'assets/icons/icon-192.png',
    'assets/icons/icon-192-maskable.png',
    'assets/icons/icon-512.png',
    'assets/icons/icon-512-maskable.png',
    'assets/icons/favicon-16x16.png',
    'assets/icons/favicon-32x32.png',
    'assets/icons/apple-touch-icon.png',
    'icons/apple-touch-icon.svg',
    'icons/icon-192.svg',
    'icons/icon-512.svg',
    'icons/favicon.svg',
    'admin/styles.css',
    'admin/app.js?v=36',
    'admin/index.html',
    'sitemap.xml'
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
    return url.pathname.startsWith('/rest/v1/') ||
           url.pathname.startsWith('/functions/') ||
           url.pathname.startsWith('/auth/') ||
           url.pathname.startsWith('/storage/')
}

function isStaticAsset(url) {
    return url.pathname.match(/\.(css|js)$/i)
}

async function precache() {
    const cache = await caches.open(cacheName('precache'))
    const results = await Promise.allSettled(
        PRECACHE_URLS.map(url =>
            cache.add(url).catch(err => {
                console.warn('Precache failed for', url, err)
            })
        )
    )
    const failed = results.filter(r => r.status === 'rejected').length
    if (failed > 0) {
        console.warn(`Precache: ${failed} resources failed to cache`)
    }
}

async function cleanOldCaches() {
    const keys = await caches.keys()
    const currentPrefixes = ['images', 'api', 'pages', 'static'].map(
        type => `${type}-${CACHE_VERSION}`
    )
    await Promise.all(
        keys
            .filter(key => key !== cacheName('precache') && !currentPrefixes.includes(key))
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

    if (isAPI(url)) {
        event.respondWith(
            fetch(request)
                .then(async response => {
                    if (response && response.status === 200) {
                        try {
                            const cache = await caches.open(cacheName('api'))
                            cache.put(request, response.clone())
                        } catch (e) { /* quota exceeded */ }
                    }
                    return response
                })
                .catch(async () => {
                    const cached = await caches.match(request)
                    if (cached) return cached
                    return new Response(JSON.stringify({ error: 'Offline' }), {
                        headers: { 'Content-Type': 'application/json' },
                        status: 503
                    })
                })
        )
        return
    }

    const isSameOrigin = url.origin === self.location.origin

    if (!isSameOrigin) {
        if (isImage(url) || isFont(url)) {
            event.respondWith(
                caches.match(request).then(async cached => {
                    if (cached) return cached
                    try {
                        const response = await fetch(request)
                        if (response && response.status === 200) {
                            try {
                                const type = isImage(url) ? 'images' : 'fonts'
                                const cache = await caches.open(cacheName(type))
                                cache.put(request, response.clone())
                            } catch (e) { /* quota exceeded */ }
                        }
                        return response
                    } catch (err) {
                        if (isImage(url)) {
                            return new Response(
                                'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1" fill="transparent"/></svg>',
                                { headers: { 'Content-Type': 'image/svg+xml' }, status: 503 }
                            )
                        }
                        return new Response('Offline', { status: 503 })
                    }
                })
            )
        }
        return
    }

    if (isImage(url) || isFont(url)) {
        event.respondWith(
            caches.open(cacheName(isImage(url) ? 'images' : 'fonts')).then(async cache => {
                const cached = await cache.match(request)
                if (cached) return cached
                try {
                    const response = await fetch(request)
                    if (response && response.status === 200) {
                        cache.put(request, response.clone())
                    }
                    return response
                } catch (err) {
                    return new Response('Offline', { status: 503 })
                }
            })
        )
        return
    }

    if (isStaticAsset(url)) {
        event.respondWith(
            caches.match(request).then(async cached => {
                if (cached) return cached
                try {
                    const response = await fetch(request)
                    if (response && response.status === 200) {
                        try {
                            const cache = await caches.open(cacheName('static'))
                            cache.put(request, response.clone())
                        } catch (e) { /* quota exceeded */ }
                    }
                    return response
                } catch (err) {
                    return new Response('Offline', { status: 503 })
                }
            })
        )
        return
    }

    const isHTML = request.headers.get('accept')?.includes('text/html')
    if (isHTML) {
        event.respondWith(
            fetch(request)
                .then(async response => {
                    if (response && response.status === 200) {
                        try {
                            const cache = await caches.open(cacheName('pages'))
                            cache.put(request, response.clone())
                        } catch (e) { /* quota exceeded */ }
                    }
                    return response
                })
                .catch(async () => {
                    const cached = await caches.match('offline.html', { cacheName: cacheName('pages') })
                    if (cached) return cached
                    if (url.pathname.startsWith('/admin/')) {
                        const adminCached = await caches.match('admin/index.html', { cacheName: cacheName('pages') })
                        if (adminCached) return adminCached
                    }
                    const indexCached = await caches.match('index.html', { cacheName: cacheName('pages') })
                    if (indexCached) return indexCached
                    return new Response('Offline', { status: 503 })
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