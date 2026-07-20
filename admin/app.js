// ============================================
// Admin Panel JavaScript
// ============================================

const CONFIG = {
    supabaseUrl: 'https://hpphfeojjejculvdundj.supabase.co',
    supabaseAnonKey: 'sb_publishable_1EGpjPEw9gU2W5OKL-gFIQ_x4Gvger1',
    adminApiUrl: 'https://hpphfeojjejculvdundj.supabase.co/functions/v1/admin-api',
    orderFunctionUrl: 'https://hpphfeojjejculvdundj.supabase.co/functions/v1/create-order'
}

let supabase = null
let currentPage = 'products'
let editingProductId = null
let productImages = []
let productLinks = []
let allProductsList = []
let monitorInterval = null
let salesChart = null
let productsPage = 1
let productsTotal = 0
const PRODUCTS_PER_PAGE = 20
let ordersPage = 1
let ordersTotal = 0
const ORDERS_PER_PAGE = 50

function handleAuthError(message) {
    localStorage.removeItem('admin-token')
    showAuthPage()
    const errorEl = document.getElementById('loginError')
    if (errorEl) {
        errorEl.textContent = message || 'Сессия истекла. Войдите снова.'
        errorEl.classList.remove('hidden')
    }
}

function translateError(message) {
    if (!message) return 'Неизвестная ошибка'
    const lower = message.toLowerCase()
    if (lower.includes('unauthorized') || lower.includes('jwt expired') || lower.includes('token has expired')) return 'Сессия истекла. Войдите снова.'
    if (lower.includes('forbidden')) return 'Доступ запрещён'
    if (lower.includes('duplicate key') || lower.includes('unique constraint')) return 'Такой товар уже существует'
    if (lower.includes('foreign key')) return 'Ошибка связи с другими данными'
    if (lower.includes('invalid input syntax')) return 'Некорректный формат данных'
    if (lower.includes('null value') || lower.includes('not null constraint')) return 'Обязательное поле не заполнено'
    if (lower.includes('row-level security') || lower.includes('rls')) return 'Нет прав на эту операцию'
    if (lower.includes('invalid login credentials') || lower.includes('invalid_login_credentials') || lower.includes('invalid signin credentials')) return 'Неверный email или пароль'
    if (lower.includes('email not confirmed') || lower.includes('email_not_confirmed')) return 'Email не подтверждён'
    if (lower.includes('too many requests')) return 'Слишком много запросов. Подождите немного.'
    if (lower.includes('network') || lower.includes('fetch')) return 'Ошибка сети. Проверьте подключение к интернету.'
    if (lower.includes('user not found') || lower.includes('user_not_found')) return 'Пользователь не найден'
    if (lower.includes('password too short') || lower.includes('password_too_short')) return 'Пароль слишком короткий'
    if (lower.includes('same password')) return 'Новый пароль должен отличаться от старого'
    return message
}

function init() {
    const hash = window.location.hash
    if (hash.includes('access_token=')) {
        const params = new URLSearchParams(hash.substring(1))
        const accessToken = params.get('access_token')
        const refreshToken = params.get('refresh_token')
        if (accessToken) {
            localStorage.setItem('admin-token', accessToken)
            if (refreshToken) {
                localStorage.setItem('admin-refresh-token', refreshToken)
            }
            const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
            if (isLocalhost) {
                const productionUrl = 'https://jabraiil.github.io/JOCK-NUTRITION/admin/'
                window.location.href = productionUrl + hash
                return
            }
            window.location.hash = ''
        }
    }

    const token = localStorage.getItem('admin-token')
    
    applyTheme()

    if (token) {
        showAdminPage()
        loadPageData(currentPage)
    } else {
        showAuthPage()
    }

    setupEventListeners()
    startMonitor()
}

function applyTheme() {
    const darkMode = localStorage.getItem('jack-theme') === 'dark'
    if (darkMode) {
        document.documentElement.setAttribute('data-theme', 'dark')
    } else {
        document.documentElement.removeAttribute('data-theme')
    }
}

function toggleTheme() {
    const darkMode = localStorage.getItem('jack-theme') === 'dark'
    localStorage.setItem('jack-theme', darkMode ? 'light' : 'dark')
    applyTheme()
}

function setupEventListeners() {
    // Theme
    const themeToggle = document.getElementById('themeToggle')
    if (themeToggle) themeToggle.addEventListener('click', toggleTheme)

    // Login
    document.getElementById('loginForm').addEventListener('submit', handleLogin)
    document.getElementById('forgotPassword').addEventListener('click', handleForgotPassword)
    document.getElementById('logoutBtn').addEventListener('click', handleLogout)

    // Mobile hamburger
    const sidebar = document.querySelector('.sidebar')
    const sidebarOverlay = document.getElementById('sidebarOverlay')
    const toggleSidebar = (open) => {
        sidebar.classList.toggle('open', open)
        sidebarOverlay.classList.toggle('open', open)
    }
    document.getElementById('hamburgerBtn').addEventListener('click', () => {
        toggleSidebar(!sidebar.classList.contains('open'))
    })
    sidebarOverlay.addEventListener('click', () => toggleSidebar(false))

    // Navigation
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            const page = item.dataset.page
            switchPage(page)
            toggleSidebar(false)
        })
    })

    // Products
    document.getElementById('addProductBtn').addEventListener('click', () => openProductModal())
    document.getElementById('productSearch').addEventListener('input', debounce(() => { productsPage = 1; loadProducts() }, 300))
    document.getElementById('cancelProduct').addEventListener('click', closeProductModal)
    document.getElementById('productForm').addEventListener('submit', handleProductSubmit)
    document.getElementById('addLinkBtn').addEventListener('click', addLinkField)

    // Categories
    document.getElementById('addCategoryBtn').addEventListener('click', openCategoryModal)

    // Brands
    document.getElementById('addBrandBtn').addEventListener('click', openBrandModal)

    // Analytics
    document.getElementById('analyticsPeriod').addEventListener('change', () => { ordersPage = 1; loadAnalytics() })

    // Settings
    document.getElementById('settingsForm').addEventListener('submit', handleSettingsSave)
    document.getElementById('changePasswordForm').addEventListener('submit', handleChangePassword)

    // Import/Export
    document.getElementById('importFileBtn').addEventListener('click', () => document.getElementById('importFile').click())
    document.getElementById('importFile').addEventListener('change', handleImportFileSelect)
    document.getElementById('importBtn').addEventListener('click', handleImport)
    document.getElementById('exportBtn').addEventListener('click', handleExport)
    document.getElementById('backupBtn').addEventListener('click', handleBackup)
    document.getElementById('backupSqlBtn').addEventListener('click', handleBackupSql)

    // Modal
    document.querySelector('.modal-close').addEventListener('click', closeProductModal)
    document.getElementById('nameModalClose').addEventListener('click', closeNameModal)
    document.getElementById('nameModalCancel').addEventListener('click', closeNameModal)
    document.getElementById('nameModalForm').addEventListener('submit', async (e) => {
        e.preventDefault()
        const value = document.getElementById('nameModalInput').value.trim()
        if (nameModalResolve) {
            nameModalResolve(value)
            nameModalResolve = null
        }
        document.getElementById('nameModal').classList.add('hidden')
        document.getElementById('nameModalInput').value = ''
    })
}

function showAuthPage() {
    document.getElementById('authPage').classList.remove('hidden')
    document.getElementById('adminPage').classList.add('hidden')
}

function showAdminPage() {
    document.getElementById('authPage').classList.add('hidden')
    document.getElementById('adminPage').classList.remove('hidden')
}

async function handleLogin(e) {
    e.preventDefault()
    
    const email = document.getElementById('loginEmail').value
    const password = document.getElementById('loginPassword').value
    const errorEl = document.getElementById('loginError')
    
    errorEl.classList.add('hidden')
    
    try {
        const response = await fetch(`${CONFIG.supabaseUrl}/auth/v1/token?grant_type=password`, {
            method: 'POST',
            headers: {
                'apikey': CONFIG.supabaseAnonKey,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email, password })
        })
        
        const data = await response.json()
        
        if (response.ok && data.access_token) {
            localStorage.setItem('admin-token', data.access_token)
            showAdminPage()
            loadPageData('products')
        } else {
            const errorMessage = data.msg || data.error || data.error_description || 'Неверный email или пароль'
            throw new Error(translateError(errorMessage))
        }
    } catch (error) {
        errorEl.textContent = translateError(error.message)
        errorEl.classList.remove('hidden')
    }
}

async function handleForgotPassword() {
    const email = prompt('Введите email для сброса пароля:')
    if (!email) return
    
    try {
        const response = await fetch(`${CONFIG.supabaseUrl}/auth/v1/recover`, {
            method: 'POST',
            headers: {
                'apikey': CONFIG.supabaseAnonKey,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email, redirect_to: 'https://jabraiil.github.io/JOCK-NUTRITION/admin/' })
        })
        
        if (response.ok) {
            alert('Письмо для сброса пароля отправлено на почту')
        } else {
            const result = await response.json().catch(() => ({}))
            alert(translateError(result.msg || result.error || result.error_description || 'Ошибка отправки письма'))
        }
    } catch (error) {
        alert('Ошибка: ' + translateError(error.message))
    }
}

function handleLogout() {
    localStorage.removeItem('admin-token')
    showAuthPage()
}

function switchPage(page) {
    currentPage = page
    
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.page === page)
    })
    
    document.querySelectorAll('.page').forEach(p => {
        p.classList.toggle('active', p.id === page + 'Page')
    })
    
    const titles = {
        products: 'Товары',
        categories: 'Категории',
        brands: 'Бренды',
        analytics: 'Статистика',
        settings: 'Настройки',
        import: 'Импорт',
        export: 'Экспорт',
        backup: 'Резервное копирование'
    }
    
    document.getElementById('pageTitle').textContent = titles[page] || page
    loadPageData(page)
}

async function loadPageData(page) {
    switch (page) {
        case 'products':
            await loadProducts()
            break
        case 'categories':
            await loadCategories()
            break
        case 'brands':
            await loadBrands()
            break
        case 'analytics':
            await loadAnalytics()
            break
        case 'settings':
            await loadSettings()
            break
    }
}

// ============================================
// Products
// ============================================

async function loadProducts() {
    const search = document.getElementById('productSearch').value || ''
    const params = new URLSearchParams({ limit: String(PRODUCTS_PER_PAGE), page: String(productsPage) })
    if (search) params.set('search', search)
    
    const response = await fetch(`${CONFIG.adminApiUrl}/products?${params}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('admin-token')}` }
    })
    
    if (!response.ok) {
        const result = await response.json().catch(() => ({}))
        alert(translateError(result.error) || 'Ошибка загрузки товаров')
        return
    }
    
    const { data, total } = await response.json()
    productsTotal = total || 0
    
    const tbody = document.getElementById('productsTable')
    tbody.innerHTML = data.map(product => `
        <tr>
            <td><img src="${product.product_images?.[0]?.url || ''}" alt=""></td>
            <td>${product.name}</td>
            <td>${product.categories?.name || '-'}</td>
            <td>${product.brands?.name || '-'}</td>
            <td>${product.price} ₽</td>
            <td>${product.stock}</td>
            <td>${product.is_visible ? '✅' : '❌'}</td>
            <td>
                <button class="btn btn-sm btn-secondary" onclick="editProduct('${product.id}')">✏️</button>
                <button class="btn btn-sm btn-primary" onclick="duplicateProduct('${product.id}')">⧉</button>
                <button class="btn btn-sm btn-danger" onclick="deleteProduct('${product.id}')">🗑️</button>
            </td>
        </tr>
    `).join('')
    
    renderProductsPagination()
}

function renderProductsPagination() {
    const container = document.getElementById('productsPagination')
    const totalPages = Math.max(1, Math.ceil(productsTotal / PRODUCTS_PER_PAGE))
    
    if (totalPages <= 1) {
        container.innerHTML = ''
        return
    }
    
    let html = `<button ${productsPage === 1 ? 'disabled' : ''} onclick="changeProductsPage(${productsPage - 1})">←</button>`
    
    for (let p = 1; p <= totalPages; p++) {
        html += `<button class="${p === productsPage ? 'active' : ''}" onclick="changeProductsPage(${p})">${p}</button>`
    }
    
    html += `<button ${productsPage === totalPages ? 'disabled' : ''} onclick="changeProductsPage(${productsPage + 1})">→</button>`
    container.innerHTML = html
}

function changeProductsPage(page) {
    productsPage = page
    loadProducts()
}

async function openProductModal(productId = null) {
    editingProductId = productId
    document.getElementById('modalTitle').textContent = productId ? 'Редактировать товар' : 'Добавить товар'

    document.getElementById('productForm').reset()
    productImages = []
    productLinks = []
    document.getElementById('imagePreview').innerHTML = ''
    document.getElementById('linksContainer').innerHTML = ''

    await loadFormOptions()

    if (productId) {
        const response = await fetch(`${CONFIG.adminApiUrl}/products?limit=1&page=1&search=${productId}`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('admin-token')}` }
        })
        const { data } = await response.json()
        const product = data?.find(p => p.id === productId)

        if (product) {
            document.getElementById('prodName').value = product.name || ''
            document.getElementById('prodDescription').value = product.description || ''
            document.getElementById('prodFullDescription').value = product.full_description || ''
            document.getElementById('prodComposition').value = product.composition || ''
            document.getElementById('prodDosage').value = product.dosage || ''
            document.getElementById('prodUsage').value = product.usage || ''
            document.getElementById('prodContraindications').value = product.contraindications || ''
            document.getElementById('prodCategory').value = product.category_id || ''
            document.getElementById('prodBrand').value = product.brand_id || ''
            document.getElementById('prodPrice').value = product.price ?? ''
            document.getElementById('prodOldPrice').value = product.old_price ?? ''
            document.getElementById('prodStock').value = product.stock ?? ''
            document.getElementById('prodVolume').value = product.volume || ''
            document.getElementById('prodSku').value = product.sku || ''
            document.getElementById('prodBarcode').value = product.barcode || ''
            document.getElementById('prodIsHit').checked = Boolean(product.is_hit)
            document.getElementById('prodIsNew').checked = Boolean(product.is_new)
            document.getElementById('prodIsDiscount').checked = Boolean(product.is_discount)
            document.getElementById('prodIsRelated').checked = Boolean(product.is_related_enabled)
            document.getElementById('prodShelfLife').value = product.shelf_life || ''
            document.getElementById('prodIsVisible').value = String(product.is_visible)

            productImages = Array.isArray(product.images) ? product.images.map(img => ({ ...img })) : []
            productLinks = Array.isArray(product.links) ? product.links.map(link => ({ ...link })) : []

            const preview = document.getElementById('imagePreview')
            preview.innerHTML = productImages.map(img => `<img src="${img.url}" alt="">`).join('')

            const linksContainer = document.getElementById('linksContainer')
            linksContainer.innerHTML = ''
            productLinks.forEach(link => addLinkField(link.url))

            const relatedIds = Array.isArray(product.related) ? product.related : []
            const relatedSelect = document.getElementById('prodRelated')
            Array.from(relatedSelect.options).forEach(opt => {
                opt.selected = relatedIds.includes(opt.value)
            })
        }
    }

    document.getElementById('productModal').classList.remove('hidden')
}

function closeProductModal() {
    document.getElementById('productModal').classList.add('hidden')
    editingProductId = null
}

async function loadFormOptions() {
    const [categoriesRes, brandsRes] = await Promise.all([
        fetch(`${CONFIG.adminApiUrl}/categories`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('admin-token')}` }
        }),
        fetch(`${CONFIG.adminApiUrl}/brands`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('admin-token')}` }
        })
    ])
    
    if (!categoriesRes.ok || !brandsRes.ok) {
        const result = await categoriesRes.json().catch(() => ({}))
        alert(translateError(result.error) || 'Ошибка загрузки справочников')
        return
    }
    
    const categories = await categoriesRes.json()
    const brands = await brandsRes.json()
    
    document.getElementById('prodCategory').innerHTML = 
        '<option value="">Не выбрана</option>' +
        categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('')
    
    document.getElementById('prodBrand').innerHTML = 
        '<option value="">Не выбран</option>' +
        brands.map(b => `<option value="${b.id}">${b.name}</option>`).join('')

    // Load all products for related select
    const allRes = await fetch(`${CONFIG.adminApiUrl}/products?limit=1000&page=1`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('admin-token')}` }
    })
    
    if (!allRes.ok) {
        const result = await allRes.json().catch(() => ({}))
        alert(translateError(result.error) || 'Ошибка загрузки товаров')
        return
    }
    
    const allData = await allRes.json()
    allProductsList = allData.data || []
    document.getElementById('prodRelated').innerHTML = allProductsList
        .map(p => `<option value="${p.id}">${p.name}</option>`)
        .join('')
}

async function handleProductSubmit(e) {
    e.preventDefault()
    const errorEl = document.getElementById('productError')
    errorEl.classList.add('hidden')

    try {
        const productData = {
        name: document.getElementById('prodName').value.trim(),
        description: document.getElementById('prodDescription').value.trim(),
        full_description: document.getElementById('prodFullDescription').value.trim(),
        composition: document.getElementById('prodComposition').value.trim(),
        dosage: document.getElementById('prodDosage').value.trim(),
        usage: document.getElementById('prodUsage').value.trim(),
        contraindications: document.getElementById('prodContraindications').value.trim(),
        category_id: document.getElementById('prodCategory').value || null,
        brand_id: document.getElementById('prodBrand').value || null,
        price: parseInt(document.getElementById('prodPrice').value, 10),
        old_price: document.getElementById('prodOldPrice').value ? parseInt(document.getElementById('prodOldPrice').value, 10) : null,
        stock: parseInt(document.getElementById('prodStock').value, 10),
        volume: document.getElementById('prodVolume').value.trim(),
        sku: document.getElementById('prodSku').value.trim() || null,
        barcode: document.getElementById('prodBarcode').value.trim() || null,
        is_hit: document.getElementById('prodIsHit').checked,
        is_new: document.getElementById('prodIsNew').checked,
        is_discount: document.getElementById('prodIsDiscount').checked,
        is_related_enabled: document.getElementById('prodIsRelated').checked,
        shelf_life: document.getElementById('prodShelfLife').value.trim(),
        is_visible: document.getElementById('prodIsVisible').value === 'true'
    }

    if (!productData.name) {
        errorEl.textContent = 'Введите название товара'
        errorEl.classList.remove('hidden')
        return
    }

    if (isNaN(productData.price) || productData.price < 0) {
        errorEl.textContent = 'Цена должна быть числом ≥ 0'
        errorEl.classList.remove('hidden')
        return
    }

    if (isNaN(productData.stock) || productData.stock < 0) {
        errorEl.textContent = 'Остаток должен быть числом ≥ 0'
        errorEl.classList.remove('hidden')
        return
    }

    if (productData.old_price !== null && (isNaN(productData.old_price) || productData.old_price < 0)) {
        errorEl.textContent = 'Старая цена должна быть числом ≥ 0'
        errorEl.classList.remove('hidden')
        return
    }

    const linkInputs = Array.from(document.querySelectorAll('.link-item input'))
    const urls = linkInputs.map(input => input.value.trim()).filter(Boolean)
    for (const url of urls) {
        try {
            new URL(url)
        } catch {
            errorEl.textContent = 'Некорректная ссылка: ' + url
            errorEl.classList.remove('hidden')
            return
        }
    }

    const imageInput = document.getElementById('prodImages')
    if (imageInput.files.length > 0) {
        for (const file of imageInput.files) {
            const formData = new FormData()
            formData.append('file', file)

            const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}-${file.name}`
            const uploadRes = await fetch(`${CONFIG.supabaseUrl}/storage/v1/object/product-images/${fileName}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('admin-token')}`,
                    'apikey': CONFIG.supabaseAnonKey
                },
                body: formData
            })

            if (uploadRes.ok) {
                const imageUrl = `${CONFIG.supabaseUrl}/storage/v1/object/public/product-images/${fileName}`
                productImages.push({ url: imageUrl, is_main: productImages.length === 0 })
            } else {
                const text = await uploadRes.text()
                if (uploadRes.status === 401) {
                    throw new Error('Unauthorized')
                }
                throw new Error(`Ошибка загрузки изображения: ${uploadRes.status} ${text}`)
            }
        }
    }

    productLinks = urls.slice(0, 4).map(url => ({ url, title: '' }))

    const relatedSelect = document.getElementById('prodRelated')
    const related = Array.from(relatedSelect.selectedOptions).map(opt => opt.value)

    const body = {
        ...productData,
        ...(productImages.length ? { images: productImages } : {}),
        ...(productLinks.length ? { links: productLinks } : {}),
        ...(related.length ? { related } : {})
    }

    const url = editingProductId ? `${CONFIG.adminApiUrl}/products/${editingProductId}` : `${CONFIG.adminApiUrl}/products`
    const method = editingProductId ? 'PUT' : 'POST'

    const response = await fetch(url, {
        method,
        headers: {
            'Authorization': `Bearer ${localStorage.getItem('admin-token')}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    })

    const result = response.ok ? await response.json() : await response.json().catch(() => ({}))

    if (response.ok) {
        closeProductModal()
        loadProducts()
    } else {
        if (result.error === 'Unauthorized' || result.error === 'Сессия истекла. Войдите снова.') {
            handleAuthError('Сессия истекла. Войдите снова.')
        } else {
            errorEl.textContent = translateError(result.error) || 'Ошибка сохранения товара'
            errorEl.classList.remove('hidden')
        }
    }
    } catch (err) {
        if (err.message && (err.message.includes('Unauthorized') || err.message.includes('Сессия истекла'))) {
            handleAuthError('Сессия истекла. Войдите снова.')
        } else {
            errorEl.textContent = translateError(err.message) || 'Неизвестная ошибка при сохранении'
            errorEl.classList.remove('hidden')
        }
    }
}

function addLinkField(value = '') {
    const container = document.getElementById('linksContainer')
    const div = document.createElement('div')
    div.className = 'link-item'
    div.innerHTML = `<input type="url" placeholder="https://..." value="${value}" required><button type="button" class="btn btn-sm btn-danger remove-link">×</button>`
    container.appendChild(div)

    div.querySelector('.remove-link').addEventListener('click', () => {
        div.remove()
    })
}

async function deleteProduct(id) {
    if (!confirm('Удалить товар?')) return
    
    const response = await fetch(`${CONFIG.adminApiUrl}/products/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('admin-token')}` }
    })
    
    if (response.ok) {
        loadProducts()
    }
}

function editProduct(id) {
    // Load product data and open modal
    openProductModal(id)
}

async function duplicateProduct(id) {
    editingProductId = null
    document.getElementById('modalTitle').textContent = 'Дублировать товар'
    document.getElementById('productForm').reset()
    productImages = []
    productLinks = []
    document.getElementById('imagePreview').innerHTML = ''
    document.getElementById('linksContainer').innerHTML = ''

    await loadFormOptions()

    const response = await fetch(`${CONFIG.adminApiUrl}/products?limit=1&page=1&search=${id}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('admin-token')}` }
    })
    const { data } = await response.json()
    const product = data?.find(p => p.id === id)

    if (product) {
        document.getElementById('prodName').value = product.name + ' (копия)'
        document.getElementById('prodDescription').value = product.description || ''
        document.getElementById('prodFullDescription').value = product.full_description || ''
        document.getElementById('prodComposition').value = product.composition || ''
        document.getElementById('prodDosage').value = product.dosage || ''
        document.getElementById('prodUsage').value = product.usage || ''
        document.getElementById('prodContraindications').value = product.contraindications || ''
        document.getElementById('prodCategory').value = product.category_id || ''
        document.getElementById('prodBrand').value = product.brand_id || ''
        document.getElementById('prodPrice').value = product.price ?? ''
        document.getElementById('prodOldPrice').value = product.old_price ?? ''
        document.getElementById('prodStock').value = product.stock ?? ''
        document.getElementById('prodVolume').value = product.volume || ''
        document.getElementById('prodSku').value = ''
        document.getElementById('prodBarcode').value = ''
        document.getElementById('prodIsHit').checked = Boolean(product.is_hit)
        document.getElementById('prodIsNew').checked = Boolean(product.is_new)
        document.getElementById('prodIsDiscount').checked = Boolean(product.is_discount)
        document.getElementById('prodIsRelated').checked = Boolean(product.is_related_enabled)
        document.getElementById('prodShelfLife').value = product.shelf_life || ''
        document.getElementById('prodIsVisible').value = String(product.is_visible)

        productImages = Array.isArray(product.images) ? product.images.map(img => ({ ...img })) : []
        productLinks = Array.isArray(product.links) ? product.links.map(link => ({ ...link })) : []

        document.getElementById('imagePreview').innerHTML = productImages.map(img => `<img src="${img.url}" alt="">`).join('')
        productLinks.forEach(link => addLinkField(link.url))

        // Связи при дублировании не копируем
        Array.from(document.getElementById('prodRelated').options).forEach(opt => { opt.selected = false })
    }

    document.getElementById('productModal').classList.remove('hidden')
}

// ============================================
// Categories
// ============================================

async function loadCategories() {
    const response = await fetch(`${CONFIG.adminApiUrl}/categories`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('admin-token')}` }
    })
    
    if (!response.ok) {
        const result = await response.json().catch(() => ({}))
        alert(translateError(result.error) || 'Ошибка загрузки категорий')
        return
    }
    
    const data = await response.json()
    
    document.getElementById('categoriesTable').innerHTML = data.map(cat => `
        <tr>
            <td>${cat.name}</td>
            <td>
                <button class="btn btn-sm btn-secondary" onclick="editCategory('${cat.id}')">✏️</button>
                <button class="btn btn-sm btn-danger" onclick="deleteCategory('${cat.id}')">🗑️</button>
            </td>
        </tr>
    `).join('')
}

let nameModalResolve = null

function openNameModal(title, label, value = '') {
    return new Promise((resolve) => {
        nameModalResolve = resolve
        document.getElementById('nameModalTitle').textContent = title
        document.getElementById('nameModalLabel').textContent = label
        const input = document.getElementById('nameModalInput')
        input.value = value
        document.getElementById('nameModal').classList.remove('hidden')
        setTimeout(() => input.focus(), 50)
    })
}

function closeNameModal() {
    document.getElementById('nameModal').classList.add('hidden')
    document.getElementById('nameModalInput').value = ''
    if (nameModalResolve) {
        nameModalResolve(null)
        nameModalResolve = null
    }
}

async function openCategoryModal(categoryId = null) {
    const name = await openNameModal(
        categoryId ? 'Редактировать категорию' : 'Новая категория',
        'Название категории'
    )
    if (!name) return

    const url = categoryId
        ? `${CONFIG.adminApiUrl}/categories/${categoryId}`
        : `${CONFIG.adminApiUrl}/categories`

    const method = categoryId ? 'PUT' : 'POST'

    const response = await fetch(url, {
        method,
        headers: {
            'Authorization': `Bearer ${localStorage.getItem('admin-token')}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name })
    })

    if (response.ok) {
        loadCategories()
    } else {
        const result = await response.json().catch(() => ({}))
        alert(translateError(result.error) || 'Ошибка сохранения категории')
    }
}

async function deleteCategory(id) {
    if (!confirm('Удалить категорию?')) return

    const response = await fetch(`${CONFIG.adminApiUrl}/categories/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('admin-token')}` }
    })

    if (response.ok) {
        loadCategories()
    }
}

function editCategory(id) {
    openCategoryModal(id)
}

// ============================================
// Brands
// ============================================

async function loadBrands() {
    const response = await fetch(`${CONFIG.adminApiUrl}/brands`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('admin-token')}` }
    })

    if (!response.ok) {
        const result = await response.json().catch(() => ({}))
        alert(translateError(result.error) || 'Ошибка загрузки брендов')
        return
    }

    const data = await response.json()

    document.getElementById('brandsTable').innerHTML = data.map(brand => `
        <tr>
            <td>${brand.name}</td>
            <td>
                <button class="btn btn-sm btn-secondary" onclick="editBrand('${brand.id}')">✏️</button>
                <button class="btn btn-sm btn-danger" onclick="deleteBrand('${brand.id}')">🗑️</button>
            </td>
        </tr>
    `).join('')
}

async function openBrandModal(brandId = null) {
    const name = await openNameModal(
        brandId ? 'Редактировать бренд' : 'Новый бренд',
        'Название бренда'
    )
    if (!name) return

    const url = brandId
        ? `${CONFIG.adminApiUrl}/brands/${brandId}`
        : `${CONFIG.adminApiUrl}/brands`

    const method = brandId ? 'PUT' : 'POST'

    const response = await fetch(url, {
        method,
        headers: {
            'Authorization': `Bearer ${localStorage.getItem('admin-token')}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name })
    })

    if (response.ok) {
        loadBrands()
    } else {
        const result = await response.json().catch(() => ({}))
        alert(translateError(result.error) || 'Ошибка сохранения бренда')
    }
}

async function deleteBrand(id) {
    if (!confirm('Удалить бренд?')) return

    const response = await fetch(`${CONFIG.adminApiUrl}/brands/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('admin-token')}` }
    })

    if (response.ok) {
        loadBrands()
    }
}

function editBrand(id) {
    openBrandModal(id)
}

// ============================================
// Analytics
// ============================================

async function loadAnalytics() {
    const period = document.getElementById('analyticsPeriod').value
    
    const response = await fetch(`${CONFIG.adminApiUrl}/analytics?period=${period}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('admin-token')}` }
    })
    
    if (!response.ok) {
        const result = await response.json().catch(() => ({}))
        alert(translateError(result.error) || 'Ошибка загрузки статистики')
        return
    }
    
    const data = await response.json()
    
    document.getElementById('totalRevenue').textContent = `${data.totalRevenue.toLocaleString()} ₽`
    document.getElementById('totalOrders').textContent = data.totalOrders.toLocaleString()
    
    // Top products
    document.getElementById('topProductsTable').innerHTML = data.topProducts.map(p => `
        <tr>
            <td>${p.name}</td>
            <td>${p.quantity}</td>
            <td>${p.total.toLocaleString()} ₽</td>
        </tr>
    `).join('')
    
    // Chart
    renderSalesChart(data.dailyStats)
    
    // Orders
    const ordersRes = await fetch(`${CONFIG.adminApiUrl}/orders?period=${period}&page=${ordersPage}&limit=${ORDERS_PER_PAGE}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('admin-token')}` }
    })
    
    if (!ordersRes.ok) {
        const result = await ordersRes.json().catch(() => ({}))
        alert(translateError(result.error) || 'Ошибка загрузки заказов')
        return
    }
    
    const ordersData = await ordersRes.json()
    ordersTotal = ordersData.total || 0
    
    document.getElementById('ordersTable').innerHTML = ordersData.data.map(order => `
        <tr>
            <td>${order.order_number}</td>
            <td>${order.items.map(i => `${i.name} (${i.quantity})`).join(', ')}</td>
            <td>${order.total.toLocaleString()} ₽</td>
            <td>${new Date(order.created_at).toLocaleString('ru-RU')}</td>
        </tr>
    `).join('')
    
    renderOrdersPagination()
}

function renderOrdersPagination() {
    const container = document.getElementById('ordersPagination')
    const totalPages = Math.max(1, Math.ceil(ordersTotal / ORDERS_PER_PAGE))
    
    if (totalPages <= 1) {
        container.innerHTML = ''
        return
    }
    
    let html = `<button ${ordersPage === 1 ? 'disabled' : ''} onclick="changeOrdersPage(${ordersPage - 1})">←</button>`
    
    for (let p = 1; p <= totalPages; p++) {
        html += `<button class="${p === ordersPage ? 'active' : ''}" onclick="changeOrdersPage(${p})">${p}</button>`
    }
    
    html += `<button ${ordersPage === totalPages ? 'disabled' : ''} onclick="changeOrdersPage(${ordersPage + 1})">→</button>`
    container.innerHTML = html
}

function changeOrdersPage(page) {
    ordersPage = page
    loadAnalytics()
}

function renderSalesChart(dailyStats) {
    const ctx = document.getElementById('salesChart').getContext('2d')
    
    if (salesChart) {
        salesChart.destroy()
    }
    
    salesChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: dailyStats.map(d => d.date),
            datasets: [{
                label: 'Выручка',
                data: dailyStats.map(d => d.total),
                borderColor: '#2563eb',
                backgroundColor: 'rgba(37, 99, 235, 0.1)',
                tension: 0.3,
                fill: true
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: value => value.toLocaleString() + ' ₽'
                    }
                }
            }
        }
    })
}

// ============================================
// Settings
// ============================================

async function loadSettings() {
    const response = await fetch(`${CONFIG.adminApiUrl}/settings`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('admin-token')}` }
    })
    
    if (!response.ok) {
        const result = await response.json().catch(() => ({}))
        alert(translateError(result.error) || 'Ошибка загрузки настроек')
        return
    }
    
    const settings = await response.json()
    
    document.getElementById('whatsappNumber').value = settings.whatsapp_number || ''
    document.getElementById('storeName').value = settings.store_name || ''
    document.getElementById('logoText').value = settings.logo_text || ''
    document.getElementById('timezone').value = settings.timezone || 'Europe/Moscow'
    document.getElementById('orderTimeLimitEnabled').checked = settings.order_time_limit_enabled === 'true'
    document.getElementById('orderStartHour').value = settings.order_start_hour || '09:00'
    document.getElementById('orderEndHour').value = settings.order_end_hour || '20:00'
    document.getElementById('orderErrorCode').value = settings.order_error_code || '[!CHECK!]'
    document.getElementById('currency').value = settings.currency || '₽'
    document.getElementById('orderTemplate').value = settings.order_template || ''
}

async function handleSettingsSave(e) {
    e.preventDefault()
    
    const settings = {
        whatsapp_number: document.getElementById('whatsappNumber').value,
        store_name: document.getElementById('storeName').value,
        logo_text: document.getElementById('logoText').value,
        timezone: document.getElementById('timezone').value,
        order_time_limit_enabled: document.getElementById('orderTimeLimitEnabled').checked ? 'true' : 'false',
        order_start_hour: document.getElementById('orderStartHour').value.split(':')[0],
        order_end_hour: document.getElementById('orderEndHour').value.split(':')[0],
        order_error_code: document.getElementById('orderErrorCode').value,
        currency: document.getElementById('currency').value,
        order_template: document.getElementById('orderTemplate').value
    }
    
    const response = await fetch(`${CONFIG.adminApiUrl}/settings`, {
        method: 'PUT',
        headers: {
            'Authorization': `Bearer ${localStorage.getItem('admin-token')}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(settings)
    })
    
    if (response.ok) {
        alert('Настройки сохранены')
    } else {
        const result = await response.json().catch(() => ({}))
        alert(translateError(result.error) || 'Ошибка сохранения настроек')
    }
}

async function handleChangePassword(e) {
    e.preventDefault()
    
    const currentPassword = document.getElementById('currentPassword').value
    const newPassword = document.getElementById('newPassword').value
    const confirmPassword = document.getElementById('confirmPassword').value
    
    if (newPassword !== confirmPassword) {
        alert('Пароли не совпадают')
        return
    }
    
    try {
        const response = await fetch(`${CONFIG.supabaseUrl}/auth/v1/user`, {
            method: 'PUT',
            headers: {
                'apikey': CONFIG.supabaseAnonKey,
                'Authorization': `Bearer ${localStorage.getItem('admin-token')}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                password: newPassword,
                current_password: currentPassword
            })
        })
        
        if (response.ok) {
            alert('Пароль изменён')
            document.getElementById('changePasswordForm').reset()
        } else {
            const data = await response.json()
            alert(translateError(data.msg || data.error || data.error_description) || 'Ошибка изменения пароля')
        }
    } catch (error) {
        alert('Ошибка: ' + translateError(error.message))
    }
}

// ============================================
// Import/Export
// ============================================

let importFile = null

function handleImportFileSelect(e) {
    importFile = e.target.files[0]
    document.getElementById('importBtn').disabled = !importFile
}

async function handleImport() {
    if (!importFile) return
    
    const reader = new FileReader()
    
    reader.onload = async (e) => {
        try {
            const data = new Uint8Array(e.target.result)
            const workbook = XLSX.read(data, { type: 'array' })
            const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
            const jsonData = XLSX.utils.sheet_to_json(firstSheet)
            
            const response = await fetch(`${CONFIG.adminApiUrl}/import`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('admin-token')}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ products: jsonData })
            })
            
            const result = await response.json()
            const statusEl = document.getElementById('importStatus')
            
            if (result.success) {
                statusEl.className = 'status-message success'
                statusEl.textContent = `Импортировано: ${result.results.success} товаров`
            } else {
                statusEl.className = 'status-message error'
                statusEl.textContent = `Ошибки: ${result.results.errors.length}. Успешно: ${result.results.success}`
            }
        } catch (error) {
            document.getElementById('importStatus').className = 'status-message error'
            document.getElementById('importStatus').textContent = 'Ошибка чтения файла'
        }
    }
    
    reader.readAsArrayBuffer(importFile)
}

async function handleExport() {
    const response = await fetch(`${CONFIG.adminApiUrl}/export`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('admin-token')}` }
    })
    
    if (!response.ok) {
        const result = await response.json().catch(() => ({}))
        alert(translateError(result.error) || 'Ошибка экспорта')
        return
    }
    
    const data = await response.json()
    
    const ws = XLSX.utils.json_to_sheet(data)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Products')
    XLSX.writeFile(wb, 'jack-nutrition-catalog.xlsx')
}

async function handleBackup() {
    const response = await fetch(`${CONFIG.adminApiUrl}/backup`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('admin-token')}` }
    })
    
    if (!response.ok) {
        const result = await response.json().catch(() => ({}))
        alert(translateError(result.error) || 'Ошибка резервного копирования')
        return
    }
    
    const blob = await response.blob()
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `jack-nutrition-backup-${new Date().toISOString().split('T')[0]}.json`
    a.click()
}

async function handleBackupSql() {
    const response = await fetch(`${CONFIG.adminApiUrl}/backup-sql`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('admin-token')}` }
    })

    if (!response.ok) {
        const result = await response.json().catch(() => ({}))
        alert(translateError(result.error) || 'Ошибка SQL-дампа')
        return
    }

    const blob = await response.blob()
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `jack-nutrition-backup-${new Date().toISOString().split('T')[0]}.sql`
    a.click()
}

// ============================================
// Monitoring
// ============================================

async function startMonitor() {
    checkMonitor()
    monitorInterval = setInterval(checkMonitor, 30000)
}

async function checkMonitor() {
    try {
        const response = await fetch(CONFIG.orderFunctionUrl + '/health', {
            method: 'GET'
        })
        
        const dot = document.querySelector('.indicator-dot')
        const text = document.querySelector('.indicator-text')
        
        if (response.ok) {
            dot.className = 'indicator-dot active'
            text.textContent = 'Edge Function работает'
        } else {
            dot.className = 'indicator-dot error'
            text.textContent = 'Ошибка Edge Function'
            sendAlert('Edge Function недоступен')
        }
    } catch (error) {
        const dot = document.querySelector('.indicator-dot')
        const text = document.querySelector('.indicator-text')
        dot.className = 'indicator-dot error'
        text.textContent = 'Нет подключения'
    }
}

async function sendAlert(message) {
    try {
        const response = await fetch(`${CONFIG.adminApiUrl}/settings`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('admin-token')}` }
        })
        
        if (!response.ok) return
        
        const settings = await response.json()
        const whatsappNumber = settings.whatsapp_number?.replace(/\D/g, '')
        if (whatsappNumber) {
            const url = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`
            window.open(url, '_blank')
        }
    } catch (e) {
        // ignore
    }
}

// ============================================
// Utilities
// ============================================

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
