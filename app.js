const CONFIG = {
    supabaseUrl: 'https://hpphfeojjejculvdundj.supabase.co',
    supabaseAnonKey: 'sb_publishable_1EGpjPEw9gU2W5OKL-gFIQ_x4Gvger1',
    orderFunctionUrl: 'https://hpphfeojjejculvdundj.supabase.co/functions/v1/create-order',
    adminApiUrl: 'https://hpphfeojjejculvdundj.supabase.co/functions/v1/admin-api'
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

let allProducts = []
let filteredProducts = []
let relatedMap = []
let cart = JSON.parse(localStorage.getItem('jack-cart') || '[]')
let favorites = JSON.parse(localStorage.getItem('jack-favorites') || '[]')
let favoritesOnly = false
let darkMode = localStorage.getItem('jack-theme') === 'dark'
let barcodeStream = null
let scannerFlashOn = false
let scannerMode = 'camera'
let lastVideoTime = -1
let scannerWorker = null
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

function init() {
    applyTheme()
    loadSettings()
    loadProducts()
    updateCartCount()
    updateFavoritesCount()
    setupEventListeners()
    checkOrderTime()
    setInterval(checkOrderTime, 60000)
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
}

function applyTheme() {
    if (darkMode) {
        document.documentElement.setAttribute('data-theme', 'dark')
    } else {
        document.documentElement.removeAttribute('data-theme')
    }
}

function setupEventListeners() {
    document.getElementById('themeToggle').addEventListener('click', toggleTheme)
    document.getElementById('searchToggle').addEventListener('click', toggleSearch)
    document.getElementById('searchInput').addEventListener('input', debounce(handleSearch, 300))
    document.getElementById('searchClear').addEventListener('click', clearSearch)
    document.getElementById('barcodeToggle').addEventListener('click', toggleBarcodeScanner)
    document.getElementById('closeScannerX').addEventListener('click', closeBarcodeScanner)
    document.getElementById('flashToggle').addEventListener('click', toggleFlash)
    document.getElementById('zoomToggle').addEventListener('click', toggleZoom)
    document.getElementById('scannerModeToggle').addEventListener('click', toggleScannerMode)
    document.getElementById('manualBarcodeInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleManualBarcode()
    })
    document.getElementById('manualBarcodeSubmit').addEventListener('click', handleManualBarcode)
    document.getElementById('cartBtn').addEventListener('click', openCart)
    document.getElementById('checkoutBtn').addEventListener('click', checkout)
    document.getElementById('loadMoreBtn').addEventListener('click', loadMoreProducts)

    // Favorites view toggle
    const favToggle = document.getElementById('favoritesToggle')
    if (favToggle) favToggle.addEventListener('click', toggleFavoritesView)

    // Filters (sidebar on mobile, modal on desktop)
    document.getElementById('filterToggle').addEventListener('click', openFilters)
    document.getElementById('applyFilters').addEventListener('click', () => {
        applyFilters()
        closeFilters()
    })
    document.getElementById('resetFilters').addEventListener('click', resetFilters)
    document.getElementById('filterSidebarClose').addEventListener('click', closeFilters)
    document.getElementById('filterSidebarOverlay').addEventListener('click', closeFilters)
    // Live-применение при выборе внутри окна (для удобства)
    document.getElementById('categoryFilter').addEventListener('change', applyFilters)
    document.getElementById('brandFilter').addEventListener('change', applyFilters)
    document.getElementById('priceFrom').addEventListener('input', debounce(applyFilters, 500))
    document.getElementById('priceTo').addEventListener('input', debounce(applyFilters, 500))
    document.getElementById('sortFilter').addEventListener('change', applyFilters)

    document.querySelector('#productModal .modal-close').addEventListener('click', closeModal)
    document.getElementById('productModal').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeModal()
    })

    // Cart drawer
    document.getElementById('cartDrawerClose').addEventListener('click', closeCart)
    document.getElementById('cartDrawerOverlay').addEventListener('click', closeCart)
    document.getElementById('checkoutBtn').addEventListener('click', checkout)
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const drawer = document.getElementById('cartDrawer')
            if (drawer.classList.contains('open')) closeCart()
        }
    })

    // Cart drawer item buttons (event delegation)
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

    // Catalog delegation (single listener for card clicks + cart buttons)
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
}

function openFilters() {
    const sidebar = document.getElementById('filterSidebar')
    const overlay = document.getElementById('filterSidebarOverlay')
    sidebar.classList.add('open')
    overlay.classList.add('open')
}

function closeFilters() {
    const sidebar = document.getElementById('filterSidebar')
    const overlay = document.getElementById('filterSidebarOverlay')
    sidebar.classList.remove('open')
    overlay.classList.remove('open')
}

function openCart() {
    renderCart()
    const drawer = document.getElementById('cartDrawer')
    const overlay = document.getElementById('cartDrawerOverlay')
    drawer.classList.add('open')
    overlay.classList.add('open')
}

function closeCart() {
    const drawer = document.getElementById('cartDrawer')
    const overlay = document.getElementById('cartDrawerOverlay')
    drawer.classList.remove('open')
    overlay.classList.remove('open')
}

function toggleTheme() {
    darkMode = !darkMode
    localStorage.setItem('jack-theme', darkMode ? 'dark' : 'light')
    applyTheme()
}

function toggleSearch() {
    const searchBar = document.getElementById('searchBar')
    searchBar.classList.toggle('hidden')
    if (!searchBar.classList.contains('hidden')) {
        document.getElementById('searchInput').focus()
    }
}

function handleSearch(e) {
    applyFilters()
}

function clearSearch() {
    document.getElementById('searchInput').value = ''
    applyFilters()
}

async function loadSettings() {
    try {
        const response = await fetch(`${CONFIG.supabaseUrl}/rest/v1/settings?select=key,value`, {
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
            // Re-run time check now that settings are loaded
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
            const response = await fetch(`${CONFIG.supabaseUrl}/rest/v1/products?is_visible=eq.true&select=*,categories(name),brands(name),product_images(*),product_links(*)&order=created_at.desc&limit=1000`, {
                headers: {
                    'apikey': CONFIG.supabaseAnonKey,
                    'Authorization': `Bearer ${CONFIG.supabaseAnonKey}`
                }
            })
            if (!response.ok) throw new Error('Failed to load products')
            products = await response.json()
            apiCache.products = { data: products, ts: now, ttl: 30000 }
        }
        
        productsTotal = products.length
        allProducts = products
        
        // Load related products (cached)
        if (!apiCache.related.data || now - apiCache.related.ts >= apiCache.related.ttl) {
            try {
                const relatedRes = await fetch(`${CONFIG.supabaseUrl}/rest/v1/product_related?select=product_id,related_id`, {
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
        await loadFilters()
        
        if (reset) {
            filteredProducts = allProducts
            productsTotal = allProducts.length
            renderProducts(allProducts.slice(0, PRODUCTS_PER_PAGE))
            updatePagination()
        }
    } catch (error) {
        showError('Ошибка загрузки товаров')
        console.error(error)
    } finally {
        if (reset) showLoading(false)
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
        const [categoriesRes, brandsRes] = await Promise.all([
            fetch(`${CONFIG.supabaseUrl}/rest/v1/categories?select=*`, {
                headers: { 'apikey': CONFIG.supabaseAnonKey, 'Authorization': `Bearer ${CONFIG.supabaseAnonKey}` }
            }),
            fetch(`${CONFIG.supabaseUrl}/rest/v1/brands?select=*`, {
                headers: { 'apikey': CONFIG.supabaseAnonKey, 'Authorization': `Bearer ${CONFIG.supabaseAnonKey}` }
            })
        ])

        const categories = await categoriesRes.json()
        const brands = await brandsRes.json()

        const categorySelect = document.getElementById('categoryFilter')
        categorySelect.innerHTML = '<option value="">Все</option>' +
            categories.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')

        const brandSelect = document.getElementById('brandFilter')
        brandSelect.innerHTML = '<option value="">Все</option>' +
            brands.map(b => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join('')
    } catch (error) {
        console.error('Error loading filters:', error)
    }
}

function filterAndRenderProducts(filters = {}) {
    let filtered = [...allProducts]

    if (filters.search) {
        const query = filters.search.toLowerCase()
        filtered = filtered.filter(p => 
            p.name.toLowerCase().includes(query) ||
            p.brands?.name?.toLowerCase().includes(query)
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
}

function applyFilters() {
    const filters = {
        search: document.getElementById('searchInput').value,
        category: document.getElementById('categoryFilter').value,
        brand: document.getElementById('brandFilter').value,
        priceFrom: document.getElementById('priceFrom').value,
         priceTo: document.getElementById('priceTo').value,
         sort: document.getElementById('sortFilter').value,
         favoritesOnly: favoritesOnly
     }
     filterAndRenderProducts(filters)
}

function resetFilters() {
    document.getElementById('categoryFilter').value = ''
    document.getElementById('brandFilter').value = ''
    document.getElementById('priceFrom').value = ''
    document.getElementById('priceTo').value = ''
    document.getElementById('sortFilter').value = 'newest'
    document.getElementById('searchInput').value = ''
    if (favoritesOnly) {
        favoritesOnly = false
        const btn = document.getElementById('favoritesToggle')
        if (btn) btn.classList.remove('active')
    }
    applyFilters()
}

function renderProducts(products) {
    const catalog = document.getElementById('catalog')
    
    if (products.length === 0) {
        catalog.innerHTML = '<div class="loading">Товары не найдены</div>'
        return
    }

    catalog.innerHTML = products.map(product => createProductCard(product)).join('')
}

function appendProducts(products) {
    const catalog = document.getElementById('catalog')
    const html = products.map(product => createProductCard(product)).join('')
    catalog.insertAdjacentHTML('beforeend', html)
}

function createProductCard(product) {
    const mainImage = product.product_images?.find(img => img.is_main) || product.product_images?.[0]
    const imageUrl = mainImage?.url || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect fill="%23f0f0f0" width="200" height="200"/><text fill="%23999" font-family="sans-serif" font-size="14" x="50%" y="50%" text-anchor="middle" dy=".3em">Нет фото</text></svg>'
    
    const cartItem = cart.find(c => c.id === product.id)
    const inCart = cartItem ? cartItem.quantity : 0
    const favorited = isFavorited(product.id)

    return `
        <div class="product-card" data-id="${product.id}">
            <div class="product-image-wrap">
                <img src="${imageUrl}" alt="${escapeHtml(product.name)}" class="product-image" loading="lazy">
                <button class="favorite-btn ${favorited ? 'active' : ''}" data-id="${product.id}" aria-label="В избранное">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78a5.5 5.5 0 0 0 0-7.78z"></path>
                    </svg>
                </button>
            </div>
            <div class="product-info">
                <div class="product-brand">${escapeHtml(product.brands?.name || '')}</div>
                <div class="product-name">${escapeHtml(product.name)}</div>
                <div class="product-volume">${escapeHtml(product.volume || '')}</div>
                <div class="product-badges">
                    ${product.is_hit ? '<span class="badge badge-hit">Хит</span>' : ''}
                    ${product.is_new ? '<span class="badge badge-new">Новинка</span>' : ''}
                    ${product.is_discount ? '<span class="badge badge-discount">Скидка</span>' : ''}
                </div>
                <div class="product-footer">
                    <div>
                        <span class="product-price">${product.price} ₽</span>
                        ${product.old_price ? `<span class="product-old-price">${product.old_price} ₽</span>` : ''}
                    </div>
                    <div class="cart-controls ${inCart > 0 ? 'active' : ''}">
                        <button class="cart-minus" data-id="${product.id}" ${inCart === 0 ? 'disabled' : ''}>-</button>
                        <span class="cart-qty">${inCart}</span>
                        <button class="cart-plus" data-id="${product.id}">+</button>
                    </div>
                    ${inCart === 0 ? `<button class="add-to-cart" data-id="${product.id}">В корзину</button>` : ''}
                </div>
            </div>
        </div>
    `
}

function attachProductListeners() {
}

function openProductModal(productId) {
    const product = allProducts.find(p => p.id === productId)
    if (!product) return

    const mainImage = product.product_images?.find(img => img.is_main) || product.product_images?.[0]
    const imageUrl = mainImage?.url || ''

    const modalBody = document.getElementById('modalBody')
    const favorited = isFavorited(productId)
    modalBody.innerHTML = `
        ${imageUrl ? '<img src="' + imageUrl + '" alt="' + escapeHtml(product.name) + '">' : ''}
        <button class="favorite-btn modal-favorite ${favorited ? 'active' : ''}" data-id="${product.id}" aria-label="В избранное">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78a5.5 5.5 0 0 0 0-7.78z"></path>
            </svg>
        </button>
        <div class="modal-brand">${escapeHtml(product.brands?.name || '')}</div>
        <h2>${escapeHtml(product.name)}</h2>
        <div class="modal-volume">${escapeHtml(product.volume || '')}</div>
        <div class="modal-badges">
            ${product.is_hit ? '<span class="badge badge-hit">Хит</span>' : ''}
            ${product.is_new ? '<span class="badge badge-new">Новинка</span>' : ''}
            ${product.is_discount ? '<span class="badge badge-discount">Скидка</span>' : ''}
        </div>
        <div class="modal-price">
            ${product.price} ₽
            ${product.old_price ? '<span class="product-old-price">' + product.old_price + ' ₽</span>' : ''}
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
        
        ${product.dosage ? `
            <div class="modal-section">
                <h3>Дозировка</h3>
                <p>${escapeHtml(product.dosage)}</p>
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

        ${product.product_links?.length ? `
            <div class="modal-section">
                <h3>Ссылки</h3>
                <div class="modal-links">
                    ${product.product_links.map(link => `
                        <a href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer" class="modal-link">
                            ${escapeHtml(link.title || link.url)}
                        </a>
                    `).join('')}
                </div>
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
                                <button class="related-card" data-id="${r.id}">
                                    ${rUrl ? `<img src="${rUrl}" alt="${escapeHtml(r.name)}" loading="lazy">` : ''}
                                    <div class="related-name">${escapeHtml(r.name)}</div>
                                    <div class="related-price">${r.price} ₽</div>
                                </button>
                            `
                        }).join('')}
                    </div>
                </div>
            `
        })()}

        <button class="btn btn-primary btn-block add-to-cart-modal" data-id="${product.id}">
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

    const modalFav = modalBody.querySelector('.modal-favorite')
    if (modalFav) {
        modalFav.addEventListener('click', () => toggleFavorite(product.id))
    }

    modalBody.querySelectorAll('.related-card').forEach(card => {
        card.addEventListener('click', () => {
            openProductModal(card.dataset.id)
        })
    })

    document.getElementById('productModal').classList.remove('hidden')
}

function closeModal() {
    document.getElementById('productModal').classList.add('hidden')
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
}

function updateProductCardCart(productId) {
    const card = document.querySelector(`.product-card[data-id="${productId}"]`)
    if (!card) return
    
    const cartItem = cart.find(c => c.id === productId)
    const inCart = cartItem ? cartItem.quantity : 0
    const product = allProducts.find(p => p.id === productId)
    const footer = card.querySelector('.product-footer')
    if (!footer) return
    
    footer.innerHTML = `
        <div>
            <span class="product-price">${product?.price || 0} ₽</span>
             ${product.old_price ? `<span class="product-old-price">${product.old_price} ₽</span>` : ''}
        </div>
        <div class="cart-controls ${inCart > 0 ? 'active' : ''}">
            <button class="cart-minus" data-id="${productId}" ${inCart === 0 ? 'disabled' : ''}>-</button>
            <span class="cart-qty">${inCart}</span>
            <button class="cart-plus" data-id="${productId}">+</button>
        </div>
        ${inCart === 0 ? `<button class="add-to-cart" data-id="${productId}">В корзину</button>` : ''}
    `
}

function saveCart() {
    localStorage.setItem('jack-cart', JSON.stringify(cart))
}

function updateCartCount() {
    const count = cart.reduce((sum, c) => sum + c.quantity, 0)
    document.getElementById('cartCount').textContent = count
}

function saveFavorites() {
    localStorage.setItem('jack-favorites', JSON.stringify(favorites))
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
    updateFavoritesCount()
    document.querySelectorAll(`.favorite-btn[data-id="${productId}"]`).forEach(btn => {
        btn.classList.toggle('active', isFavorited(productId))
    })
    if (favoritesOnly) {
        applyFilters()
    }
}

function updateFavoritesCount() {
    const count = favorites.length
    const el = document.getElementById('favoritesCount')
    if (el) {
        el.textContent = count
        el.classList.toggle('hidden', count === 0)
    }
}

function toggleFavoritesView() {
    favoritesOnly = !favoritesOnly
    const btn = document.getElementById('favoritesToggle')
    if (btn) btn.classList.toggle('active', favoritesOnly)
    applyFilters()
}

function openCart() {
    renderCart()
    const drawer = document.getElementById('cartDrawer')
    const overlay = document.getElementById('cartDrawerOverlay')
    drawer.classList.add('open')
    overlay.classList.add('open')
}

function closeCart() {
    const drawer = document.getElementById('cartDrawer')
    const overlay = document.getElementById('cartDrawerOverlay')
    drawer.classList.remove('open')
    overlay.classList.remove('open')
}

function renderCart() {
    const cartItems = document.getElementById('cartItems')
    const cartTotal = document.getElementById('cartTotal')
    const checkoutBtn = document.getElementById('checkoutBtn')

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

        return `
            <div class="cart-item">
                <img src="${product.product_images?.[0]?.url || ''}" alt="${escapeHtml(product.name)}" class="cart-item-image">
                <div class="cart-item-info">
                    <div class="cart-item-name">${escapeHtml(product.name)}</div>
                    <div class="cart-item-price">${product.price} ₽ × ${cartItem.quantity} = ${itemTotal} ₽</div>
                    <div class="cart-item-controls">
                        <button class="cart-minus" data-id="${product.id}">-</button>
                        <span>${cartItem.quantity}</span>
                        <button class="cart-plus" data-id="${product.id}">+</button>
                        <button class="cart-item-remove" data-id="${product.id}">&times;</button>
                    </div>
                </div>
            </div>
        `
    }).join('')

    cartTotal.textContent = `${total} ₽`
}

async function checkout() {
    if (cart.length === 0) {
        alert('Корзина пуста')
        return
    }

    const checkoutBtn = document.getElementById('checkoutBtn')
    checkoutBtn.disabled = true
    checkoutBtn.textContent = 'Оформление...'

    try {
        const response = await fetch(CONFIG.orderFunctionUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cart })
        })

        const data = await response.json().catch(() => ({}))

        if (!response.ok) {
            if (data.time_restricted) {
                document.getElementById('orderTimeMessage').textContent = data.error
                document.getElementById('orderTimeMessage').classList.remove('hidden')
                return
            }
            throw new Error(data.error || 'Ошибка оформления заказа')
        }

        // Open WhatsApp
        if (data.whatsappUrl) {
            const a = document.createElement('a')
            a.href = data.whatsappUrl
            a.target = '_blank'
            a.rel = 'noopener noreferrer'
            document.body.appendChild(a)
            a.click()
            document.body.removeChild(a)
        }

        // Clear cart
        cart = []
        saveCart()
        updateCartCount()
        closeCart()
        renderProducts(allProducts)

        alert(`Заказ ${data.orderNumber} оформлен!`)

    } catch (error) {
        alert(error.message)
    } finally {
        checkoutBtn.disabled = false
        checkoutBtn.textContent = 'Оформить заказ'
    }
}

async function checkOrderTime() {
    const timeMessage = document.getElementById('orderTimeMessage')
    const checkoutBtn = document.getElementById('checkoutBtn')
    
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

    if (scanner.classList.contains('hidden')) {
        scanner.classList.remove('hidden')
        scannerFlashOn = false
        scannerMode = 'camera'
        lastVideoTime = -1
        workerBusy = false
        document.getElementById('scannerManual').classList.add('hidden')
        document.getElementById('scannerModeToggle').textContent = '⌨️'
        document.getElementById('scannerModeToggle').classList.remove('active')
        
        try {
            if (!('BarcodeDetector' in window)) {
                console.warn('BarcodeDetector не поддерживается этим браузером')
                scannerMode = 'manual'
                document.getElementById('scannerManual').classList.remove('hidden')
                document.getElementById('scannerModeToggle').textContent = '📷'
                document.getElementById('scannerModeToggle').classList.add('active')
                document.getElementById('manualBarcodeInput').focus()
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

            scannerWorker = new Worker('/scanner-worker.js')
            scannerWorker.onmessage = onWorkerMessage
            scannerWorker.onerror = (err) => console.error('Scanner worker error:', err)

            invalidateScanCropCache()
            const crop = getScanCrop()
            if (crop) {
                scannerWorker.postMessage({ type: 'init', crop: crop, tw: 320 })
            }

            scanRafId = requestAnimationFrame(scanLoop)
        } catch (error) {
            console.error('Camera unavailable:', error)
            scannerMode = 'manual'
            document.getElementById('scannerManual').classList.remove('hidden')
            document.getElementById('scannerModeToggle').textContent = '📷'
            document.getElementById('scannerModeToggle').classList.add('active')
            document.getElementById('manualBarcodeInput').focus()
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
                        scannerWorker.postMessage({
                            type: 'scan',
                            bitmap: bitmap,
                            crop: crop,
                            tw: 320
                        }, [bitmap])
                    }).catch(() => {
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
    const { type, barcode, error } = e.data
    workerBusy = false

    if (type === 'result' && barcode) {
        const scanner = document.getElementById('barcodeScanner')
        if (navigator.vibrate) navigator.vibrate(200)
        searchByBarcode(barcode).then(found => {
            if (found) {
                closeBarcodeScanner()
            } else {
                scanner.classList.add('not-found')
                setTimeout(() => scanner.classList.remove('not-found'), 900)
            }
        })
    } else if (type === 'error') {
        console.error('Scanner worker error:', error)
    }
}

function toggleScannerMode() {
    const manual = document.getElementById('scannerManual')
    const modeBtn = document.getElementById('scannerModeToggle')
    const video = document.getElementById('scannerVideo')
    
    if (scannerMode === 'camera') {
        scannerMode = 'manual'
        manual.classList.remove('hidden')
        modeBtn.textContent = '📷'
        modeBtn.classList.add('active')
        if (barcodeStream) {
            barcodeStream.getTracks().forEach(track => track.stop())
            barcodeStream = null
        }
        video.srcObject = null
        document.getElementById('manualBarcodeInput').focus()
    } else {
        scannerMode = 'camera'
        manual.classList.add('hidden')
        modeBtn.textContent = '⌨️'
        modeBtn.classList.remove('active')
        const scanner = document.getElementById('barcodeScanner')
        scanner.classList.add('hidden')
        toggleBarcodeScanner()
    }
}

async function handleManualBarcode() {
    const input = document.getElementById('manualBarcodeInput')
    const barcode = input.value.trim()
    if (!barcode) return
    
    if (navigator.vibrate) navigator.vibrate(200)
    const found = await searchByBarcode(barcode)
    
    if (found) {
        closeBarcodeScanner()
    } else {
        const scanner = document.getElementById('barcodeScanner')
        scanner.classList.add('not-found')
        input.value = ''
        setTimeout(() => scanner.classList.remove('not-found'), 900)
    }
}

async function toggleFlash() {
    if (!barcodeStream) return
    const track = barcodeStream.getVideoTracks()[0]
    if (!track) return
    try {
        scannerFlashOn = !scannerFlashOn
        await track.applyConstraints({ torch: scannerFlashOn })
        document.getElementById('flashToggle').classList.toggle('active', scannerFlashOn)
    } catch (error) {
        console.error('Torch not supported:', error)
        scannerFlashOn = false
        document.getElementById('flashToggle').classList.remove('active')
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
        document.getElementById('zoomToggle').textContent = scannerZoom + '×'
    } catch (error) {
        console.error('Zoom not supported:', error)
        scannerZoom = 1
        document.getElementById('zoomToggle').textContent = '1×'
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
    scanner.classList.add('hidden')
    scanner.classList.remove('not-found')
    const manual = document.getElementById('scannerManual')
    if (manual) manual.classList.add('hidden')
}

async function searchByBarcode(barcode) {
    try {
        const response = await fetch(`${CONFIG.supabaseUrl}/rest/v1/products?barcode=eq.${encodeURIComponent(barcode)}&select=*`, {
            headers: {
                'apikey': CONFIG.supabaseAnonKey,
                'Authorization': `Bearer ${CONFIG.supabaseAnonKey}`
            }
        })

        const products = await response.json()

        if (products.length > 0) {
            openProductModal(products[0].id)
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
    if (!show) {
        loading.classList.add('hidden')
        catalog.classList.remove('skeleton-mode')
        return
    }
    loading.classList.add('hidden')
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
    errorEl.textContent = message
    errorEl.classList.remove('hidden')
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

// Service Worker (обход кеша GitHub Pages)
function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js')
            .then(() => {
                if (navigator.serviceWorker.controller) {
                    navigator.serviceWorker.addEventListener('controllerchange', () => location.reload())
                }
            })
            .catch((error) => console.error('Service Worker registration failed:', error))
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    init()
    registerServiceWorker()
})
