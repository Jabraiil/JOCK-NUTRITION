const CONFIG = {
    supabaseUrl: 'https://hpphfeojjejculvdundj.supabase.co',
    supabaseAnonKey: 'sb_publishable_1EGpjPEw9gU2W5OKL-gFIQ_x4Gvger1',
    orderFunctionUrl: 'https://hpphfeojjejculvdundj.supabase.co/functions/v1/create-order',
    adminApiUrl: 'https://hpphfeojjejculvdundj.supabase.co/functions/v1/admin-api'
}

async function fetchWithTimeout(url, options = {}, timeout = 15000) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)
    try {
        const response = await window.fetch(url, { ...options, signal: controller.signal })
        clearTimeout(timer)
        return response
    } catch (error) {
        clearTimeout(timer)
        if (error.name === 'AbortError') {
            throw new Error('Превышено время ожидания запроса (15 сек)')
        }
        throw error
    }
}

function escapeHtml(str) {
    if (str == null) return ''
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;')
}

function cleanProductName(name, brand) {
    if (!name) return ''
    let cleaned = name
    if (brand) {
        const brandUpper = brand.toUpperCase()
        const nameUpper = cleaned.toUpperCase()
        if (nameUpper.startsWith(brandUpper)) {
            cleaned = cleaned.slice(brandUpper.length).trim()
        }
    }
    return cleaned
}

let allProducts = []
let filteredProducts = []
let relatedMap = []
let cart = []
let favorites = []
try {
    const cartRaw = localStorage.getItem('jock-cart')
    if (cartRaw) cart = JSON.parse(cartRaw)
} catch (e) {
    console.error('Failed to parse cart from localStorage:', e)
}
try {
    const favRaw = localStorage.getItem('jock-favorites')
    if (favRaw) favorites = JSON.parse(favRaw)
} catch (e) {
    console.error('Failed to parse favorites from localStorage:', e)
}
let favoritesOnly = false
let darkMode = localStorage.getItem('jock-theme') === 'dark'
let barcodeStream = null
let scannerFlashOn = false
let scannerMode = 'camera'
let lastVideoTime = -1
let scannerWorker = null
let scannerDetector = null
let workerBusy = false
let scanCropCache = null
let scanCropVideoW = 0
let scanCropVideoH = 0
let scanLastTime = 0
const SCAN_INTERVAL_MS = 250
let scanRafId = null
let productsPage = 1
const PRODUCTS_PER_PAGE = 20
let productsTotal = 0
let isLoadingMore = false
let hasMoreProducts = true
const apiCache = {
    products: { data: null, ts: 0, ttl: 30000 },
    related: { data: null, ts: 0, ttl: 60000 },
    categories: { data: null, ts: 0, ttl: 60000 },
    brands: { data: null, ts: 0, ttl: 60000 },
}

let initialized = false

function resetFilterState() {
    favoritesOnly = false
    const navFav = document.getElementById('navFavorites')
    if (navFav) navFav.classList.remove('active')
    const categoryFilter = document.getElementById('categoryFilter')
    if (categoryFilter) categoryFilter.value = ''
    const brandFilter = document.getElementById('brandFilter')
    if (brandFilter) brandFilter.value = ''
    const priceFrom = document.getElementById('priceFrom')
    if (priceFrom) priceFrom.value = ''
    const priceTo = document.getElementById('priceTo')
    if (priceTo) priceTo.value = ''
    const sortFilter = document.getElementById('sortFilter')
    if (sortFilter) sortFilter.value = 'newest'
    const searchInput = document.getElementById('searchInput')
    if (searchInput) searchInput.value = ''
    const searchBar = document.getElementById('searchBar')
    if (searchBar && !searchBar.classList.contains('hidden')) {
        searchBar.classList.add('hidden')
    }
    const bottomNavItems = document.querySelectorAll('.bottom-nav-item')
    if (bottomNavItems.length) {
        bottomNavItems.forEach(n => n.classList.remove('active'))
    }
    const navCatalog = document.getElementById('bottomNav')
    if (navCatalog && navCatalog.firstElementChild) {
        navCatalog.firstElementChild.classList.add('active')
    }
}

function init() {
    if (initialized) return
    initialized = true
    try {
        applyTheme()
        resetFilterState()
        loadSettings()
        loadProducts()
        updateCartCount()
        initBanner()
        setupEventListeners()
        checkOrderTime()
        setInterval(checkOrderTime, 60000)
        checkCookieConsent()
        setupOfflineListener()
        window.addEventListener('resize', invalidateScanCropCache)
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                if (scanRafId) {
                    cancelAnimationFrame(scanRafId)
                    scanRafId = null
                }
                if (barcodeStream || scannerWorker) {
                    closeBarcodeScanner()
                }
            }
        })
    } catch (error) {
        const msg = error && error.message ? error.message : String(error)
        console.error('Init error:', error)
        showError('Ошибка инициализации приложения: ' + (msg || String(error)))
    }
}

function applyTheme() {
    if (darkMode) {
        document.documentElement.setAttribute('data-theme', 'dark')
    } else {
        document.documentElement.removeAttribute('data-theme')
    }
}

function setupEventListeners() {
    try {
        const logo = document.getElementById('logoLink')
        if (logo) {
            logo.addEventListener('click', (e) => {
                e.preventDefault()
                window.scrollTo({ top: 0, behavior: 'smooth' })
            })
        }

        const themeToggle = document.getElementById('themeToggle')
        if (themeToggle) themeToggle.addEventListener('click', toggleTheme)

        const privacyToggle = document.getElementById('privacyToggle')
        if (privacyToggle) privacyToggle.addEventListener('click', openPrivacyModal)

        const cookieAccept = document.getElementById('cookieAccept')
        if (cookieAccept) cookieAccept.addEventListener('click', acceptCookies)

        const welcomeModalClose = document.getElementById('welcomeModalClose')
        if (welcomeModalClose) welcomeModalClose.addEventListener('click', hideWelcomeModal)

        const welcomeStartBtn = document.getElementById('welcomeStartBtn')
        if (welcomeStartBtn) welcomeStartBtn.addEventListener('click', hideWelcomeModal)

        const privacyModalClose = document.getElementById('privacyModalClose')
        if (privacyModalClose) privacyModalClose.addEventListener('click', closePrivacyModal)

        const privacyModalCloseBtn = document.getElementById('privacyModalCloseBtn')
        if (privacyModalCloseBtn) privacyModalCloseBtn.addEventListener('click', closePrivacyModal)

        const welcomeBackdrop = document.querySelector('.welcome-modal-backdrop')
        if (welcomeBackdrop) welcomeBackdrop.addEventListener('click', hideWelcomeModal)

        const privacyBackdrop = document.querySelector('.privacy-modal-backdrop')
        if (privacyBackdrop) privacyBackdrop.addEventListener('click', closePrivacyModal)

        const searchInput = document.getElementById('searchInput')
        if (searchInput) searchInput.addEventListener('input', debounce(handleSearch, 300))

        const searchClear = document.getElementById('searchClear')
        if (searchClear) searchClear.addEventListener('click', clearSearch)

        const barcodeToggle = document.getElementById('barcodeToggle')
        if (barcodeToggle) barcodeToggle.addEventListener('click', toggleBarcodeScanner)

        const filterToggle = document.getElementById('filterToggle')
        if (filterToggle) filterToggle.addEventListener('click', openFilters)

        const closeScannerX = document.getElementById('closeScannerX')
        if (closeScannerX) closeScannerX.addEventListener('click', closeBarcodeScanner)

        const flashToggle = document.getElementById('flashToggle')
        if (flashToggle) flashToggle.addEventListener('click', toggleFlash)

        const zoomToggle = document.getElementById('zoomToggle')
        if (zoomToggle) zoomToggle.addEventListener('click', toggleZoom)

        const scannerModeToggle = document.getElementById('scannerModeToggle')
        if (scannerModeToggle) scannerModeToggle.addEventListener('click', toggleScannerMode)

        const manualBarcodeInput = document.getElementById('manualBarcodeInput')
        if (manualBarcodeInput) {
            manualBarcodeInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') handleManualBarcode()
            })
        }

        const manualBarcodeSubmit = document.getElementById('manualBarcodeSubmit')
        if (manualBarcodeSubmit) manualBarcodeSubmit.addEventListener('click', handleManualBarcode)

        const checkoutBtn = document.getElementById('checkoutBtn')
        if (checkoutBtn) checkoutBtn.addEventListener('click', checkout)

        const loadMoreBtn = document.getElementById('loadMoreBtn')
        if (loadMoreBtn) loadMoreBtn.addEventListener('click', loadMoreProducts)

        const applyFiltersBtn = document.getElementById('applyFilters')
        if (applyFiltersBtn) {
            applyFiltersBtn.addEventListener('click', () => {
                applyFilters()
                closeFilters()
            })
        }

        const resetFiltersBtn = document.getElementById('resetFilters')
        if (resetFiltersBtn) resetFiltersBtn.addEventListener('click', resetFilters)

        const filterSidebarClose = document.getElementById('filterSidebarClose')
        if (filterSidebarClose) filterSidebarClose.addEventListener('click', closeFilters)

        const filterSidebarOverlay = document.getElementById('filterSidebarOverlay')
        if (filterSidebarOverlay) filterSidebarOverlay.addEventListener('click', closeFilters)

        const categoryFilter = document.getElementById('categoryFilter')
        if (categoryFilter) categoryFilter.addEventListener('change', applyFilters)

        const brandFilter = document.getElementById('brandFilter')
        if (brandFilter) brandFilter.addEventListener('change', applyFilters)

        const priceFrom = document.getElementById('priceFrom')
        if (priceFrom) priceFrom.addEventListener('input', debounce(applyFilters, 500))

        const priceTo = document.getElementById('priceTo')
        if (priceTo) priceTo.addEventListener('input', debounce(applyFilters, 500))

        const sortFilter = document.getElementById('sortFilter')
        if (sortFilter) sortFilter.addEventListener('change', applyFilters)

        const bottomNav = document.getElementById('bottomNav')
        if (bottomNav) {
            const navItems = bottomNav.querySelectorAll('.bottom-nav-item')
            navItems.forEach(item => {
                item.addEventListener('click', (e) => {
                    e.preventDefault()
                    const nav = item.dataset.nav
                    navItems.forEach(n => n.classList.remove('active'))
                    item.classList.add('active')
                    switchSection(nav)
                })
            })
        }

        const modalClose = document.querySelector('#productModal .modal-close')
        if (modalClose) modalClose.addEventListener('click', closeModal)

        const productModal = document.getElementById('productModal')
        if (productModal) {
            productModal.addEventListener('click', (e) => {
                if (e.target === e.currentTarget) closeModal()
            })
        }

        const cartDrawerClose = document.getElementById('cartDrawerClose')
        if (cartDrawerClose) cartDrawerClose.addEventListener('click', closeCart)

        const cartDrawerOverlay = document.getElementById('cartDrawerOverlay')
        if (cartDrawerOverlay) cartDrawerOverlay.addEventListener('click', closeCart)

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                const drawer = document.getElementById('cartDrawer')
                if (drawer && drawer.classList.contains('open')) closeCart()
                const filters = document.getElementById('filterSidebar')
                if (filters && filters.classList.contains('open')) closeFilters()
                const scanner = document.getElementById('barcodeScanner')
                if (scanner && !scanner.classList.contains('hidden')) closeBarcodeScanner()
                const welcome = document.getElementById('welcomeModal')
                if (welcome && !welcome.classList.contains('hidden')) hideWelcomeModal()
                const privacy = document.getElementById('privacyModal')
                if (privacy && !privacy.classList.contains('hidden')) closePrivacyModal()
            }
        })

        const cartItemsEl = document.getElementById('cartItems')
        if (cartItemsEl) {
            cartItemsEl.addEventListener('click', (e) => {
                const plusBtn = e.target.closest('.cart-plus')
                if (plusBtn) {
                    addToCart(plusBtn.dataset.id, 1)
                    return
                }
                const minusBtn = e.target.closest('.cart-minus')
                if (minusBtn) {
                    addToCart(minusBtn.dataset.id, -1)
                    return
                }
                const removeBtn = e.target.closest('.cart-item-remove')
                if (removeBtn) {
                    const productId = removeBtn.dataset.id
                    cart = cart.filter(c => c.id !== productId)
                    saveCart()
                    updateCartCount()
                    renderCart()
                    updateProductCardCart(productId)
                }
            })
        }

        const catalog = document.getElementById('catalog')
        if (catalog) {
            catalog.addEventListener('click', (e) => {
                const addBtn = e.target.closest('.add-to-cart')
                if (addBtn) {
                    addToCart(addBtn.dataset.id, 1)
                    return
                }
                const plusBtn = e.target.closest('.cart-plus')
                if (plusBtn) {
                    addToCart(plusBtn.dataset.id, 1)
                    return
                }
                const minusBtn = e.target.closest('.cart-minus')
                if (minusBtn) {
                    addToCart(minusBtn.dataset.id, -1)
                    return
                }
                const cartRemoveBtn = e.target.closest('.cart-item-remove')
                if (cartRemoveBtn) {
                    const productId = cartRemoveBtn.dataset.id
                    cart = cart.filter(c => c.id !== productId)
                    saveCart()
                    updateCartCount()
                    const drawer = document.getElementById('cartDrawer')
                    if (drawer && drawer.classList.contains('open')) {
                        renderCart()
                    }
                    updateProductCardCart(productId)
                    return
                }
                const favBtn = e.target.closest('.favorite-btn')
                if (favBtn) {
                    toggleFavorite(favBtn.dataset.id)
                    return
                }
                const card = e.target.closest('.product-card')
                if (card) {
                    openProductModal(card.dataset.id)
                }
            })
        }
    } catch (error) {
        console.error('setupEventListeners error:', error)
    }
}

function openFilters() {
    const sidebar = document.getElementById('filterSidebar')
    const overlay = document.getElementById('filterSidebarOverlay')
    if (!sidebar || !overlay) return
    sidebar.classList.add('open')
    overlay.classList.add('open')
}

function closeFilters() {
    const sidebar = document.getElementById('filterSidebar')
    const overlay = document.getElementById('filterSidebarOverlay')
    if (!sidebar || !overlay) return
    sidebar.classList.remove('open')
    overlay.classList.remove('open')
}


function toggleTheme() {
    darkMode = !darkMode
    localStorage.setItem('jock-theme', darkMode ? 'dark' : 'light')
    applyTheme()
}

function toggleSearch() {
    const searchBar = document.getElementById('searchBar')
    if (!searchBar) return
    searchBar.classList.toggle('hidden')
    if (!searchBar.classList.contains('hidden')) {
        const searchInput = document.getElementById('searchInput')
        if (searchInput) searchInput.focus()
    }
}

function handleSearch(e) {
    applyFilters()
}

function clearSearch() {
    const searchInput = document.getElementById('searchInput')
    if (searchInput) searchInput.value = ''
    applyFilters()
    const searchBar = document.getElementById('searchBar')
    if (searchBar && !searchBar.classList.contains('hidden')) {
        toggleSearch()
    }
}

async function loadSettings() {
    try {
        const response = await fetchWithTimeout(`${CONFIG.supabaseUrl}/rest/v1/settings?select=key,value`, {
            headers: {
                'apikey': CONFIG.supabaseAnonKey,
                'Authorization': `Bearer ${CONFIG.supabaseAnonKey}`
            }
        })
        if (response.ok) {
            const settingsRaw = await response.json()
            const settings = {}
            for (const s of settingsRaw) {
                settings[s.key] = s.value
            }
            window.__storeSettings = settings

            if (settings.logo_text) {
                const logo = document.getElementById('logoLink')
                if (logo) logo.textContent = settings.logo_text
            }

            checkOrderTime()
        }
    } catch (error) {
        console.error('Error loading settings:', error)
    }
}

async function loadProducts(reset = true) {
    if (reset) {
        productsPage = 1
        hasMoreProducts = true
        showLoading(true)
    }
    
    try {
        const now = Date.now()
        let products = []
        
        if (apiCache.products.data && now - apiCache.products.ts < apiCache.products.ttl) {
            products = apiCache.products.data
        } else {
            let lastError = null
            for (let attempt = 0; attempt < 3; attempt++) {
                try {
                    const response = await fetchWithTimeout(`${CONFIG.supabaseUrl}/rest/v1/products?is_visible=eq.true&select=*,categories(name),brands(name),product_images(*)&order=created_at.desc&limit=1000`, {
                        headers: {
                            'apikey': CONFIG.supabaseAnonKey,
                            'Authorization': `Bearer ${CONFIG.supabaseAnonKey}`
                        }
                    })
                    if (!response.ok) throw new Error('Failed to load products: ' + response.status)
                    products = await response.json()
                    if (!products || !Array.isArray(products)) products = []
                    apiCache.products = { data: products, ts: Date.now(), ttl: 30000 }
                    break
                } catch (e) {
                    lastError = e
                    console.error(`Products fetch attempt ${attempt + 1} failed:`, e)
                    if (attempt < 2) await new Promise(r => setTimeout(r, 1000))
                }
            }
            if (!products || products.length === 0) {
                throw lastError || new Error('No products received')
            }
        }
        
        productsTotal = products.length
        allProducts = products
        
        // Load related products (cached)
        if (!apiCache.related.data || now - apiCache.related.ts >= apiCache.related.ttl) {
            try {
                const relatedRes = await fetchWithTimeout(`${CONFIG.supabaseUrl}/rest/v1/product_related?select=product_id,related_id`, {
                    headers: {
                        'apikey': CONFIG.supabaseAnonKey,
                        'Authorization': `Bearer ${CONFIG.supabaseAnonKey}`
                    }
                })
                if (relatedRes.ok) {
                    apiCache.related = { data: await relatedRes.json(), ts: now, ttl: 60000 }
                }
            } catch (e) {
                console.error('Error loading related products:', e)
            }
        }
        relatedMap = apiCache.related.data || []
        
        // Load categories and brands for filters (cached)
        try {
            await loadFilters()
        } catch (e) {
            console.error('Error loading filters:', e)
        }
        
        if (reset) {
            filteredProducts = allProducts
            productsTotal = allProducts.length
            productsPage = 1
            hasMoreProducts = productsTotal > PRODUCTS_PER_PAGE
            favoritesOnly = false
            const navFav = document.getElementById('navFavorites')
            if (navFav) navFav.classList.remove('active')
            renderProducts(allProducts.slice(0, PRODUCTS_PER_PAGE))
            updatePagination()
            initBanner()
        }
    } catch (error) {
        showError(error && error.message ? error.message : String(error))
        console.error(error)
        const catalog = document.getElementById('catalog')
        if (catalog) {
            catalog.innerHTML = `
                <div class="loading">
                    <p style="margin-bottom: 12px;">Не удалось загрузить товары.</p>
                    <button onclick="loadProducts()" class="btn btn-primary" style="padding: 8px 20px; font-size: 14px;">
                        Попробовать снова
                    </button>
                </div>
            `
        }
    } finally {
        if (reset) {
            showLoading(false)
            const catalog = document.getElementById('catalog')
            if (catalog && catalog.classList.contains('skeleton-mode')) {
                catalog.classList.remove('skeleton-mode')
            }
        }
        isLoadingMore = false
    }
}

function updatePagination() {
    const container = document.getElementById('loadMoreContainer')
    if (!container) return
    hasMoreProducts = productsPage * PRODUCTS_PER_PAGE < productsTotal
    container.classList.toggle('hidden', !hasMoreProducts)
}

function loadMoreProducts() {
    if (isLoadingMore || !hasMoreProducts) return
    isLoadingMore = true
    productsPage++
    const start = (productsPage - 1) * PRODUCTS_PER_PAGE
    const end = start + PRODUCTS_PER_PAGE
    appendProducts(filteredProducts.slice(start, end))
    updatePagination()
}

async function loadFilters() {
    try {
        const categoriesRes = await fetchWithTimeout(`${CONFIG.supabaseUrl}/rest/v1/categories?select=*`, {
            headers: { 'apikey': CONFIG.supabaseAnonKey, 'Authorization': `Bearer ${CONFIG.supabaseAnonKey}` }
        })
        if (!categoriesRes.ok) {
            const text = await categoriesRes.text()
            throw new Error(text || 'Ошибка загрузки категорий')
        }

        const brandsRes = await fetchWithTimeout(`${CONFIG.supabaseUrl}/rest/v1/brands?select=*`, {
            headers: { 'apikey': CONFIG.supabaseAnonKey, 'Authorization': `Bearer ${CONFIG.supabaseAnonKey}` }
        })
        if (!brandsRes.ok) {
            const text = await brandsRes.text()
            throw new Error(text || 'Ошибка загрузки брендов')
        }

        const categories = await categoriesRes.json()
        const brands = await brandsRes.json()

        const categorySelect = document.getElementById('categoryFilter')
        if (categorySelect) {
            categorySelect.innerHTML = '<option value="">Все</option>' +
                categories.map(c => `<option value="${escapeHtml(String(c.id))}">${escapeHtml(c.name)}</option>`).join('')
        }

        const brandSelect = document.getElementById('brandFilter')
        if (brandSelect) {
            brandSelect.innerHTML = '<option value="">Все</option>' +
                brands.map(b => `<option value="${escapeHtml(String(b.id))}">${escapeHtml(b.name)}</option>`).join('')
        }
    } catch (error) {
        console.error('Error loading filters:', error)
        showError('Ошибка загрузки фильтров: ' + (error && error.message ? error.message : String(error)))
    }
}

function filterAndRenderProducts(filters = {}) {
    let filtered = [...allProducts]

    if (filters.search) {
        const query = filters.search.toLowerCase()
        filtered = filtered.filter(p => 
            p.name.toLowerCase().includes(query) ||
            (p.brands?.name?.toLowerCase() || '').includes(query)
        )
    }

    if (filters.category) {
        filtered = filtered.filter(p => p.category_id === filters.category)
    }

     if (filters.brand) {
         filtered = filtered.filter(p => p.brand_id === filters.brand)
     }

     if (filters.favoritesOnly) {
         filtered = filtered.filter(p => favorites.includes(p.id))
     }

    if (filters.priceFrom) {
        filtered = filtered.filter(p => p.price >= parseInt(filters.priceFrom, 10))
    }

    if (filters.priceTo) {
        filtered = filtered.filter(p => p.price <= parseInt(filters.priceTo, 10))
    }

    if (filters.sort === 'price-asc') {
        filtered.sort((a, b) => a.price - b.price)
    } else if (filters.sort === 'price-desc') {
        filtered.sort((a, b) => b.price - a.price)
    } else if (filters.sort === 'name') {
        filtered.sort((a, b) => a.name.localeCompare(b.name))
    } else {
        filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    }

    productsTotal = filtered.length
    filteredProducts = filtered
    productsPage = 1
    hasMoreProducts = productsTotal > PRODUCTS_PER_PAGE
    renderProducts(filtered.slice(0, PRODUCTS_PER_PAGE))
    updatePagination()
    initBanner()
}

function applyFilters() {
    const searchInput = document.getElementById('searchInput')
    const categoryFilter = document.getElementById('categoryFilter')
    const brandFilter = document.getElementById('brandFilter')
    const priceFrom = document.getElementById('priceFrom')
    const priceTo = document.getElementById('priceTo')
    const sortFilter = document.getElementById('sortFilter')
    const filters = {
        search: searchInput ? searchInput.value : '',
        category: categoryFilter ? categoryFilter.value : '',
        brand: brandFilter ? brandFilter.value : '',
        priceFrom: priceFrom ? priceFrom.value : '',
        priceTo: priceTo ? priceTo.value : '',
        sort: sortFilter ? sortFilter.value : 'newest',
        favoritesOnly: favoritesOnly
    }
    filterAndRenderProducts(filters)
    updateBannerVisibility()
}

function resetFilters() {
    const categoryFilter = document.getElementById('categoryFilter')
    const brandFilter = document.getElementById('brandFilter')
    const priceFrom = document.getElementById('priceFrom')
    const priceTo = document.getElementById('priceTo')
    const sortFilter = document.getElementById('sortFilter')
    const searchInput = document.getElementById('searchInput')
    if (categoryFilter) categoryFilter.value = ''
    if (brandFilter) brandFilter.value = ''
    if (priceFrom) priceFrom.value = ''
    if (priceTo) priceTo.value = ''
    if (sortFilter) sortFilter.value = 'newest'
    if (searchInput) searchInput.value = ''
    if (favoritesOnly) {
        favoritesOnly = false
        const navFav = document.getElementById('navFavorites')
        if (navFav) navFav.classList.remove('active')
    }
    applyFilters()
}

function isStockAvailable() {
    const settings = window.__storeSettings || {}
    return settings.stock_availability_enabled !== 'false'
}

function renderProducts(products) {
    const catalog = document.getElementById('catalog')
    if (!catalog) return
    if (products.length === 0) {
        catalog.innerHTML = '<div class="loading">Товары не найдены</div>'
        return
    }
    catalog.innerHTML = products.map(product => createProductCard(product)).join('')
    initProductSliders()
}

function appendProducts(products) {
    const catalog = document.getElementById('catalog')
    if (!catalog) return
    const html = products.map(product => createProductCard(product)).join('')
    catalog.insertAdjacentHTML('beforeend', html)
    initProductSliders()
}

const initializedSliderTracks = new WeakSet()

function initProductSliders() {
    const tracks = document.querySelectorAll('.slider-track')
    if (!tracks.length) return

    tracks.forEach(track => {
        if (initializedSliderTracks.has(track)) return
        initializedSliderTracks.add(track)

        const count = parseInt(track.dataset.count || '1', 10)
        if (count <= 1) {
            track.style.overflowX = 'hidden'
            return
        }

        const wrap = track.closest('.product-image-wrap')
        if (!wrap) return
        const dots = wrap.querySelectorAll('.slider-dot')
        if (!dots.length) return

        const updateDots = () => {
            const scrollLeft = track.scrollLeft
            const width = track.clientWidth
            if (width === 0) return
            const index = Math.round(scrollLeft / width)
            dots.forEach((dot, i) => {
                dot.classList.toggle('active', i === index)
            })
        }

        track.addEventListener('scroll', updateDots, { passive: true })

        dots.forEach(dot => {
            dot.addEventListener('click', (e) => {
                e.stopPropagation()
                const index = parseInt(dot.dataset.index, 10)
                const width = track.clientWidth
                if (width > 0) {
                    track.scrollTo({ left: width * index, behavior: 'smooth' })
                }
            })
        })
    })
}

function createProductCard(product) {
    const images = (product.product_images || []).slice().sort((a, b) => {
        if (a.is_main && !b.is_main) return -1
        if (!a.is_main && b.is_main) return 1
        return 0
    })
    const fallbackImg = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect fill="%23f0f0f0" width="200" height="200"/><text fill="%23999" font-family="sans-serif" font-size="14" x="50%" y="50%" text-anchor="middle" dy=".3em">Нет фото</text></svg>'

    const cartItem = cart.find(c => c.id === product.id)
    const inCart = cartItem ? cartItem.quantity : 0
    const favorited = isFavorited(product.id)
    const displayName = cleanProductName(product.name, product.brands?.name)

    const badges = []
    if (product.is_hit) badges.push(`<span class="badge-text badge-hit">HIT</span>`)
    if (product.is_new) badges.push(`<span class="badge-text badge-new">NEW</span>`)
    if (product.is_discount) badges.push(`<span class="badge-text badge-discount">SALE</span>`)

    const discountPercent = product.old_price && product.price < product.old_price
        ? Math.round((1 - product.price / product.old_price) * 100)
        : 0

    const imagesHtml = images.map(img =>
        `<img src="${escapeHtml(img.url || fallbackImg)}" alt="${escapeHtml(product.name)}" class="slider-img" loading="lazy" decoding="async" width="400" height="533">`
    ).join('')

    const trackCount = Math.max(images.length, 1)
    const dotsHtml = trackCount > 1 ? `
        <div class="slider-dots" data-count="${trackCount}">
            ${Array.from({ length: trackCount }, (_, i) => `<button class="slider-dot${i === 0 ? ' active' : ''}" data-index="${i}" aria-label="Фото ${i + 1}"></button>`).join('')}
        </div>
    ` : ''

    return `
        <div class="product-card" data-id="${escapeHtml(String(product.id))}">
            <div class="product-image-wrap">
                <div class="slider-track" data-count="${trackCount}">
                    ${imagesHtml || `<img src="${fallbackImg}" alt="Нет фото" class="slider-img" width="400" height="533">`}
                </div>
                ${dotsHtml}
                ${badges.length > 0 ? `<div class="product-badges-overlay">${badges.join('')}</div>` : ''}
                <button class="favorite-btn ${favorited ? 'active' : ''}" data-id="${escapeHtml(String(product.id))}" aria-label="В избранное">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">
                        <path d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z"></path>
                    </svg>
                </button>
            </div>
            <div class="product-info">
                <div class="product-brand">${escapeHtml(product.brands?.name || 'JOCK NUTRITION')}</div>
                <div class="product-name">${escapeHtml(displayName)}</div>
                <div class="product-volume">${escapeHtml(product.volume || '')}</div>
                <div class="product-price-block">
                    <span class="product-price">${product.price} ₽</span>
                    ${product.old_price ? `<span class="product-old-price">${product.old_price} ₽</span>` : ''}
                    ${discountPercent > 0 ? `<span class="product-discount">-${discountPercent}%</span>` : ''}
                </div>
                <div class="product-stock ${isStockAvailable() && product.stock > 0 ? 'in-stock' : 'out-of-stock'}">
                    ${isStockAvailable() && product.stock > 0 ? 'В наличии' : 'Нет в наличии'}
                </div>
                <div class="product-footer">
                    ${inCart === 0 ? `
                        <button class="add-to-cart btn-block" data-id="${escapeHtml(String(product.id))}">В корзину</button>
                    ` : `
                        <div class="cart-controls active">
                            <button class="cart-minus" data-id="${escapeHtml(String(product.id))}">-</button>
                            <span class="cart-qty">${inCart}</span>
                            <button class="cart-plus" data-id="${escapeHtml(String(product.id))}">+</button>
                            <button class="cart-item-remove" data-id="${escapeHtml(String(product.id))}">&times;</button>
                        </div>
                    `}
                </div>
            </div>
        </div>
    `
}


function openProductModal(productId) {
    const product = allProducts.find(p => p.id === productId)
    if (!product) return

    const images = product.product_images || []
    const mainImage = images.find(img => img.is_main) || images[0]
    const imageUrl = mainImage?.url || ''
    let currentImageIndex = images.findIndex(img => img.url === imageUrl)
    if (currentImageIndex < 0) currentImageIndex = 0

    const modalBody = document.getElementById('modalBody')
    const favorited = isFavorited(productId)
    const discountPercent = product.old_price && product.price < product.old_price
        ? Math.round((1 - product.price / product.old_price) * 100)
        : 0
    modalBody.innerHTML = `
        ${(() => {
            return `
                <div class="modal-image-wrap">
                    <div class="modal-slider-track" data-count="${images.length}">
                        ${images.map((img, idx) => `<img class="modal-slider-img" src="${escapeHtml(img.url)}" alt="${escapeHtml(product.name)}" loading="lazy" decoding="async" width="800" height="1067">`).join('')}
                    </div>
                    <div class="modal-slider-dots" data-count="${images.length}">
                        ${images.map((_, idx) => `<button class="modal-slider-dot${idx === currentImageIndex ? ' active' : ''}" data-index="${idx}" aria-label="Фото ${idx + 1}"></button>`).join('')}
                    </div>
                </div>
            `
        })()}
        <div class="modal-brand">${escapeHtml(product.brands?.name || 'JOCK NUTRITION')}</div>
        <h2>${escapeHtml(cleanProductName(product.name, product.brands?.name))}</h2>
        <div class="modal-volume">${escapeHtml(product.volume || '')}</div>
        <div class="modal-badges">
            ${product.is_hit ? '<span class="badge-text badge-hit">HIT</span>' : ''}
            ${product.is_new ? '<span class="badge-text badge-new">NEW</span>' : ''}
            ${product.is_discount ? '<span class="badge-text badge-discount">SALE</span>' : ''}
        </div>
        <div class="modal-price-block">
            <span class="product-price">${product.price} ₽</span>
            ${product.old_price ? `<span class="product-old-price">${product.old_price} ₽</span>` : ''}
            ${discountPercent > 0 ? `<span class="product-discount">-${discountPercent}%</span>` : ''}
        </div>
        <div class="modal-stock ${isStockAvailable() && product.stock > 0 ? 'in-stock' : 'out-of-stock'}">
            ${isStockAvailable() && product.stock > 0 ? 'В наличии' : 'Нет в наличии'}
        </div>
        
        ${product.full_description ? `
            <div class="modal-section">
                <h3>Описание</h3>
                <p>${escapeHtml(product.full_description)}</p>
            </div>
        ` : ''}
        
        ${product.composition ? `
            <div class="modal-section">
                <h3>Состав</h3>
                <p>${escapeHtml(product.composition)}</p>
            </div>
        ` : ''}
        
        ${product.usage ? `
            <div class="modal-section">
                <h3>Способ применения</h3>
                <p>${escapeHtml(product.usage)}</p>
            </div>
        ` : ''}
        
        ${product.contraindications ? `
            <div class="modal-section">
                <h3>Противопоказания</h3>
                <p>${escapeHtml(product.contraindications)}</p>
            </div>
        ` : ''}
        
        ${product.shelf_life ? `
            <div class="modal-section">
                <h3>Срок годности</h3>
                <p>${escapeHtml(product.shelf_life)}</p>
            </div>
        ` : ''}

        ${(() => {
            const explicitIds = (relatedMap || [])
                .filter(rel => rel.product_id === product.id)
                .map(rel => rel.related_id)

            let relatedIds = explicitIds
            if (relatedIds.length === 0 && product.is_related_enabled) {
                relatedIds = allProducts
                    .filter(p => p.id !== product.id &&
                        (p.category_id === product.category_id || p.brand_id === product.brand_id))
                    .map(p => p.id)
            }

            const related = relatedIds
                .map(id => allProducts.find(p => p.id === id))
                .filter(Boolean)
                .slice(0, 4)

            if (!related.length) return ''
            return `
                <div class="modal-related">
                    <h3>Связанные товары</h3>
                    <div class="related-grid">
                        ${related.map(r => {
                            const rImg = r.product_images?.find(i => i.is_main) || r.product_images?.[0]
                            const rUrl = rImg?.url || ''
                            return `
                                <button class="related-card" data-id="${escapeHtml(String(r.id))}">
                                    ${rUrl ? `<img src="${escapeHtml(rUrl)}" alt="${escapeHtml(r.name)}" loading="lazy" decoding="async" width="400" height="533">` : ''}
                                    <div class="related-name">${escapeHtml(r.name)}</div>
                                    <div class="related-price">${r.price} ₽</div>
                                </button>
                            `
                        }).join('')}
                    </div>
                </div>
            `
        })()}

        <button class="btn btn-primary btn-block add-to-cart-modal" data-id="${escapeHtml(String(product.id))}">
            В корзину
        </button>
    `

    const addToCartBtn = modalBody.querySelector('.add-to-cart-modal')
    if (addToCartBtn) {
        addToCartBtn.onclick = () => {
            addToCart(product.id, 1)
            closeModal()
        }
    }

    modalBody.querySelectorAll('.related-card').forEach(card => {
        card.addEventListener('click', () => {
            openProductModal(card.dataset.id)
        })
    })

    const track = modalBody.querySelector('.modal-slider-track')
    const dots = modalBody.querySelectorAll('.modal-slider-dot')

    if (!track) return

    const count = parseInt(track.dataset.count || '1', 10)
    if (count <= 1) {
        track.style.overflowX = 'hidden'
        return
    }

    if (!dots.length) return

    const updateDots = () => {
        const scrollLeft = track.scrollLeft
        const width = track.clientWidth
        if (width === 0) return
        const index = Math.round(scrollLeft / width)
        dots.forEach((dot, i) => {
            dot.classList.toggle('active', i === index)
        })
    }

    track.addEventListener('scroll', updateDots, { passive: true })

    dots.forEach(dot => {
        dot.addEventListener('click', (e) => {
            e.stopPropagation()
            const index = parseInt(dot.dataset.index, 10)
            const width = track.clientWidth
            if (width > 0) {
                track.scrollTo({ left: width * index, behavior: 'smooth' })
            }
        })
    })

    const productModal = document.getElementById('productModal')
    if (productModal) productModal.classList.remove('hidden')
}

function closeModal() {
    const productModal = document.getElementById('productModal')
    if (productModal) productModal.classList.add('hidden')
}

function closeAllModals() {
    const ids = [
        'productModal',
        'barcodeScanner',
        'privacyModal',
        'welcomeModal',
        'a2hsModal',
        'a2hsBanner',
        'updateBanner',
        'cookieBanner',
    ]
    ids.forEach(id => {
        const el = document.getElementById(id)
        if (el) el.classList.add('hidden')
    })
    const drawerIds = ['cartDrawer', 'filterSidebar']
    drawerIds.forEach(id => {
        const el = document.getElementById(id)
        if (el) el.classList.remove('open')
    })
    const overlayIds = ['cartDrawerOverlay', 'filterSidebarOverlay']
    overlayIds.forEach(id => {
        const el = document.getElementById(id)
        if (el) el.classList.remove('open')
    })
    const scannerManual = document.getElementById('scannerManual')
    if (scannerManual) scannerManual.classList.add('hidden')
    closeBarcodeScanner()
}

function switchSection(nav) {
    closeAllModals()

    if (nav === 'catalog') {
        if (favoritesOnly) {
            favoritesOnly = false
            const navFav = document.getElementById('navFavorites')
            if (navFav) navFav.classList.remove('active')
            applyFilters()
        }
        window.scrollTo({ top: 0, behavior: 'smooth' })
    } else if (nav === 'search') {
        toggleSearch()
    } else if (nav === 'cart') {
        openCart()
    } else if (nav === 'favorites') {
        toggleFavoritesView()
    }
}

function addToCart(productId, quantity) {
    const existing = cart.find(c => c.id === productId)
    if (existing) {
        existing.quantity += quantity
        if (existing.quantity <= 0) {
            cart = cart.filter(c => c.id !== productId)
        }
    } else if (quantity > 0) {
        cart.push({ id: productId, quantity })
    }

    saveCart()
    updateCartCount()
    updateProductCardCart(productId)
    const drawer = document.getElementById('cartDrawer')
    if (drawer && drawer.classList.contains('open')) {
        renderCart()
    }
}

function updateProductCardCart(productId) {
    const card = document.querySelector(`.product-card[data-id="${productId}"]`)
    if (!card) return

    const cartItem = cart.find(c => c.id === productId)
    const inCart = cartItem ? cartItem.quantity : 0
    const product = allProducts.find(p => p.id === productId)
    const footer = card.querySelector('.product-footer')
    if (!footer) return

    const discountPercent = product?.old_price && product.price < product.old_price
        ? Math.round((1 - product.price / product.old_price) * 100)
        : 0

    footer.innerHTML = `
        ${inCart === 0 ? `
            <button class="add-to-cart btn-block" data-id="${productId}">В корзину</button>
        ` : `
            <div class="cart-controls active">
                <button class="cart-minus" data-id="${productId}">-</button>
                <span class="cart-qty">${inCart}</span>
                <button class="cart-plus" data-id="${productId}">+</button>
                <button class="cart-item-remove" data-id="${productId}">&times;</button>
            </div>
        `}
    `

    const priceBlock = card.querySelector('.product-price-block')
    const stockEl = card.querySelector('.product-stock')
    if (priceBlock && product) {
        priceBlock.innerHTML = `
            <span class="product-price">${product.price || 0} ₽</span>
            ${product.old_price ? `<span class="product-old-price">${product.old_price} ₽</span>` : ''}
            ${discountPercent > 0 ? `<span class="product-discount">-${discountPercent}%</span>` : ''}
        `
    }
    if (stockEl && product) {
        stockEl.className = `product-stock ${isStockAvailable() && product.stock > 0 ? 'in-stock' : 'out-of-stock'}`
        stockEl.textContent = isStockAvailable() && product.stock > 0 ? 'В наличии' : 'Нет в наличии'
    }
}

function saveCart() {
    localStorage.setItem('jock-cart', JSON.stringify(cart))
}

function updateCartCount() {
    const count = cart.reduce((sum, c) => sum + c.quantity, 0)
    const badge = document.getElementById('bottomCartCount')
    if (badge) {
        if (count > 0) {
            badge.textContent = count > 99 ? '99+' : count
            badge.classList.remove('hidden')
        } else {
            badge.classList.add('hidden')
        }
    }
}

function saveFavorites() {
    localStorage.setItem('jock-favorites', JSON.stringify(favorites))
}

function isFavorited(productId) {
    return favorites.includes(productId)
}

function toggleFavorite(productId) {
    if (isFavorited(productId)) {
        favorites = favorites.filter(id => id !== productId)
    } else {
        favorites.push(productId)
    }
    saveFavorites()
    document.querySelectorAll(`.favorite-btn[data-id="${productId}"]`).forEach(btn => {
        btn.classList.toggle('active', isFavorited(productId))
    })
    if (favoritesOnly) {
        applyFilters()
    }
}

function toggleFavoritesView() {
    favoritesOnly = !favoritesOnly
    const navFav = document.getElementById('navFavorites')
    if (navFav) navFav.classList.toggle('active', favoritesOnly)
    updateBannerVisibility()
    applyFilters()
}

function openCart() {
    renderCart()
    const drawer = document.getElementById('cartDrawer')
    const overlay = document.getElementById('cartDrawerOverlay')
    if (drawer) drawer.classList.add('open')
    if (overlay) overlay.classList.add('open')
}

function closeCart() {
    const drawer = document.getElementById('cartDrawer')
    const overlay = document.getElementById('cartDrawerOverlay')
    if (drawer) drawer.classList.remove('open')
    if (overlay) overlay.classList.remove('open')
}

function renderCart() {
    const cartItems = document.getElementById('cartItems')
    const cartTotal = document.getElementById('cartTotal')
    const checkoutBtn = document.getElementById('checkoutBtn')
    if (!cartItems || !cartTotal || !checkoutBtn) return

    if (cart.length === 0) {
        cartItems.innerHTML = '<p style="text-align: center; color: var(--text-secondary); padding: 20px;">Корзина пуста</p>'
        cartTotal.textContent = '0 ₽'
        checkoutBtn.disabled = true
        return
    }

    checkoutBtn.disabled = false

    let total = 0
    cartItems.innerHTML = cart.map(cartItem => {
        const product = allProducts.find(p => p.id === cartItem.id)
        if (!product) return ''

        const itemTotal = product.price * cartItem.quantity
        total += itemTotal

        const cartImg = product.product_images?.[0]?.url || 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="160"><rect fill="%23f0f0f0" width="120" height="160"/><text fill="%23999" font-family="sans-serif" font-size="12" x="50%" y="50%" text-anchor="middle" dy=".3em">Нет фото</text></svg>')

        return `
            <div class="cart-item">
                <img src="${escapeHtml(cartImg)}" alt="${escapeHtml(product.name)}" class="cart-item-image" decoding="async" width="120" height="160">
                <div class="cart-item-info">
                    <div class="cart-item-name">${escapeHtml(cleanProductName(product.name, product.brands?.name))}</div>
                    <div class="cart-item-price">${product.price} ₽ × ${cartItem.quantity} = ${itemTotal} ₽</div>
                    <div class="cart-item-controls">
                        <button class="cart-minus" data-id="${escapeHtml(String(product.id))}">-</button>
                        <span>${cartItem.quantity}</span>
                        <button class="cart-plus" data-id="${escapeHtml(String(product.id))}">+</button>
                        <button class="cart-item-remove" data-id="${escapeHtml(String(product.id))}">&times;</button>
                    </div>
                </div>
            </div>
        `
    }).join('')

    cartTotal.textContent = `${total} ₽`
}

async function checkout() {
    if (cart.length === 0) {
        showError('Корзина пуста')
        return
    }

    const checkoutBtn = document.getElementById('checkoutBtn')
    if (checkoutBtn) {
        checkoutBtn.disabled = true
        checkoutBtn.textContent = 'Оформление...'
    }

    try {
        const response = await fetchWithTimeout(CONFIG.orderFunctionUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cart, whatsappAccountType: 'personal' })
        })

        const data = await response.json().catch(() => ({}))
        const orderTimeMessage = document.getElementById('orderTimeMessage')

        if (!response.ok) {
            if (data.time_restricted && orderTimeMessage) {
                orderTimeMessage.textContent = data.error
                orderTimeMessage.classList.remove('hidden')
                if (checkoutBtn) {
                    checkoutBtn.disabled = false
                    checkoutBtn.textContent = 'Оформить заказ'
                }
                return
            }
            throw new Error(data.error || 'Ошибка оформления заказа')
        }

        // Open WhatsApp
        if (data.whatsappUrl) {
            cart = []
            saveCart()
            updateCartCount()
            closeCart()
            applyFilters()
            const popup = window.open(data.whatsappUrl, '_blank', 'noopener,noreferrer')
            if (!popup) {
                location.href = data.whatsappUrl
            }
            return
        }

        // Clear cart
        cart = []
        saveCart()
        updateCartCount()
        closeCart()
        applyFilters()

    } catch (error) {
        showError(error.message)
    } finally {
        if (checkoutBtn) {
            checkoutBtn.disabled = false
            checkoutBtn.textContent = 'Оформить заказ'
        }
    }
}

async function checkOrderTime() {
    const timeMessage = document.getElementById('orderTimeMessage')
    const checkoutBtn = document.getElementById('checkoutBtn')
    
    if (!timeMessage || !checkoutBtn) return
    
    const settings = window.__storeSettings || {}
    const timeLimitEnabled = settings.order_time_limit_enabled === 'true'
    
    if (!timeLimitEnabled) {
        checkoutBtn.disabled = false
        timeMessage.classList.add('hidden')
        return
    }
    
    const startHour = parseInt(settings.order_start_hour || '9', 10)
    const endHour = parseInt(settings.order_end_hour || '20', 10)
    const timezone = settings.timezone || 'Europe/Moscow'
    
    const now = new Date()
    const formatter = new Intl.DateTimeFormat('ru-RU', {
        timeZone: timezone,
        hour: 'numeric',
        hour12: false,
    })
    const currentHour = parseInt(formatter.format(now), 10)
    
    if (currentHour < startHour || currentHour >= endHour) {
        checkoutBtn.disabled = true
        timeMessage.textContent = `Заказы принимаются с ${startHour}:00 до ${endHour}:00. Добавьте товары в корзину и оформите заказ в рабочее время.`
        timeMessage.classList.remove('hidden')
    } else {
        checkoutBtn.disabled = false
        timeMessage.classList.add('hidden')
    }
}

// Barcode Scanner
async function toggleBarcodeScanner() {
    const scanner = document.getElementById('barcodeScanner')
    const video = document.getElementById('scannerVideo')
    if (!scanner || !video) return

    if (scanner.classList.contains('hidden')) {
        scanner.classList.remove('hidden')
        scannerFlashOn = false
        scannerMode = 'camera'
        lastVideoTime = -1
        workerBusy = false
        const scannerManual = document.getElementById('scannerManual')
        const scannerModeToggle = document.getElementById('scannerModeToggle')
        if (scannerManual) scannerManual.classList.add('hidden')
        if (scannerModeToggle) {
            scannerModeToggle.textContent = '⌨️'
            scannerModeToggle.classList.remove('active')
        }
        
        try {
            if (!('BarcodeDetector' in window)) {
                console.warn('BarcodeDetector не поддерживается этим браузером')
                scannerMode = 'manual'
                if (scannerManual) scannerManual.classList.remove('hidden')
                if (scannerModeToggle) {
                    scannerModeToggle.textContent = '📷'
                    scannerModeToggle.classList.add('active')
                }
                const manualInput = document.getElementById('manualBarcodeInput')
                if (manualInput) manualInput.focus()
                return
            }

            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment', torch: false, width: { ideal: 640 }, height: { ideal: 480 }, powerEfficient: true }
            })
            video.srcObject = stream
            barcodeStream = stream

            await new Promise((resolve) => {
                if (video.readyState >= 1 && video.videoWidth > 0) return resolve()
                video.onloadedmetadata = () => resolve()
                setTimeout(resolve, 1500)
            })

            try { await video.play() } catch (e) { console.error('video.play error:', e) }

            await new Promise((resolve) => {
                if (video.videoWidth > 0) return resolve()
                const check = () => {
                    if (video.videoWidth > 0) resolve()
                    else requestAnimationFrame(check)
                }
                check()
            })

            scannerWorker = new Worker('./scanner-worker.js')
            scannerWorker.onmessage = onWorkerMessage
            scannerWorker.onerror = (err) => console.error('Scanner worker error:', err)

            try {
                scannerDetector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'code_128'] })
            } catch (err) {
                console.warn('BarcodeDetector init failed, falling back to manual')
                closeBarcodeScanner()
                scannerMode = 'manual'
                const scanner = document.getElementById('barcodeScanner')
                if (scanner && scanner.classList.contains('hidden')) scanner.classList.remove('hidden')
                const scannerManual = document.getElementById('scannerManual')
                if (scannerManual) scannerManual.classList.remove('hidden')
                const scannerModeToggle = document.getElementById('scannerModeToggle')
                if (scannerModeToggle) {
                    scannerModeToggle.textContent = '📷'
                    scannerModeToggle.classList.add('active')
                }
                const manualInput = document.getElementById('manualBarcodeInput')
                if (manualInput) manualInput.focus()
                return
            }

            invalidateScanCropCache()
            const crop = getScanCrop()
            if (crop) {
                scannerWorker.postMessage({ type: 'init', crop: crop, tw: 320 })
            }

            scanRafId = requestAnimationFrame(scanLoop)
        } catch (error) {
            console.error('Camera unavailable:', error)
            scannerMode = 'manual'
            if (scannerManual) scannerManual.classList.remove('hidden')
            if (scannerModeToggle) {
                scannerModeToggle.textContent = '📷'
                scannerModeToggle.classList.add('active')
            }
            const manualInput = document.getElementById('manualBarcodeInput')
            if (manualInput) manualInput.focus()
        }
    } else {
        closeBarcodeScanner()
    }
}

function invalidateScanCropCache() {
    scanCropCache = null
    scanCropVideoW = 0
    scanCropVideoH = 0
}

function getCachedScanCrop() {
    const video = document.getElementById('scannerVideo')
    if (!video || !video.videoWidth || !video.videoHeight) return null
    if (scanCropCache && scanCropVideoW === video.videoWidth && scanCropVideoH === video.videoHeight) {
        return scanCropCache
    }
    scanCropCache = getScanCrop()
    scanCropVideoW = video.videoWidth
    scanCropVideoH = video.videoHeight
    return scanCropCache
}

function getScanCrop() {
    const video = document.getElementById('scannerVideo')
    const frame = document.querySelector('.scanner-frame')
    if (!video || !frame) return null
    const vRect = video.getBoundingClientRect()
    const fRect = frame.getBoundingClientRect()
    const vw = video.videoWidth
    const vh = video.videoHeight
    if (!vw || !vh) return null

    const scale = Math.max(vRect.width / vw, vRect.height / vh)
    const dispW = vw * scale
    const dispH = vh * scale
    const offX = (vRect.width - dispW) / 2
    const offY = (vRect.height - dispH) / 2

    const fx = (fRect.left - vRect.left - offX) / scale
    const fy = (fRect.top - vRect.top - offY) / scale
    const fw = fRect.width / scale
    const fh = fRect.height / scale

    const pad = Math.min(fw, fh) * 0.08
    const x = Math.max(0, Math.floor(fx - pad))
    const y = Math.max(0, Math.floor(fy - pad))
    const w = Math.min(vw - x, Math.ceil(fw + pad * 2))
    const h = Math.min(vh - y, Math.ceil(fh + pad * 2))
    return { x, y, w, h }
}

function scanLoop(timestamp) {
    if (!barcodeStream || scannerMode !== 'camera') return
    if (!scannerWorker) return

    const video = document.getElementById('scannerVideo')
    if (!video) return

    if (timestamp - scanLastTime < SCAN_INTERVAL_MS) {
        scanRafId = requestAnimationFrame(scanLoop)
        return
    }

    if (video.readyState >= 2 && video.videoWidth > 0 && !workerBusy) {
        if (video.currentTime !== lastVideoTime) {
            lastVideoTime = video.currentTime
            workerBusy = true
            scanLastTime = timestamp
            try {
                const crop = getCachedScanCrop()
                if (crop && crop.w > 0 && crop.h > 0) {
                    createImageBitmap(video).then(bitmap => {
                        if (workerBusy || !scannerWorker) {
                            bitmap.close()
                            workerBusy = false
                        } else {
                            scannerWorker.postMessage({
                                type: 'scan',
                                bitmap: bitmap,
                                crop: crop,
                                tw: 320
                            }, [bitmap])
                        }
                    }).catch((err) => {
                        console.error('createImageBitmap error:', err)
                        workerBusy = false
                    })
                } else {
                    workerBusy = false
                }
            } catch (error) {
                console.error('Scan error:', error)
                workerBusy = false
            }
        } else {
            workerBusy = false
        }
    }

    scanRafId = requestAnimationFrame(scanLoop)
}

function onWorkerMessage(e) {
    const { type, error, bitmap } = e.data

    if (type === 'init_error') {
        console.warn('Worker init failed, falling back to manual mode')
        workerBusy = false
        closeBarcodeScanner()
        scannerMode = 'manual'
        const scanner = document.getElementById('barcodeScanner')
        if (scanner && scanner.classList.contains('hidden')) {
            scanner.classList.remove('hidden')
        }
        const scannerManual = document.getElementById('scannerManual')
        if (scannerManual) scannerManual.classList.remove('hidden')
        const scannerModeToggle = document.getElementById('scannerModeToggle')
        if (scannerModeToggle) {
            scannerModeToggle.textContent = '📷'
            scannerModeToggle.classList.add('active')
        }
        const manualInput = document.getElementById('manualBarcodeInput')
        if (manualInput) manualInput.focus()
        return
    }

    if (type === 'result' && bitmap) {
        if (scannerDetector) {
            scannerDetector.detect(bitmap).then(barcodes => {
                const code = barcodes.length > 0 ? barcodes[0].rawValue : null
                if (code) {
                    const scanner = document.getElementById('barcodeScanner')
                    if (navigator.vibrate) navigator.vibrate(200)
                    searchByBarcode(code).then(found => {
                        if (found) {
                            closeBarcodeScanner()
                        } else if (scanner) {
                            scanner.classList.add('not-found')
                            setTimeout(() => scanner.classList.remove('not-found'), 900)
                        }
                    }).catch(() => {})
                }
            }).catch(err => {
                console.error('Detect error:', err)
            }).finally(() => {
                workerBusy = false
                if (bitmap && typeof bitmap.close === 'function') {
                    bitmap.close()
                }
            })
        } else {
            workerBusy = false
            if (bitmap && typeof bitmap.close === 'function') {
                bitmap.close()
            }
        }
    } else if (type === 'error') {
        console.error('Scanner worker error:', error)
        workerBusy = false
    }
}

function toggleScannerMode() {
    const manual = document.getElementById('scannerManual')
    const modeBtn = document.getElementById('scannerModeToggle')
    const video = document.getElementById('scannerVideo')
    if (!manual || !modeBtn) return
    
    if (scannerMode === 'camera') {
        scannerMode = 'manual'
        manual.classList.remove('hidden')
        modeBtn.textContent = '📷'
        modeBtn.classList.add('active')
        if (barcodeStream) {
            barcodeStream.getTracks().forEach(track => track.stop())
            barcodeStream = null
        }
        if (video) video.srcObject = null
        const manualInput = document.getElementById('manualBarcodeInput')
        if (manualInput) manualInput.focus()
    } else {
        scannerMode = 'camera'
        manual.classList.add('hidden')
        modeBtn.textContent = '⌨️'
        modeBtn.classList.remove('active')
        const scanner = document.getElementById('barcodeScanner')
        if (scanner && scanner.classList.contains('hidden')) {
            toggleBarcodeScanner()
        }
    }
}

async function handleManualBarcode() {
    const input = document.getElementById('manualBarcodeInput')
    if (!input) return
    const barcode = input.value.trim()
    if (!barcode) return
    
    if (navigator.vibrate) navigator.vibrate(200)
    const found = await searchByBarcode(barcode)
    
    if (found) {
        closeBarcodeScanner()
    } else {
        const scanner = document.getElementById('barcodeScanner')
        if (scanner) {
            scanner.classList.add('not-found')
            input.value = ''
            setTimeout(() => scanner.classList.remove('not-found'), 900)
        }
    }
}

async function toggleFlash() {
    if (!barcodeStream) return
    const track = barcodeStream.getVideoTracks()[0]
    if (!track) return
    try {
        scannerFlashOn = !scannerFlashOn
        await track.applyConstraints({ torch: scannerFlashOn })
        const flashToggle = document.getElementById('flashToggle')
        if (flashToggle) flashToggle.classList.toggle('active', scannerFlashOn)
    } catch (error) {
        console.error('Torch not supported:', error)
        scannerFlashOn = false
        const flashToggle = document.getElementById('flashToggle')
        if (flashToggle) flashToggle.classList.remove('active')
    }
}

let scannerZoom = 1

async function toggleZoom() {
    if (!barcodeStream) return
    const track = barcodeStream.getVideoTracks()[0]
    if (!track) return
    try {
        scannerZoom = scannerZoom === 1 ? 2 : 1
        await track.applyConstraints({ zoom: scannerZoom })
        const zoomToggle = document.getElementById('zoomToggle')
        if (zoomToggle) zoomToggle.textContent = scannerZoom + '×'
    } catch (error) {
        console.error('Zoom not supported:', error)
        scannerZoom = 1
        const zoomToggle = document.getElementById('zoomToggle')
        if (zoomToggle) zoomToggle.textContent = '1×'
    }
}

function closeBarcodeScanner() {
    if (scanRafId) {
        cancelAnimationFrame(scanRafId)
        scanRafId = null
    }
    if (scannerWorker) {
        scannerWorker.terminate()
        scannerWorker = null
    }
    workerBusy = false
    scannerDetector = null
    scanLastTime = 0
    lastVideoTime = -1
    invalidateScanCropCache()
    if (barcodeStream) {
        barcodeStream.getTracks().forEach(track => track.stop())
        barcodeStream = null
    }
    scannerZoom = 1
    scannerMode = 'camera'
    const zoomBtn = document.getElementById('zoomToggle')
    if (zoomBtn) zoomBtn.textContent = '1×'
    const scanner = document.getElementById('barcodeScanner')
    if (scanner) {
        scanner.classList.add('hidden')
        scanner.classList.remove('not-found')
    }
    const manual = document.getElementById('scannerManual')
    if (manual) manual.classList.add('hidden')
}

async function searchByBarcode(barcode) {
    try {
        const response = await fetchWithTimeout(`${CONFIG.supabaseUrl}/rest/v1/products?barcode=eq.${encodeURIComponent(barcode)}&is_visible=eq.true&select=*,categories(name),brands(name),product_images(*)`, {
            headers: {
                'apikey': CONFIG.supabaseAnonKey,
                'Authorization': `Bearer ${CONFIG.supabaseAnonKey}`
            }
        })

        if (!response.ok) {
            console.error('Barcode search failed:', response.status)
            return false
        }

        const products = await response.json()

        if (products.length > 0) {
            const product = products[0]
            if (!allProducts.find(p => p.id === product.id)) {
                allProducts.unshift(product)
            }
            openProductModal(product.id)
            return true
        }
        return false
    } catch (error) {
        console.error('Ошибка поиска по штрих-коду:', error)
        return false
    }
}

function showLoading(show) {
    const loading = document.getElementById('loading')
    const catalog = document.getElementById('catalog')
    if (!loading || !catalog) return
    if (!show) {
        loading.classList.add('hidden')
        catalog.classList.remove('skeleton-mode')
        return
    }
    loading.classList.remove('hidden')
    const count = PRODUCTS_PER_PAGE
    catalog.innerHTML = Array.from({ length: count }, () => `
        <div class="skeleton-card">
            <div class="skeleton-img"></div>
            <div class="skeleton-body">
                <div class="skeleton-line medium"></div>
                <div class="skeleton-line short"></div>
                <div class="skeleton-line price"></div>
            </div>
        </div>
    `).join('')
    catalog.classList.add('skeleton-mode')
}

function showError(message) {
    const errorEl = document.getElementById('error')
    if (!errorEl) return
    errorEl.textContent = message
    errorEl.classList.remove('hidden')
    console.error('APP ERROR:', message)
}

function debounce(func, wait) {
    let timeout
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout)
            func(...args)
        }
        clearTimeout(timeout)
        timeout = setTimeout(later, wait)
    }
}

let bannerSlides = []
let bannerCurrentIndex = 0
let bannerInterval = null
let bannerPaused = false

const BANNER_INTERVAL_MS = 5000

function initBanner() {
    const banner = document.getElementById('promoBanner')
    const track = document.getElementById('promoBannerTrack')
    const dotsContainer = document.getElementById('promoBannerDots')
    if (!banner || !track || !dotsContainer) return

    bannerSlides = getBannerSlides()
    if (!bannerSlides.length) {
        banner.classList.add('hidden')
        return
    }

    banner.classList.remove('hidden')

    track.innerHTML = bannerSlides.map((slide, idx) => {
        const isSplit = slide.layout === 'split'
        const imagePosition = slide.image_position || 'center'
        const hasImage = slide.image && slide.image.trim() !== ''
        const badgeHtml = slide.badge ? `<div class="promo-badge">${escapeHtml(slide.badge)}</div>` : ''
        const linkHtml = slide.link ? `<a href="${escapeHtml(slide.link)}" class="promo-link" ${slide.link.startsWith('http') ? 'target="_blank" rel="noopener" ' : ''}>Подробнее</a>` : ''
        const textHtml = slide.text ? `<div class="promo-text">${escapeHtml(slide.text)}</div>` : ''
        const activeClass = idx === 0 ? 'active' : ''
        const splitPosClass = isSplit ? `split-${imagePosition}` : ''

        let imageHtml = ''
        let styleAttr = ''
        if (isSplit && hasImage) {
            const imgPosStyle = imagePosition === 'left' ? 'left: 0; right: auto;' : imagePosition === 'right' ? 'right: 0; left: auto;' : 'left: 50%; transform: translateX(-50%);'
            imageHtml = `<img class="promo-split-image" src="${escapeHtml(slide.image)}" alt="" style="${imgPosStyle}" loading="lazy">`
        } else if (hasImage) {
            const bgPos = imagePosition === 'left' ? 'left center' : imagePosition === 'right' ? 'right center' : 'center center'
            styleAttr = `background-image: url('${escapeHtml(slide.image)}'); background-position: ${bgPos};`
        }

        return `
            <div class="promo-banner-slide ${activeClass} ${splitPosClass}" data-index="${idx}" data-link="${escapeHtml(slide.link || '')}" data-product-id="${escapeHtml(slide.product_id || '')}" style="${styleAttr}">
                ${imageHtml}
                <div class="promo-content">
                    ${badgeHtml}
                    <div class="promo-title">${escapeHtml(slide.title)}</div>
                    ${slide.subtitle ? `<div class="promo-subtitle">${escapeHtml(slide.subtitle)}</div>` : ''}
                    ${textHtml}
                    ${linkHtml}
                </div>
            </div>
        `
    }).join('') + '<div class="promo-banner-dots" id="promoBannerDots"></div>'

    const newDotsContainer = document.getElementById('promoBannerDots')
    if (newDotsContainer) {
        newDotsContainer.innerHTML = bannerSlides.map((_, idx) =>
            `<button class="promo-banner-dot${idx === 0 ? ' active' : ''}" data-index="${idx}" aria-label="Слайд ${idx + 1}"></button>`
        ).join('')
    }

    bannerCurrentIndex = 0
    startBannerAutoplay()

    track.addEventListener('mouseenter', () => { bannerPaused = true })
    track.addEventListener('mouseleave', () => { bannerPaused = false })
    track.addEventListener('touchstart', () => { bannerPaused = true }, { passive: true })
    track.addEventListener('touchend', () => { bannerPaused = false })

    const dots = track.querySelectorAll('.promo-banner-dot')
    dots.forEach(dot => {
        dot.addEventListener('click', (e) => {
            e.stopPropagation()
            const index = parseInt(dot.dataset.index, 10)
            goToBannerSlide(index)
            resetBannerAutoplay()
        })
    })

    const slides = track.querySelectorAll('.promo-banner-slide')
    slides.forEach(slide => {
        slide.addEventListener('click', (e) => {
            const link = slide.dataset.link
            const productId = slide.dataset.productId
            if (productId) {
                openProductModal(productId)
            } else if (link) {
                if (link.startsWith('http')) {
                    window.open(link, '_blank', 'noopener,noreferrer')
                } else {
                    window.location.href = link
                }
            }
        })
    })
}

function getBannerSlides() {
    const settings = window.__storeSettings || {}
    const customSlides = settings.promo_banner_slides
    if (customSlides) {
        try {
            const parsed = JSON.parse(customSlides)
            if (Array.isArray(parsed) && parsed.length) {
                return parsed.map(s => ({
                    ...s,
                    product_id: s.product_id || s.productId || null,
                    image_position: s.image_position || s.imagePosition || 'center',
                    layout: s.layout || 'full',
                    text: s.text || null,
                    sort_order: s.sort_order ?? s.sortOrder ?? 0
                }))
            }
        } catch (e) {
            console.error('Failed to parse promo_banner_slides:', e)
        }
    }

    const newProducts = (allProducts || [])
        .filter(p => p.is_new)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, 3)

    const slides = []

    if (newProducts.length > 0) {
        const np = newProducts[0]
        const img = np.product_images?.find(i => i.is_main) || np.product_images?.[0]
        slides.push({
            type: 'product',
            product_id: String(np.id),
            image: img?.url || '',
            title: cleanProductName(np.name, np.brands?.name),
            subtitle: `Новинка от ${np.brands?.name || 'JOCK NUTRITION'}`,
            badge: 'NEW',
            link: null,
            layout: 'full',
            image_position: 'center',
            text: null,
            sort_order: 0
        })
    }

    const discountProducts = (allProducts || [])
        .filter(p => p.is_discount && p.old_price && p.price < p.old_price)
        .sort((a, b) => {
            const dA = Math.round((1 - a.price / a.old_price) * 100)
            const dB = Math.round((1 - b.price / b.old_price) * 100)
            return dB - dA
        })
        .slice(0, 2)

    discountProducts.forEach(p => {
        const img = p.product_images?.find(i => i.is_main) || p.product_images?.[0]
        const discountPercent = Math.round((1 - p.price / p.old_price) * 100)
        slides.push({
            type: 'product',
            product_id: String(p.id),
            image: img?.url || '',
            title: `Скидка ${discountPercent}%`,
            subtitle: cleanProductName(p.name, p.brands?.name),
            badge: 'SALE',
            link: null,
            layout: 'full',
            image_position: 'center',
            text: null,
            sort_order: 0
        })
    })

    if (!slides.length) {
        slides.push({
            type: 'promo',
            image: '',
            title: 'JOCK NUTRITION',
            subtitle: 'Спортивное питание премиум качества',
            badge: null,
            link: null,
            layout: 'full',
            image_position: 'center',
            text: null,
            sort_order: 0
        })
    }

    return slides
}

function goToBannerSlide(index) {
    const track = document.getElementById('promoBannerTrack')
    if (!track) return

    const total = bannerSlides.length
    if (total === 0) return

    bannerCurrentIndex = ((index % total) + total) % total

    const slides = track.querySelectorAll('.promo-banner-slide')
    const dots = track.querySelectorAll('.promo-banner-dot')

    slides.forEach((slide, i) => {
        slide.classList.toggle('active', i === bannerCurrentIndex)
    })
    dots.forEach((dot, i) => {
        dot.classList.toggle('active', i === bannerCurrentIndex)
    })
}

function startBannerAutoplay() {
    stopBannerAutoplay()
    bannerInterval = setInterval(() => {
        if (bannerPaused) return
        goToBannerSlide(bannerCurrentIndex + 1)
    }, BANNER_INTERVAL_MS)
}

function stopBannerAutoplay() {
    if (bannerInterval) {
        clearInterval(bannerInterval)
        bannerInterval = null
    }
}

function resetBannerAutoplay() {
    startBannerAutoplay()
}

function updateBannerVisibility() {
    const banner = document.getElementById('promoBanner')
    if (!banner) return
    if (favoritesOnly) {
        banner.classList.add('hidden')
        stopBannerAutoplay()
    } else {
        banner.classList.remove('hidden')
        if (bannerSlides.length > 0) {
            startBannerAutoplay()
        }
    }
}

/* ---------- Cookie Consent & Welcome ---------- */
function checkCookieConsent() {
    const banner = document.getElementById('cookieBanner')
    if (!banner) return
    const consent = localStorage.getItem('jock-cookie-consent')
    if (!consent) {
        banner.classList.remove('hidden')
    }
}

function acceptCookies() {
    localStorage.setItem('jock-cookie-consent', 'true')
    const banner = document.getElementById('cookieBanner')
    if (banner) banner.classList.add('hidden')

    const welcomeShown = localStorage.getItem('jock-welcome-shown')
    if (!welcomeShown) {
        setTimeout(() => {
            showWelcomeModal()
        }, 2500)
    }
}

function showWelcomeModal() {
    const modal = document.getElementById('welcomeModal')
    if (!modal) return
    modal.classList.remove('hidden')
    const privacyBtn = document.getElementById('privacyToggle')
    if (privacyBtn) privacyBtn.classList.add('welcome-highlight')
}

function hideWelcomeModal() {
    localStorage.setItem('jock-welcome-shown', 'true')
    const modal = document.getElementById('welcomeModal')
    if (modal) modal.classList.add('hidden')
    const privacyBtn = document.getElementById('privacyToggle')
    if (privacyBtn) privacyBtn.classList.remove('welcome-highlight')
}

/* ---------- Privacy Modal ---------- */
async function openPrivacyModal() {
    const modal = document.getElementById('privacyModal')
    const body = document.getElementById('privacyModalBody')
    if (!modal || !body) return

    body.innerHTML = '<p style="text-align:center;color:var(--text-secondary);">Загрузка...</p>'
    modal.classList.remove('hidden')

    try {
        const response = await fetchWithTimeout('./privacy.html', {}, 5000)
        if (response.ok) {
            const html = await response.text()
            const parser = new DOMParser()
            const doc = parser.parseFromString(html, 'text/html')
            const content = doc.querySelector('.privacy-content')
            body.innerHTML = content ? content.innerHTML : html
        } else {
            throw new Error('Failed to load')
        }
    } catch (e) {
        body.innerHTML = getPrivacyFallbackContent()
    }
}

function closePrivacyModal() {
    const modal = document.getElementById('privacyModal')
    if (modal) modal.classList.add('hidden')
}

function getPrivacyFallbackContent() {
    return `
        <p><strong>JOCK NUTRITION</strong> уважает вашу приватность.</p>
        <p>Наше веб-приложение использует исключительно технические механизмы хранения данных на устройстве пользователя для обеспечения базовой функциональности:</p>
        <ul>
            <li><strong>localStorage:</strong> сохранение корзины покупок (<code>jock-cart</code>), списка избранного (<code>jock-favorites</code>), темы оформления (<code>jock-theme</code>), флагов согласия на cookies и приветственного окна (<code>jock-cookie-consent</code>, <code>jock-welcome-shown</code>).</li>
            <li><strong>Service Worker / Cache API:</strong> временное кеширование статических ресурсов для ускорения загрузки приложения.</li>
        </ul>
        <p>Мы <strong>не собираем, не передаём и не продаём</strong> никакие персональные данные третьим лицам или на сторонние серверы. В приложении не запрашиваются ФИО, номера телефонов, адреса электронной почты или иные персональные идентификаторы.</p>
        <p>Оформление заказа реализовано через отправку содержимого корзины на сервисный endpoint (Supabase Edge Function) исключительно для генерации номера заказа и формирования ссылки на WhatsApp. На этом endpoint не передаётся никакой информации кроме списка идентификаторов товаров и их количества.</p>
        <p>Вы можете в любой момент очистить localStorage через настройки браузера, что приведёт к потере корзины и избранного, но не затронет работу приложения.</p>
        <p>Если у вас есть вопросы, свяжитесь с нами через форму обратной связи на сайте.</p>
    `
}

// Service Worker (обход кеша GitHub Pages + отслеживание обновлений)
let swControllerListenerAdded = false

async function registerServiceWorker() {
    if (!('serviceWorker' in navigator) || location.pathname.startsWith('/admin/')) return

    try {
        const registration = await navigator.serviceWorker.register('./sw.js')

        if (registration.waiting) {
            registration.waiting.postMessage({ action: 'SKIP_WAITING' })
        }

        registration.addEventListener('updatefound', () => {
            const newWorker = registration.installing
            if (newWorker) {
                newWorker.addEventListener('statechange', () => {
                    if (newWorker.state === 'installed') {
                        if (registration.waiting) {
                            registration.waiting.postMessage({ action: 'SKIP_WAITING' })
                        } else if (navigator.serviceWorker.controller) {
                            showUpdateNotification()
                        }
                    }
                })
            }
        })

        if (navigator.serviceWorker.controller && !swControllerListenerAdded) {
            swControllerListenerAdded = true
            navigator.serviceWorker.addEventListener('controllerchange', () => {
                window.location.reload()
            })
        }

        registration.update()
        setInterval(() => registration.update(), 60000)
    } catch (error) {
        console.error('Service Worker registration failed:', error)
    }
}

function showUpdateNotification() {
    const banner = document.getElementById('updateBanner')
    if (!banner) return
    banner.classList.remove('hidden')

    const reloadBtn = document.getElementById('updateReloadBtn')
    if (reloadBtn) {
        reloadBtn.onclick = () => {
            if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
                navigator.serviceWorker.getRegistrations().then(regs => {
                    if (regs[0] && regs[0].waiting) {
                        regs[0].waiting.postMessage({ action: 'SKIP_WAITING' })
                    } else {
                        window.location.reload()
                    }
                })
            } else {
                window.location.reload()
            }
        }
    }
}

// Add to Home Screen prompt
let deferredPrompt = null

function showA2HSBanner() {
    if (sessionStorage.getItem('a2hs-dismissed')) return
    const banner = document.getElementById('a2hsBanner')
    if (!banner) return
    banner.classList.remove('hidden')

    const installBtn = document.getElementById('a2hsInstall')
    if (installBtn && !installBtn.dataset.a2hsListener) {
        installBtn.dataset.a2hsListener = 'true'
        installBtn.addEventListener('click', async () => {
            if (deferredPrompt) {
                try {
                    deferredPrompt.prompt()
                    const { outcome } = await deferredPrompt.userChoice
                    if (outcome === 'accepted') {
                        trackPWAInstall()
                    }
                    deferredPrompt = null
                } catch (err) {
                    console.error('A2HS prompt failed:', err)
                }
            }
            banner.classList.add('hidden')
            sessionStorage.setItem('a2hs-dismissed', 'true')
        })
    }

    const closeBtn = document.getElementById('a2hsClose')
    if (closeBtn && !closeBtn.dataset.a2hsListener) {
        closeBtn.dataset.a2hsListener = 'true'
        closeBtn.addEventListener('click', () => {
            banner.classList.add('hidden')
            sessionStorage.setItem('a2hs-dismissed', 'true')
        })
    }
}

function showA2HSModal() {
    if (sessionStorage.getItem('a2hs-modal-dismissed')) return
    const modal = document.getElementById('a2hsModal')
    if (!modal) return
    modal.classList.remove('hidden')

    const installBtn = document.getElementById('a2hsModalInstall')
    if (installBtn && !installBtn.dataset.a2hsListener) {
        installBtn.dataset.a2hsListener = 'true'
        installBtn.addEventListener('click', async () => {
            if (deferredPrompt) {
                try {
                    deferredPrompt.prompt()
                    const { outcome } = await deferredPrompt.userChoice
                    if (outcome === 'accepted') {
                        trackPWAInstall()
                    }
                    deferredPrompt = null
                } catch (err) {
                    console.error('A2HS prompt failed:', err)
                }
            }
            modal.classList.add('hidden')
            sessionStorage.setItem('a2hs-modal-dismissed', 'true')
        })
    }

    const closeBtn = document.getElementById('a2hsModalClose')
    if (closeBtn && !closeBtn.dataset.a2hsListener) {
        closeBtn.dataset.a2hsListener = 'true'
        closeBtn.addEventListener('click', () => {
            modal.classList.add('hidden')
            sessionStorage.setItem('a2hs-modal-dismissed', 'true')
        })
    }
}

function trackPWAInstall() {
    try {
        localStorage.setItem('jock-pwa-install-attempt', Date.now().toString())
    } catch (e) {}
}

function initA2HS() {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true
    if (isStandalone) return

    let visitCount = parseInt(localStorage.getItem('jock-visit-count') || '0', 10)
    visitCount++
    localStorage.setItem('jock-visit-count', String(visitCount))
    const isSecondVisit = visitCount >= 2

    const showTarget = isSecondVisit ? showA2HSModal : showA2HSBanner
    const iosDelay = isSecondVisit ? 5000 : 5000

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault()
        deferredPrompt = e
        showTarget()
    })

    window.addEventListener('appinstalled', () => {
        deferredPrompt = null
        trackPWAInstall()
    })

    const isIOS = /iphone|ipad|ipod/.test(navigator.userAgent.toLowerCase()) && !window.MSStream
    if (isIOS && /safari/i.test(navigator.userAgent) && !/crios|fxios|edgios/.test(navigator.userAgent)) {
        setTimeout(showTarget, iosDelay)
    }
}

function setupOfflineListener() {
    const updateOnlineStatus = () => {
        const errorEl = document.getElementById('error')
        if (!navigator.onLine && errorEl) {
            errorEl.textContent = 'Нет подключения к интернету. Некоторые функции могут быть ограничены.'
            errorEl.classList.remove('hidden')
        } else if (navigator.onLine && errorEl) {
            errorEl.classList.add('hidden')
        }
    }

    window.addEventListener('online', updateOnlineStatus)
    window.addEventListener('offline', updateOnlineStatus)
    updateOnlineStatus()
}

// Global error handler
window.addEventListener('error', (event) => {
    console.error('Global error:', event.error)
})

window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason)
})

// Initialize
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        init()
        registerServiceWorker()
        initA2HS()
    })
} else {
    init()
    registerServiceWorker()
    initA2HS()
}
