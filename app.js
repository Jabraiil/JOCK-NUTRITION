const CONFIG = {
    supabaseUrl: 'https://hpphfeojjejculvdundj.supabase.co',
    supabaseAnonKey: 'sb_publishable_1EGpjPEw9gU2W5OKL-gFIQ_x4Gvger1',
    orderFunctionUrl: 'https://hpphfeojjejculvdundj.supabase.co/functions/v1/create-order',
    adminApiUrl: 'https://hpphfeojjejculvdundj.supabase.co/functions/v1/admin-api'
}

let allProducts = []
let relatedMap = []
let cart = JSON.parse(localStorage.getItem('jack-cart') || '[]')
let darkMode = localStorage.getItem('jack-theme') === 'dark'
let barcodeStream = null
let barcodeDetector = null
let scannerFlashOn = false

function init() {
    applyTheme()
    loadSettings()
    loadProducts()
    updateCartCount()
    setupEventListeners()
    checkOrderTime()
    setInterval(checkOrderTime, 60000)
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
    document.getElementById('cartBtn').addEventListener('click', openCart)
    document.getElementById('checkoutBtn').addEventListener('click', checkout)

    // Filters (modal)
    document.getElementById('filterToggle').addEventListener('click', openFilters)
    document.getElementById('applyFilters').addEventListener('click', () => {
        applyFilters()
        closeFilters()
    })
    document.getElementById('resetFilters').addEventListener('click', resetFilters)
    document.getElementById('filterModalClose').addEventListener('click', closeFilters)
    document.getElementById('filterModal').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeFilters()
    })
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
    document.getElementById('cartModal').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeCart()
    })
}

function openFilters() {
    document.getElementById('filterModal').classList.remove('hidden')
}

function closeFilters() {
    document.getElementById('filterModal').classList.add('hidden')
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
    const query = e.target.value.toLowerCase()
    filterAndRenderProducts({ search: query })
}

function clearSearch() {
    document.getElementById('searchInput').value = ''
    applyFilters()
}

async function loadSettings() {
    try {
        const response = await fetch(`${CONFIG.adminApiUrl}/settings`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('admin-token') || ''}` }
        })
        if (response.ok) {
            const settings = await response.json()
            CONFIG.whatsappNumber = settings.whatsapp_number || ''
            CONFIG.storeName = settings.store_name || 'JACK NUTRITION'
            CONFIG.currency = settings.currency || '₽'
        }
    } catch (error) {
        console.error('Error loading settings:', error)
    }
}

async function loadProducts() {
    showLoading(true)
    try {
        const response = await fetch(`${CONFIG.supabaseUrl}/rest/v1/products?is_visible=eq.true&select=*,categories(name),brands(name),product_images(*),product_links(*)`, {
            headers: {
                'apikey': CONFIG.supabaseAnonKey,
                'Authorization': `Bearer ${CONFIG.supabaseAnonKey}`
            }
        })

        if (!response.ok) throw new Error('Failed to load products')

        allProducts = await response.json()

        // Load explicit related products
        try {
            const relatedRes = await fetch(`${CONFIG.supabaseUrl}/rest/v1/product_related?select=product_id,related_id`, {
                headers: {
                    'apikey': CONFIG.supabaseAnonKey,
                    'Authorization': `Bearer ${CONFIG.supabaseAnonKey}`
                }
            })
            if (relatedRes.ok) {
                relatedMap = await relatedRes.json()
            }
        } catch (e) {
            console.error('Error loading related products:', e)
        }
        
        // Load categories and brands for filters
        await loadFilters()
        
        renderProducts(allProducts)
    } catch (error) {
        showError('Ошибка загрузки товаров')
        console.error(error)
    } finally {
        showLoading(false)
    }
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
            categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('')

        const brandSelect = document.getElementById('brandFilter')
        brandSelect.innerHTML = '<option value="">Все</option>' +
            brands.map(b => `<option value="${b.id}">${b.name}</option>`).join('')
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

    if (filters.priceFrom) {
        filtered = filtered.filter(p => p.price >= parseInt(filters.priceFrom))
    }

    if (filters.priceTo) {
        filtered = filtered.filter(p => p.price <= parseInt(filters.priceTo))
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

    renderProducts(filtered)
}

function applyFilters() {
    const filters = {
        search: document.getElementById('searchInput').value,
        category: document.getElementById('categoryFilter').value,
        brand: document.getElementById('brandFilter').value,
        priceFrom: document.getElementById('priceFrom').value,
        priceTo: document.getElementById('priceTo').value,
        sort: document.getElementById('sortFilter').value
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
    applyFilters()
}

function renderProducts(products) {
    const catalog = document.getElementById('catalog')
    
    if (products.length === 0) {
        catalog.innerHTML = '<div class="loading">Товары не найдены</div>'
        return
    }

    catalog.innerHTML = products.map(product => {
        const mainImage = product.product_images?.find(img => img.is_main) || product.product_images?.[0]
        const imageUrl = mainImage?.url || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect fill="%23f0f0f0" width="200" height="200"/><text fill="%23999" font-family="sans-serif" font-size="14" x="50%" y="50%" text-anchor="middle" dy=".3em">Нет фото</text></svg>'
        
        const cartItem = cart.find(c => c.id === product.id)
        const inCart = cartItem ? cartItem.quantity : 0

        return `
            <div class="product-card" data-id="${product.id}">
                <img src="${imageUrl}" alt="${product.name}" class="product-image" loading="lazy">
                <div class="product-info">
                    <div class="product-brand">${product.brands?.name || ''}</div>
                    <div class="product-name">${product.name}</div>
                    <div class="product-volume">${product.volume || ''}</div>
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
    }).join('')

    // Add event listeners
    document.querySelectorAll('.product-card').forEach(card => {
        card.addEventListener('click', (e) => {
            if (!e.target.closest('button')) {
                const productId = card.dataset.id
                openProductModal(productId)
            }
        })
    })

    document.querySelectorAll('.add-to-cart').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation()
            const productId = btn.dataset.id
            addToCart(productId, 1)
        })
    })

    document.querySelectorAll('.cart-plus').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation()
            const productId = btn.dataset.id
            addToCart(productId, 1)
        })
    })

    document.querySelectorAll('.cart-minus').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation()
            const productId = btn.dataset.id
            addToCart(productId, -1)
        })
    })
}

function openProductModal(productId) {
    const product = allProducts.find(p => p.id === productId)
    if (!product) return

    const mainImage = product.product_images?.find(img => img.is_main) || product.product_images?.[0]
    const imageUrl = mainImage?.url || ''

    const modalBody = document.getElementById('modalBody')
    modalBody.innerHTML = `
        ${imageUrl ? '<img src="' + imageUrl + '" alt="' + product.name + '">' : ''}
        <div class="modal-brand">${product.brands?.name || ''}</div>
        <h2>${product.name}</h2>
        <div class="modal-volume">${product.volume || ''}</div>
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
                <p>${product.full_description}</p>
            </div>
        ` : ''}
        
        ${product.composition ? `
            <div class="modal-section">
                <h3>Состав</h3>
                <p>${product.composition}</p>
            </div>
        ` : ''}
        
        ${product.dosage ? `
            <div class="modal-section">
                <h3>Дозировка</h3>
                <p>${product.dosage}</p>
            </div>
        ` : ''}
        
        ${product.usage ? `
            <div class="modal-section">
                <h3>Способ применения</h3>
                <p>${product.usage}</p>
            </div>
        ` : ''}
        
        ${product.contraindications ? `
            <div class="modal-section">
                <h3>Противопоказания</h3>
                <p>${product.contraindications}</p>
            </div>
        ` : ''}
        
        ${product.shelf_life ? `
            <div class="modal-section">
                <h3>Срок годности</h3>
                <p>${product.shelf_life}</p>
            </div>
        ` : ''}

        ${product.product_links?.length ? `
            <div class="modal-section">
                <h3>Ссылки</h3>
                <div class="modal-links">
                    ${product.product_links.map(link => `
                        <a href="${link.url}" target="_blank" rel="noopener noreferrer" class="modal-link">
                            ${link.title || link.url}
                        </a>
                    `).join('')}
                </div>
            </div>
        ` : ''}

        ${(() => {
            // Явные связи из product_related, иначе фолбэк по категории/бренду
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
                                    ${rUrl ? `<img src="${rUrl}" alt="${r.name}" loading="lazy">` : ''}
                                    <div class="related-name">${r.name}</div>
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

    document.querySelector('.add-to-cart-modal').addEventListener('click', () => {
        addToCart(product.id, 1)
        closeModal()
    })

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
    renderProducts(allProducts)
}

function saveCart() {
    localStorage.setItem('jack-cart', JSON.stringify(cart))
}

function updateCartCount() {
    const count = cart.reduce((sum, c) => sum + c.quantity, 0)
    document.getElementById('cartCount').textContent = count
}

function openCart() {
    renderCart()
    document.getElementById('cartModal').classList.remove('hidden')
}

function closeCart() {
    document.getElementById('cartModal').classList.add('hidden')
}

function renderCart() {
    const cartItems = document.getElementById('cartItems')
    const cartTotal = document.getElementById('cartTotal')

    if (cart.length === 0) {
        cartItems.innerHTML = '<p style="text-align: center; color: var(--text-secondary); padding: 20px;">Корзина пуста</p>'
        cartTotal.textContent = '0 ₽'
        return
    }

    let total = 0
    cartItems.innerHTML = cart.map(cartItem => {
        const product = allProducts.find(p => p.id === cartItem.id)
        if (!product) return ''

        const itemTotal = product.price * cartItem.quantity
        total += itemTotal

        return `
            <div class="cart-item">
                <img src="${product.product_images?.[0]?.url || ''}" alt="${product.name}" class="cart-item-image">
                <div class="cart-item-info">
                    <div class="cart-item-name">${product.name}</div>
                    <div class="cart-item-price">${product.price} ₽ × ${cartItem.quantity} = ${itemTotal} ₽</div>
                    <div class="cart-item-controls">
                        <button class="cart-minus" data-id="${product.id}">-</button>
                        <span>${cartItem.quantity}</span>
                        <button class="cart-plus" data-id="${product.id}">+</button>
                        <button class="cart-item-remove" data-id="${product.id}">Удалить</button>
                    </div>
                </div>
            </div>
        `
    }).join('')

    cartTotal.textContent = `${total} ₽`

    // Add event listeners
    document.querySelectorAll('.cart-plus').forEach(btn => {
        btn.addEventListener('click', () => addToCart(btn.dataset.id, 1))
    })
    document.querySelectorAll('.cart-minus').forEach(btn => {
        btn.addEventListener('click', () => addToCart(btn.dataset.id, -1))
    })
    document.querySelectorAll('.cart-item-remove').forEach(btn => {
        btn.addEventListener('click', () => {
            cart = cart.filter(c => c.id !== btn.dataset.id)
            saveCart()
            updateCartCount()
            renderCart()
            renderProducts(allProducts)
        })
    })
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

        const data = await response.json()

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
            window.open(data.whatsappUrl, '_blank')
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
    
    try {
        const response = await fetch(`${CONFIG.adminApiUrl}/settings`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('admin-token') || ''}` }
        })
        
        if (response.ok) {
            const settings = await response.json()
            const timeLimitEnabled = settings.order_time_limit_enabled === 'true'
            
            if (!timeLimitEnabled) {
                checkoutBtn.disabled = false
                timeMessage.classList.add('hidden')
                return
            }
            
            const startHour = parseInt(settings.order_start_hour || '9')
            const endHour = parseInt(settings.order_end_hour || '20')
            const timezone = settings.timezone || 'Europe/Moscow'
            
            const now = new Date()
            const formatter = new Intl.DateTimeFormat('ru-RU', {
                timeZone: timezone,
                hour: 'numeric',
                hour12: false,
            })
            const currentHour = parseInt(formatter.format(now))
            
            if (currentHour < startHour || currentHour >= endHour) {
                checkoutBtn.disabled = true
                timeMessage.textContent = 'Заказы принимаются с 9:00 до 20:00. Добавьте товары в корзину и оформите заказ утром.'
                timeMessage.classList.remove('hidden')
            } else {
                checkoutBtn.disabled = false
                timeMessage.classList.add('hidden')
            }
        }
    } catch (error) {
        console.error('Error checking order time:', error)
    }
}

// Barcode Scanner
async function toggleBarcodeScanner() {
    const scanner = document.getElementById('barcodeScanner')
    const video = document.getElementById('scannerVideo')

    if (scanner.classList.contains('hidden')) {
        scanner.classList.remove('hidden')
        scannerFlashOn = false
        try {
            if (!('BarcodeDetector' in window)) {
                console.warn('BarcodeDetector не поддерживается этим браузером')
                return
            }

            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment', torch: false }
            })
            video.srcObject = stream
            barcodeStream = stream

            // Ждём метаданные и реальные кадры, иначе detect получает пустой кадр
            await new Promise((resolve) => {
                if (video.readyState >= 1 && video.videoWidth > 0) return resolve()
                video.onloadedmetadata = () => resolve()
                setTimeout(resolve, 1500)
            })

            try { await video.play() } catch (e) { console.error('video.play error:', e) }

            // Ждём первый реальный кадр
            await new Promise((resolve) => {
                if (video.videoWidth > 0) return resolve()
                const check = () => {
                    if (video.videoWidth > 0) resolve()
                    else requestAnimationFrame(check)
                }
                check()
            })

            const detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'code_128', 'qr_code'] })
            barcodeDetector = detector

            detectBarcode()
        } catch (error) {
            console.error('Camera unavailable:', error)
        }
    } else {
        closeBarcodeScanner()
    }
}

async function detectBarcode() {
    if (!barcodeStream) return

    const video = document.getElementById('scannerVideo')
    const scanner = document.getElementById('barcodeScanner')
    const frame = document.querySelector('.scanner-frame')

    // Offscreen canvas — сканируем ТОЛЬКО область внутри рамки (легче для CPU, точнее)
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    const SCAN_MAX = 480

    let busy = false

    // Переводит прямоугольник рамки (в CSS-пикселях экрана) в координаты
    // исходного кадра видео с учётом object-fit: cover.
    function getScanCrop() {
        const vRect = video.getBoundingClientRect()
        const fRect = frame.getBoundingClientRect()
        const vw = video.videoWidth
        const vh = video.videoHeight
        if (!vw || !vh) return null

        // visible-часть видео (cover) в CSS-пикселях
        const scale = Math.max(vRect.width / vw, vRect.height / vh)
        const dispW = vw * scale
        const dispH = vh * scale
        const offX = (vRect.width - dispW) / 2
        const offY = (vRect.height - dispH) / 2

        // рамка относительно video-элемента
        const fx = (fRect.left - vRect.left - offX) / scale
        const fy = (fRect.top - vRect.top - offY) / scale
        const fw = fRect.width / scale
        const fh = fRect.height / scale

        // небольшой padding вокруг рамки
        const pad = Math.min(fw, fh) * 0.08
        const x = Math.max(0, Math.floor(fx - pad))
        const y = Math.max(0, Math.floor(fy - pad))
        const w = Math.min(vw - x, Math.ceil(fw + pad * 2))
        const h = Math.min(vh - y, Math.ceil(fh + pad * 2))
        return { x, y, w, h }
    }

    async function loop() {
        if (!barcodeStream) return

        if (video.readyState >= 2 && video.videoWidth > 0 && !busy) {
            busy = true
            try {
                const crop = getScanCrop()
                if (crop && crop.w > 0 && crop.h > 0) {
                    const scale = SCAN_MAX / crop.w
                    canvas.width = SCAN_MAX
                    canvas.height = Math.max(1, Math.round(crop.h * scale))
                    ctx.drawImage(
                        video,
                        crop.x, crop.y, crop.w, crop.h,
                        0, 0, canvas.width, canvas.height
                    )

                    const barcodes = await barcodeDetector.detect(canvas)
                    if (barcodes.length > 0) {
                        const barcode = barcodes[0].rawValue

                        if (navigator.vibrate) navigator.vibrate(200)

                        const found = await searchByBarcode(barcode)

                        if (found) {
                            closeBarcodeScanner()
                        } else {
                            scanner.classList.add('not-found')
                            setTimeout(() => closeBarcodeScanner(), 900)
                        }
                        return
                    }
                }
            } catch (error) {
                console.error('Barcode detection error:', error)
            } finally {
                busy = false
            }
        }

        // Throttle: следующая попытка через ~150мс (не на каждом кадре)
        setTimeout(loop, 150)
    }

    loop()
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
    if (barcodeStream) {
        barcodeStream.getTracks().forEach(track => track.stop())
        barcodeStream = null
    }
    scannerZoom = 1
    const zoomBtn = document.getElementById('zoomToggle')
    if (zoomBtn) zoomBtn.textContent = '1×'
    const scanner = document.getElementById('barcodeScanner')
    scanner.classList.add('hidden')
    scanner.classList.remove('not-found')
}

async function searchByBarcode(barcode) {
    try {
        const response = await fetch(`${CONFIG.supabaseUrl}/rest/v1/products?barcode=eq.${barcode}&select=*`, {
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
    document.getElementById('loading').classList.toggle('hidden', !show)
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
