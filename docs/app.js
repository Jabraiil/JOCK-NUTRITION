const CONFIG = {
    // Замените на реальные значения из вашего Supabase проекта
    supabaseUrl: 'https://YOUR_PROJECT_ID.supabase.co',
    supabaseAnonKey: 'YOUR_ANON_KEY',
    orderFunctionUrl: 'https://YOUR_PROJECT_ID.supabase.co/functions/v1/create-order',
    adminApiUrl: 'https://YOUR_PROJECT_ID.supabase.co/functions/v1/admin-api'
}

let allProducts = []
let cart = JSON.parse(localStorage.getItem('jack-cart') || '[]')
let darkMode = localStorage.getItem('jack-theme') === 'dark'
let barcodeStream = null
let barcodeDetector = null

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
    document.getElementById('closeScanner').addEventListener('click', closeBarcodeScanner)
    document.getElementById('cartBtn').addEventListener('click', openCart)
    document.getElementById('checkoutBtn').addEventListener('click', checkout)

    document.getElementById('categoryFilter').addEventListener('change', applyFilters)
    document.getElementById('brandFilter').addEventListener('change', applyFilters)
    document.getElementById('priceFrom').addEventListener('input', debounce(applyFilters, 500))
    document.getElementById('priceTo').addEventListener('input', debounce(applyFilters, 500))
    document.getElementById('sortFilter').addEventListener('change', applyFilters)
    document.getElementById('resetFilters').addEventListener('click', resetFilters)

    document.querySelector('.modal-close').addEventListener('click', closeModal)
    document.getElementById('productModal').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeModal()
    })
    document.getElementById('cartModal').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeCart()
    })
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
        
        <button class="btn btn-primary btn-block add-to-cart-modal" data-id="${product.id}">
            В корзину
        </button>
    `

    document.querySelector('.add-to-cart-modal').addEventListener('click', () => {
        addToCart(product.id, 1)
        closeModal()
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
        try {
            if (!('BarcodeDetector' in window)) {
                alert('Ваш браузер не поддерживает сканирование штрих-кодов. Используйте Chrome.')
                return
            }
            
            const stream = await navigator.mediaDevices.getUserMedia({ 
                video: { facingMode: 'environment' } 
            })
            video.srcObject = stream
            barcodeStream = stream
            
            const detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'code_128', 'qr_code'] })
            barcodeDetector = detector
            
            scanner.classList.remove('hidden')
            
            detectBarcode()
        } catch (error) {
            alert('Ошибка доступа к камере')
            console.error(error)
        }
    } else {
        closeBarcodeScanner()
    }
}

async function detectBarcode() {
    if (!barcodeStream) return
    
    const video = document.getElementById('scannerVideo')
    
    async function detect() {
        if (!barcodeStream) return
        
        try {
            const barcodes = await barcodeDetector.detect(video)
            if (barcodes.length > 0) {
                const barcode = barcodes[0].rawValue
                searchByBarcode(barcode)
                closeBarcodeScanner()
                return
            }
        } catch (error) {
            console.error('Barcode detection error:', error)
        }
        
        requestAnimationFrame(detect)
    }
    
    detect()
}

function closeBarcodeScanner() {
    if (barcodeStream) {
        barcodeStream.getTracks().forEach(track => track.stop())
        barcodeStream = null
    }
    document.getElementById('barcodeScanner').classList.add('hidden')
}

async function searchByBarcode(barcode) {
    showLoading(true)
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
        } else {
            alert('Товар не найден')
        }
    } catch (error) {
        alert('Ошибка поиска по штрих-коду')
        console.error(error)
    } finally {
        showLoading(false)
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

// Initialize
document.addEventListener('DOMContentLoaded', init)
