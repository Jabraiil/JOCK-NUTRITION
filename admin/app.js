// ============================================
// Admin Panel JavaScript
// ============================================

const CONFIG = {
    supabaseUrl: 'https://hpphfeojjejculvdundj.supabase.co',
    supabaseAnonKey: 'sb_publishable_1EGpjPEw9gU2W5OKL-gFIQ_x4Gvger1',
    adminApiUrl: 'https://hpphfeojjejculvdundj.supabase.co/functions/v1/admin-api',
    orderFunctionUrl: 'https://hpphfeojjejculvdundj.supabase.co/functions/v1/create-order'
}

async function fetchWithTimeout(url, options = {}, timeout = 15000) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)
    try {
        const isAuthEndpoint = url.includes('/auth/v1/')
        const skipAuthRedirect = options.skipAuthRedirect === true
        const token = !isAuthEndpoint ? localStorage.getItem('admin-token') : null
        const headers = {
            ...(options.headers || {}),
            ...(token && !options.headers?.Authorization ? { 'Authorization': `Bearer ${token}` } : {})
        }
        const response = await window.fetch(url, { ...options, headers, signal: controller.signal })
        clearTimeout(timer)
        if (!isAuthEndpoint && !skipAuthRedirect && response.status === 401) {
            handleAuthError('Сессия истекла. Войдите снова.')
        }
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

let currentPage = 'products'
let editingProductId = null
let productImages = []
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
            window.location.hash = ''
            const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
            if (isLocalhost) {
                window.location.href = 'https://jabraiil.github.io/JOCK-NUTRITION/admin/'
                return
            }
            if (!window.location.pathname.includes('/admin/')) {
                window.location.href = 'https://jabraiil.github.io/JOCK-NUTRITION/admin/'
                return
            }
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
    const loginForm = document.getElementById('loginForm')
    if (loginForm) loginForm.addEventListener('submit', handleLogin)
    const forgotPassword = document.getElementById('forgotPassword')
    if (forgotPassword) forgotPassword.addEventListener('click', handleForgotPassword)
    const logoutBtn = document.getElementById('logoutBtn')
    if (logoutBtn) logoutBtn.addEventListener('click', handleLogout)

    // Mobile hamburger
    const sidebar = document.querySelector('.sidebar')
    const sidebarOverlay = document.getElementById('sidebarOverlay')
    const toggleSidebar = (open) => {
        if (sidebar) sidebar.classList.toggle('open', open)
        if (sidebarOverlay) sidebarOverlay.classList.toggle('open', open)
    }
    const hamburgerBtn = document.getElementById('hamburgerBtn')
    if (hamburgerBtn) hamburgerBtn.addEventListener('click', () => {
        toggleSidebar(!sidebar?.classList.contains('open'))
    })
    if (sidebarOverlay) sidebarOverlay.addEventListener('click', () => toggleSidebar(false))

    // Navigation
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            const page = item.dataset.page
            switchPage(page)
            toggleSidebar(false)
        })
    })

    // Products table actions (event delegation)
    const productsTable = document.getElementById('productsTable')
    if (productsTable) {
        productsTable.addEventListener('click', (e) => {
            const editBtn = e.target.closest('button[data-action="edit-product"]')
            const dupBtn = e.target.closest('button[data-action="duplicate-product"]')
            const delBtn = e.target.closest('button[data-action="delete-product"]')
            if (editBtn) editProduct(editBtn.dataset.id)
            if (dupBtn) duplicateProduct(dupBtn.dataset.id)
            if (delBtn) deleteProduct(delBtn.dataset.id)
        })
    }

    // Categories table actions (event delegation)
    const categoriesTable = document.getElementById('categoriesTable')
    if (categoriesTable) {
        categoriesTable.addEventListener('click', (e) => {
            const editBtn = e.target.closest('button[data-action="edit-category"]')
            const delBtn = e.target.closest('button[data-action="delete-category"]')
            if (editBtn) editCategory(editBtn.dataset.id)
            if (delBtn) deleteCategory(delBtn.dataset.id)
        })
    }

    // Brands table actions (event delegation)
    const brandsTable = document.getElementById('brandsTable')
    if (brandsTable) {
        brandsTable.addEventListener('click', (e) => {
            const editBtn = e.target.closest('button[data-action="edit-brand"]')
            const delBtn = e.target.closest('button[data-action="delete-brand"]')
            if (editBtn) editBrand(editBtn.dataset.id)
            if (delBtn) deleteBrand(delBtn.dataset.id)
        })
    }

    // Pagination (event delegation)
    const productsPagination = document.getElementById('productsPagination')
    if (productsPagination) {
        productsPagination.addEventListener('click', (e) => {
            const btn = e.target.closest('button')
            if (!btn || btn.disabled) return
            const page = btn.dataset.page
            if (page) changeProductsPage(parseInt(page, 10))
        })
    }

    const productSearch = document.getElementById('productSearch')
    if (productSearch) {
        productSearch.addEventListener('input', debounce(() => {
            productsPage = 1
            loadProducts()
        }, 300))
    }

    const ordersPagination = document.getElementById('ordersPagination')
    if (ordersPagination) {
        ordersPagination.addEventListener('click', (e) => {
            const btn = e.target.closest('button')
            if (!btn || btn.disabled) return
            const page = btn.dataset.page
            if (page) changeOrdersPage(parseInt(page, 10))
        })
    }

    // Analytics
    const analyticsPeriod = document.getElementById('analyticsPeriod')
    if (analyticsPeriod) analyticsPeriod.addEventListener('change', () => { ordersPage = 1; loadAnalytics() })

    // Settings
    const settingsForm = document.getElementById('settingsForm')
    if (settingsForm) settingsForm.addEventListener('submit', handleSettingsSave)
    const changePasswordForm = document.getElementById('changePasswordForm')
    if (changePasswordForm) changePasswordForm.addEventListener('submit', handleChangePassword)

    // Import/Export
    const importFileBtn = document.getElementById('importFileBtn')
    if (importFileBtn) importFileBtn.addEventListener('click', () => {
        const importFile = document.getElementById('importFile')
        if (importFile) importFile.click()
    })
    const importFile = document.getElementById('importFile')
    if (importFile) importFile.addEventListener('change', handleImportFileSelect)
    const importBtn = document.getElementById('importBtn')
    if (importBtn) importBtn.addEventListener('click', handleImport)
    const exportBtn = document.getElementById('exportBtn')
    if (exportBtn) exportBtn.addEventListener('click', handleExport)
    const exportTemplateBtn = document.getElementById('exportTemplateBtn')
    if (exportTemplateBtn) exportTemplateBtn.addEventListener('click', handleExportTemplate)
    const backupBtn = document.getElementById('backupBtn')
    if (backupBtn) backupBtn.addEventListener('click', handleBackup)
    const backupSqlBtn = document.getElementById('backupSqlBtn')
    if (backupSqlBtn) backupSqlBtn.addEventListener('click', handleBackupSql)

    // Generate descriptions
    const generateDescBtn = document.getElementById('generateDescBtn')
    if (generateDescBtn) {
        generateDescBtn.addEventListener('click', handleGenerateDescriptions)
    }

    // Modal
    const productModalClose = document.querySelector('#productModal .modal-close')
    if (productModalClose) productModalClose.addEventListener('click', closeProductModal)
    const nameModalClose = document.getElementById('nameModalClose')
    if (nameModalClose) nameModalClose.addEventListener('click', closeNameModal)
    const nameModalCancel = document.getElementById('nameModalCancel')
    if (nameModalCancel) nameModalCancel.addEventListener('click', closeNameModal)
    const nameModalForm = document.getElementById('nameModalForm')
    if (nameModalForm) {
        nameModalForm.addEventListener('submit', async (e) => {
            e.preventDefault()
            const value = document.getElementById('nameModalInput')?.value.trim() || ''
            if (nameModalResolve) {
                nameModalResolve(value)
                nameModalResolve = null
            }
            const nameModal = document.getElementById('nameModal')
            if (nameModal) nameModal.classList.add('hidden')
            const nameModalInput = document.getElementById('nameModalInput')
            if (nameModalInput) nameModalInput.value = ''
        })
    }

    const cancelProduct = document.getElementById('cancelProduct')
    if (cancelProduct) cancelProduct.addEventListener('click', closeProductModal)

    // Product image removal
    const imagePreview = document.getElementById('imagePreview')
    if (imagePreview) {
        imagePreview.addEventListener('click', (e) => {
            if (e.target.classList.contains('remove-image')) {
                const idx = parseInt(e.target.dataset.idx, 10)
                productImages.splice(idx, 1)
                imagePreview.innerHTML = productImages.map((img, i) => `<span class="image-wrapper"><img src="${img.url}" alt=""><button type="button" class="remove-image" data-idx="${i}">&times;</button></span>`).join('')
            }
        })
    }

    const addProductBtn = document.getElementById('addProductBtn')
    if (addProductBtn) addProductBtn.addEventListener('click', () => openProductModal())

    const addCategoryBtn = document.getElementById('addCategoryBtn')
    if (addCategoryBtn) addCategoryBtn.addEventListener('click', () => openCategoryModal())

    const addBrandBtn = document.getElementById('addBrandBtn')
    if (addBrandBtn) addBrandBtn.addEventListener('click', () => openBrandModal())
}

function showAuthPage() {
    const authPage = document.getElementById('authPage')
    const adminPage = document.getElementById('adminPage')
    if (authPage) authPage.classList.remove('hidden')
    if (adminPage) adminPage.classList.add('hidden')
}

function showAdminPage() {
    const authPage = document.getElementById('authPage')
    const adminPage = document.getElementById('adminPage')
    if (authPage) authPage.classList.add('hidden')
    if (adminPage) adminPage.classList.remove('hidden')
}

async function handleLogin(e) {
    e.preventDefault()
    
    const email = document.getElementById('loginEmail').value
    const password = document.getElementById('loginPassword').value
    const errorEl = document.getElementById('loginError')
    
    errorEl.classList.add('hidden')
    
    try {
        const response = await fetchWithTimeout(`${CONFIG.supabaseUrl}/auth/v1/token?grant_type=password`, {
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
        const response = await fetchWithTimeout(`${CONFIG.supabaseUrl}/auth/v1/recover`, {
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
    
    const pageTitle = document.getElementById('pageTitle')
    if (pageTitle) pageTitle.textContent = titles[page] || page
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
    try {
        const search = document.getElementById('productSearch').value || ''
        const params = new URLSearchParams({ limit: String(PRODUCTS_PER_PAGE), page: String(productsPage) })
        if (search) params.set('search', search)
        
        const response = await fetchWithTimeout(`${CONFIG.adminApiUrl}/products?${params}`, {
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
        if (data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--text-secondary)">Товары не найдены</td></tr>'
        } else {
            tbody.innerHTML = data.map(product => `
                <tr>
                    <td>${product.product_images?.[0]?.url ? `<img src="${escapeHtml(product.product_images[0].url)}" alt="">` : '<span style="color:var(--text-secondary)">—</span>'}</td>
                    <td>${escapeHtml(cleanProductName(product.name, product.brands?.name))}</td>
                    <td>${escapeHtml(product.categories?.name || '-')}</td>
                    <td>${escapeHtml(product.brands?.name || '-')}</td>
                    <td>${product.price} ₽</td>
                    <td>${product.stock}</td>
                    <td>${product.is_visible ? '✅' : '❌'}</td>
                <td>
                    ${product.is_hit ? '<span class="badge-text badge-hit">HIT</span>' : ''}
                    ${product.is_new ? '<span class="badge-text badge-new">NEW</span>' : ''}
                    ${product.is_discount ? '<span class="badge-text badge-discount">SALE</span>' : ''}
                </td>
                    <td>
                        <button class="btn btn-sm btn-secondary" data-action="edit-product" data-id="${escapeHtml(String(product.id))}">✏️</button>
                        <button class="btn btn-sm btn-primary" data-action="duplicate-product" data-id="${escapeHtml(String(product.id))}">⧉</button>
                        <button class="btn btn-sm btn-danger" data-action="delete-product" data-id="${escapeHtml(String(product.id))}">🗑️</button>
                    </td>
                </tr>
            `).join('')
        }
        
        renderProductsPagination()
    } catch (error) {
        console.error('Error loading products:', error)
        alert('Ошибка загрузки товаров: ' + error.message)
    }
}

function renderProductsPagination() {
    const container = document.getElementById('productsPagination')
    const totalPages = Math.max(1, Math.ceil(productsTotal / PRODUCTS_PER_PAGE))
    
    if (totalPages <= 1) {
        container.innerHTML = ''
        return
    }
    
    let html = `<button ${productsPage === 1 ? 'disabled' : ''} data-page="${productsPage - 1}">←</button>`
    
    for (let p = 1; p <= totalPages; p++) {
        html += `<button class="${p === productsPage ? 'active' : ''}" data-page="${p}">${p}</button>`
    }
    
    html += `<button ${productsPage === totalPages ? 'disabled' : ''} data-page="${productsPage + 1}">→</button>`
    container.innerHTML = html
}

function changeProductsPage(page) {
    productsPage = page
    loadProducts()
}

async function openProductModal(productId = null) {
    editingProductId = productId
    const modalTitle = document.getElementById('modalTitle')
    if (modalTitle) modalTitle.textContent = productId ? 'Редактировать товар' : 'Добавить товар'

    const productForm = document.getElementById('productForm')
    if (productForm) productForm.reset()
    productImages = []
    const imagePreview = document.getElementById('imagePreview')
    if (imagePreview) imagePreview.innerHTML = ''

    const loadOk = await loadFormOptions()
    if (!loadOk) {
        closeProductModal()
        return
    }

    if (productId) {
        try {
            const response = await fetchWithTimeout(`${CONFIG.adminApiUrl}/products/${productId}`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('admin-token')}` }
            })
            if (!response.ok) {
                const result = await response.json().catch(() => ({}))
                alert(translateError(result.error) || 'Ошибка загрузки товара')
                closeProductModal()
                return
            }
            const product = await response.json()

            if (product && product.id) {
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

                const preview = document.getElementById('imagePreview')
                if (preview) {
                    preview.innerHTML = productImages.map((img, idx) => `<span class="image-wrapper"><img src="${escapeHtml(img.url)}" alt=""><button type="button" class="remove-image" data-idx="${idx}">&times;</button></span>`).join('')
                }

                const relatedIds = Array.isArray(product.related) ? product.related : []
                const relatedSelect = document.getElementById('prodRelated')
                if (relatedSelect) {
                    Array.from(relatedSelect.options).forEach(opt => {
                        opt.selected = relatedIds.includes(opt.value)
                    })
                }

                const showContra = document.getElementById('showContraindications')
                const contraGroup = document.getElementById('contraindicationsGroup')
                if (showContra && contraGroup) {
                    showContra.checked = !!product.contraindications
                    contraGroup.style.display = showContra.checked ? 'block' : 'none'
                    showContra.onchange = () => {
                        contraGroup.style.display = showContra.checked ? 'block' : 'none'
                    }
                }
            }
        } catch (error) {
            console.error('Error loading product:', error)
            alert('Ошибка загрузки товара: ' + error.message)
            closeProductModal()
            return
        }
    }

    document.getElementById('productModal').classList.remove('hidden')
}

function closeProductModal() {
    document.getElementById('productModal').classList.add('hidden')
    editingProductId = null
}

async function loadFormOptions() {
    try {
        const categoriesRes = await fetchWithTimeout(`${CONFIG.adminApiUrl}/categories`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('admin-token')}` }
        })
        if (!categoriesRes.ok) {
            const text = await categoriesRes.text()
            throw new Error(text || 'Ошибка загрузки категорий')
        }

        const brandsRes = await fetchWithTimeout(`${CONFIG.adminApiUrl}/brands`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('admin-token')}` }
        })
        if (!brandsRes.ok) {
            const text = await brandsRes.text()
            throw new Error(text || 'Ошибка загрузки брендов')
        }
        
        const categories = await categoriesRes.json()
        const brands = await brandsRes.json()
        
        document.getElementById('prodCategory').innerHTML = 
            '<option value="">Не выбрана</option>' +
            categories.map(c => `<option value="${escapeHtml(String(c.id))}">${escapeHtml(c.name)}</option>`).join('')
        
        document.getElementById('prodBrand').innerHTML = 
            '<option value="">Не выбран</option>' +
            brands.map(b => `<option value="${escapeHtml(String(b.id))}">${escapeHtml(b.name)}</option>`).join('')

        // Load all products for related select
        const allRes = await fetchWithTimeout(`${CONFIG.adminApiUrl}/products?limit=1000&page=1`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('admin-token')}` }
        })
        
        if (!allRes.ok) {
            const text = await allRes.text()
            throw new Error(text || 'Ошибка загрузки товаров')
        }
        
        const allData = await allRes.json()
        const productsList = allData.data || []
        const prodRelated = document.getElementById('prodRelated')
        if (prodRelated) {
            prodRelated.innerHTML = productsList
                .map(p => `<option value="${escapeHtml(String(p.id))}">${escapeHtml(p.name)}</option>`)
                .join('')
        }

        return true
    } catch (error) {
        console.error('Error loading form options:', error)
        alert('Ошибка загрузки справочников: ' + error.message)
        return false
    }
}

async function handleProductSubmit(e) {
    e.preventDefault()
    const errorEl = document.getElementById('productError')
    if (!errorEl) return

    const prodName = document.getElementById('prodName')
    const prodPrice = document.getElementById('prodPrice')
    const prodStock = document.getElementById('prodStock')
    if (!prodName || !prodPrice || !prodStock) return

    errorEl.classList.add('hidden')

    try {
        const productData = {
        name: prodName.value.trim(),
        description: document.getElementById('prodDescription')?.value.trim() || '',
        full_description: document.getElementById('prodFullDescription')?.value.trim() || '',
        composition: document.getElementById('prodComposition')?.value.trim() || '',
        dosage: document.getElementById('prodDosage')?.value.trim() || '',
        usage: document.getElementById('prodUsage')?.value.trim() || '',
        contraindications: document.getElementById('prodContraindications')?.value.trim() || '',
        category_id: document.getElementById('prodCategory')?.value || null,
        brand_id: document.getElementById('prodBrand')?.value || null,
        price: parseFloat(prodPrice.value) || 0,
        old_price: document.getElementById('prodOldPrice')?.value ? parseFloat(document.getElementById('prodOldPrice').value) : null,
        stock: parseInt(prodStock.value, 10) || 0,
        volume: document.getElementById('prodVolume')?.value.trim() || '',
        sku: document.getElementById('prodSku')?.value.trim() || null,
        barcode: document.getElementById('prodBarcode')?.value.trim() || null,
        is_hit: document.getElementById('prodIsHit')?.checked || false,
        is_new: document.getElementById('prodIsNew')?.checked || false,
        is_discount: document.getElementById('prodIsDiscount')?.checked || false,
        is_related_enabled: document.getElementById('prodIsRelated')?.checked || false,
        shelf_life: document.getElementById('prodShelfLife')?.value.trim() || '',
        is_visible: document.getElementById('prodIsVisible')?.value === 'true'
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

    const imageInput = document.getElementById('prodImages')
    if (imageInput.files.length > 0) {
        for (const file of imageInput.files) {
            const formData = new FormData()
            formData.append('file', file)

            const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}-${file.name}`
            const uploadRes = await fetchWithTimeout(`${CONFIG.supabaseUrl}/storage/v1/object/product-images/${fileName}`, {
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
                throw new Error(`Ошибка загрузки изображения: ${uploadRes.status} ${text}`)
            }
        }
    }

    const relatedSelect = document.getElementById('prodRelated')
    const related = Array.from(relatedSelect.selectedOptions).map(opt => opt.value)

    const body = {
        ...productData,
        ...(productImages.length ? { images: productImages } : {}),
        ...(related.length ? { related } : {})
    }

    const url = editingProductId ? `${CONFIG.adminApiUrl}/products/${editingProductId}` : `${CONFIG.adminApiUrl}/products`
    const method = editingProductId ? 'PUT' : 'POST'

    const response = await fetchWithTimeout(url, {
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
        const searchInput = document.getElementById('productSearch')
        if (searchInput) searchInput.value = ''
        productsPage = 1
        loadProducts()
    } else {
        errorEl.textContent = translateError(result.error) || 'Ошибка сохранения товара'
        errorEl.classList.remove('hidden')
    }
    } catch (err) {
        console.error('Product save error:', err)
        errorEl.textContent = (translateError(err.message) || 'Неизвестная ошибка при сохранении') + ' (' + err.message + ')'
        errorEl.classList.remove('hidden')
    }
}

async function deleteProduct(id) {
    if (!confirm('Удалить товар?')) return
    try {
        const response = await fetchWithTimeout(`${CONFIG.adminApiUrl}/products/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${localStorage.getItem('admin-token')}` }
        })
        
        if (response.ok) {
            loadProducts()
        } else {
            const result = await response.json().catch(() => ({}))
            alert(translateError(result.error) || 'Ошибка удаления товара')
        }
    } catch (error) {
        console.error('Error deleting product:', error)
        alert('Ошибка удаления товара: ' + error.message)
    }
}

function editProduct(id) {
    // Load product data and open modal
    openProductModal(id)
}

async function duplicateProduct(id) {
    try {
        editingProductId = null
        document.getElementById('modalTitle').textContent = 'Дублировать товар'
        document.getElementById('productForm').reset()
        productImages = []
        document.getElementById('imagePreview').innerHTML = ''

        await loadFormOptions()

        const response = await fetchWithTimeout(`${CONFIG.adminApiUrl}/products/${id}`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('admin-token')}` }
        })
        if (!response.ok) {
            const result = await response.json().catch(() => ({}))
            alert(translateError(result.error) || 'Ошибка загрузки товара')
            return
        }
        const product = await response.json()

        if (product && product.id) {
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

            const preview = document.getElementById('imagePreview')
            if (preview) {
                preview.innerHTML = productImages.map((img, idx) => `<span class="image-wrapper"><img src="${escapeHtml(img.url)}" alt=""><button type="button" class="remove-image" data-idx="${idx}">&times;</button></span>`).join('')
            }

            // Связи при дублировании не копируем
            const relatedSelect = document.getElementById('prodRelated')
            if (relatedSelect) {
                Array.from(relatedSelect.options).forEach(opt => { opt.selected = false })
            }

            const showContra = document.getElementById('showContraindications')
            const contraGroup = document.getElementById('contraindicationsGroup')
            if (showContra && contraGroup) {
                showContra.checked = !!product.contraindications
                contraGroup.style.display = showContra.checked ? 'block' : 'none'
                showContra.onchange = () => {
                    contraGroup.style.display = showContra.checked ? 'block' : 'none'
                }
            }
        }

        document.getElementById('productModal').classList.remove('hidden')
    } catch (error) {
        console.error('Error duplicating product:', error)
        alert('Ошибка дублирования товара: ' + error.message)
    }
}

// ============================================
// Categories
// ============================================

async function loadCategories() {
    try {
        const response = await fetchWithTimeout(`${CONFIG.adminApiUrl}/categories`, {
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
                <td>${escapeHtml(cat.name)}</td>
                <td>
                    <button class="btn btn-sm btn-secondary" data-action="edit-category" data-id="${escapeHtml(String(cat.id))}">✏️</button>
                    <button class="btn btn-sm btn-danger" data-action="delete-category" data-id="${escapeHtml(String(cat.id))}">🗑️</button>
                </td>
            </tr>
        `).join('')
    } catch (error) {
        console.error('Error loading categories:', error)
        alert('Ошибка загрузки категорий: ' + error.message)
    }
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
    let currentName = ''
    if (categoryId) {
        try {
            const res = await fetchWithTimeout(`${CONFIG.adminApiUrl}/categories/${categoryId}`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('admin-token')}` }
            })
            if (res.ok) {
                const cat = await res.json()
                if (cat) currentName = cat.name
            }
        } catch (e) {
            console.error('Error loading category:', e)
        }
    }

    const name = await openNameModal(
        categoryId ? 'Редактировать категорию' : 'Новая категория',
        'Название категории',
        currentName
    )
    if (!name) return

    try {
        const url = categoryId
            ? `${CONFIG.adminApiUrl}/categories/${categoryId}`
            : `${CONFIG.adminApiUrl}/categories`

        const method = categoryId ? 'PUT' : 'POST'

        const response = await fetchWithTimeout(url, {
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
    } catch (error) {
        console.error('Error saving category:', error)
        alert('Ошибка сохранения категории: ' + error.message)
    }
}

async function deleteCategory(id) {
    if (!confirm('Удалить категорию?')) return
    try {
        const response = await fetchWithTimeout(`${CONFIG.adminApiUrl}/categories/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${localStorage.getItem('admin-token')}` }
        })

        if (response.ok) {
            loadCategories()
        } else {
            const result = await response.json().catch(() => ({}))
            alert(translateError(result.error) || 'Ошибка удаления категории')
        }
    } catch (error) {
        console.error('Error deleting category:', error)
        alert('Ошибка удаления категории: ' + error.message)
    }
}

function editCategory(id) {
    openCategoryModal(id)
}

// ============================================
// Brands
// ============================================

async function loadBrands() {
    try {
        const response = await fetchWithTimeout(`${CONFIG.adminApiUrl}/brands`, {
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
                <td>${escapeHtml(brand.name)}</td>
                <td>
                    <button class="btn btn-sm btn-secondary" data-action="edit-brand" data-id="${escapeHtml(String(brand.id))}">✏️</button>
                    <button class="btn btn-sm btn-danger" data-action="delete-brand" data-id="${escapeHtml(String(brand.id))}">🗑️</button>
                </td>
            </tr>
        `).join('')
    } catch (error) {
        console.error('Error loading brands:', error)
        alert('Ошибка загрузки брендов: ' + error.message)
    }
}

async function openBrandModal(brandId = null) {
    let currentName = ''
    if (brandId) {
        try {
            const res = await fetchWithTimeout(`${CONFIG.adminApiUrl}/brands/${brandId}`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('admin-token')}` }
            })
            if (res.ok) {
                const brand = await res.json()
                if (brand) currentName = brand.name
            }
        } catch (e) {
            console.error('Error loading brand:', e)
        }
    }

    const name = await openNameModal(
        brandId ? 'Редактировать бренд' : 'Новый бренд',
        'Название бренда',
        currentName
    )
    if (!name) return

    try {
        const url = brandId
            ? `${CONFIG.adminApiUrl}/brands/${brandId}`
            : `${CONFIG.adminApiUrl}/brands`

        const method = brandId ? 'PUT' : 'POST'

        const response = await fetchWithTimeout(url, {
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
    } catch (error) {
        console.error('Error saving brand:', error)
        alert('Ошибка сохранения бренда: ' + error.message)
    }
}

async function deleteBrand(id) {
    if (!confirm('Удалить бренд?')) return
    try {
        const response = await fetchWithTimeout(`${CONFIG.adminApiUrl}/brands/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${localStorage.getItem('admin-token')}` }
        })

        if (response.ok) {
            loadBrands()
        } else {
            const result = await response.json().catch(() => ({}))
            alert(translateError(result.error) || 'Ошибка удаления бренда')
        }
    } catch (error) {
        console.error('Error deleting brand:', error)
        alert('Ошибка удаления бренда: ' + error.message)
    }
}

function editBrand(id) {
    openBrandModal(id)
}

// ============================================
// Analytics
// ============================================

async function loadAnalytics() {
    try {
        const period = document.getElementById('analyticsPeriod').value
        
        const response = await fetchWithTimeout(`${CONFIG.adminApiUrl}/analytics?period=${period}`, {
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
        const topProductsTable = document.getElementById('topProductsTable')
        if (topProductsTable) {
            topProductsTable.innerHTML = data.topProducts.map(p => `
                <tr>
                    <td>${escapeHtml(p.name)}</td>
                    <td>${escapeHtml(String(p.quantity))}</td>
                    <td>${escapeHtml(String(p.total))} ₽</td>
                </tr>
            `).join('')
        }
        
        // Chart
        renderSalesChart(data.dailyStats)
        
        // Orders
        const ordersRes = await fetchWithTimeout(`${CONFIG.adminApiUrl}/orders?period=${period}&page=${ordersPage}&limit=${ORDERS_PER_PAGE}`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('admin-token')}` }
        })
        
        if (!ordersRes.ok) {
            const result = await ordersRes.json().catch(() => ({}))
            alert(translateError(result.error) || 'Ошибка загрузки заказов')
            return
        }
        
        const ordersData = await ordersRes.json()
        ordersTotal = ordersData.total || 0
        
        const ordersTable = document.getElementById('ordersTable')
        if (ordersTable) {
            ordersTable.innerHTML = ordersData.data.map(order => `
                <tr>
                    <td>${escapeHtml(String(order.order_number))}</td>
                    <td>${escapeHtml(order.items.map(i => `${i.name} (${i.quantity})`).join(', '))}</td>
                    <td>${escapeHtml(String(order.total))} ₽</td>
                    <td>${escapeHtml(new Date(order.created_at).toLocaleString('ru-RU'))}</td>
                </tr>
            `).join('')
        }
        
        renderOrdersPagination()
    } catch (error) {
        console.error('Error loading analytics:', error)
        alert('Ошибка загрузки статистики: ' + error.message)
    }
}

function renderOrdersPagination() {
    const container = document.getElementById('ordersPagination')
    const totalPages = Math.max(1, Math.ceil(ordersTotal / ORDERS_PER_PAGE))
    
    if (totalPages <= 1) {
        container.innerHTML = ''
        return
    }
    
    let html = `<button ${ordersPage === 1 ? 'disabled' : ''} data-page="${ordersPage - 1}">←</button>`
    
    for (let p = 1; p <= totalPages; p++) {
        html += `<button class="${p === ordersPage ? 'active' : ''}" data-page="${p}">${p}</button>`
    }
    
    html += `<button ${ordersPage === totalPages ? 'disabled' : ''} data-page="${ordersPage + 1}">→</button>`
    container.innerHTML = html
}

function changeOrdersPage(page) {
    ordersPage = page
    loadAnalytics()
}

function renderSalesChart(dailyStats) {
    const canvas = document.getElementById('salesChart')
    if (!canvas || !dailyStats || !dailyStats.length) return
    const ctx = canvas.getContext('2d')
    
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
    try {
        const response = await fetchWithTimeout(`${CONFIG.adminApiUrl}/settings`, {
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
        document.getElementById('stockAvailabilityEnabled').checked = settings.stock_availability_enabled === 'true'
        document.getElementById('orderStartHour').value = settings.order_start_hour || '09:00'
        document.getElementById('orderEndHour').value = settings.order_end_hour || '20:00'
        document.getElementById('orderErrorCode').value = settings.order_error_code || '[!CHECK!]'
        document.getElementById('currency').value = settings.currency || '₽'
        document.getElementById('orderTemplate').value = settings.order_template || ''
        document.getElementById('geminiApiKey').value = settings.gemini_api_key || ''
    } catch (error) {
        console.error('Error loading settings:', error)
        alert('Ошибка загрузки настроек: ' + error.message)
    }
}

async function handleSettingsSave(e) {
    e.preventDefault()
    
    try {
    const settings = {
        whatsapp_number: document.getElementById('whatsappNumber').value,
        store_name: document.getElementById('storeName').value,
        logo_text: document.getElementById('logoText').value,
        timezone: document.getElementById('timezone').value,
        order_time_limit_enabled: document.getElementById('orderTimeLimitEnabled').checked ? 'true' : 'false',
        stock_availability_enabled: document.getElementById('stockAvailabilityEnabled').checked ? 'true' : 'false',
        order_start_hour: document.getElementById('orderStartHour').value,
        order_end_hour: document.getElementById('orderEndHour').value,
        order_error_code: document.getElementById('orderErrorCode').value,
        currency: document.getElementById('currency').value,
        order_template: document.getElementById('orderTemplate').value,
        gemini_api_key: document.getElementById('geminiApiKey').value
    }
    
    const response = await fetchWithTimeout(`${CONFIG.adminApiUrl}/settings`, {
        method: 'PUT',
        headers: {
            'Authorization': `Bearer ${localStorage.getItem('admin-token')}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(settings)
    })
    
    if (response.ok) {
        localStorage.setItem('gemini-api-key', settings.gemini_api_key)
        alert('Настройки сохранены')
    } else {
        const result = await response.json().catch(() => ({}))
        alert(translateError(result.error) || 'Ошибка сохранения настроек')
    }
    } catch (err) {
        console.error('Settings save error:', err)
        alert('Ошибка сохранения настроек: ' + err.message)
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
        const response = await fetchWithTimeout(`${CONFIG.supabaseUrl}/auth/v1/user`, {
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
            if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
                throw new Error('В файле нет листов')
            }
            const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
            const jsonData = XLSX.utils.sheet_to_json(firstSheet)
            
            const response = await fetchWithTimeout(`${CONFIG.adminApiUrl}/import`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('admin-token')}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ products: jsonData })
            })
            
            if (!response.ok) {
                const result = await response.json().catch(() => ({}))
                const statusEl = document.getElementById('importStatus')
                statusEl.className = 'status-message error'
                statusEl.textContent = translateError(result.error) || 'Ошибка импорта'
                return
            }
            
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
            console.error('Import error:', error)
            const statusEl = document.getElementById('importStatus')
            statusEl.className = 'status-message error'
            statusEl.textContent = 'Ошибка чтения файла: ' + error.message
        }
    }
    
    reader.readAsArrayBuffer(importFile)
}

async function handleExport() {
    try {
        const response = await fetchWithTimeout(`${CONFIG.adminApiUrl}/export`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('admin-token')}` }
        })
        
        if (!response.ok) {
            const result = await response.json().catch(() => ({}))
            alert(translateError(result.error) || 'Ошибка экспорта')
            return
        }
        
        const data = await response.json()
        
        const flatData = data.map(p => ({
            name: p.name || '',
            description: p.description || '',
            full_description: p.full_description || '',
            composition: p.composition || '',
            dosage: p.dosage || '',
            usage: p.usage || '',
            contraindications: p.contraindications || '',
            category: p.categories?.name || '',
            brand: p.brands?.name || '',
            price: p.price ?? '',
            old_price: p.old_price ?? '',
            stock: p.stock ?? '',
            volume: p.volume || '',
            sku: p.sku || '',
            barcode: p.barcode || '',
            is_hit: p.is_hit ? 'TRUE' : '',
            is_new: p.is_new ? 'TRUE' : '',
            is_discount: p.is_discount ? 'TRUE' : '',
            is_visible: p.is_visible ? 'TRUE' : 'FALSE',
            is_related_enabled: p.is_related_enabled ? 'TRUE' : '',
            shelf_life: p.shelf_life || '',
        }))
        
        const ws = XLSX.utils.json_to_sheet(flatData)
        const wb = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(wb, ws, 'Products')
        XLSX.writeFile(wb, 'jack-nutrition-catalog.xlsx')
    } catch (error) {
        console.error('Error exporting:', error)
        alert('Ошибка экспорта: ' + error.message)
    }
}

async function handleExportTemplate() {
    try {
        const headers = [
            { key: 'name', label: 'Название *', required: true },
            { key: 'category', label: 'Категория', required: false },
            { key: 'brand', label: 'Бренд', required: false },
            { key: 'price', label: 'Цена *', required: true },
            { key: 'old_price', label: 'Старая цена', required: false },
            { key: 'stock', label: 'Остаток *', required: true },
            { key: 'volume', label: 'Объём', required: false },
            { key: 'sku', label: 'Артикул', required: false },
            { key: 'barcode', label: 'Штрих-код', required: false },
            { key: 'composition', label: 'Состав', required: false },
            { key: 'usage', label: 'Способ применения', required: false },
            { key: 'contraindications', label: 'Противопоказания', required: false },
            { key: 'shelf_life', label: 'Срок годности', required: false },
            { key: 'is_hit', label: 'Бейдж: Хит (TRUE/FALSE)', required: false },
            { key: 'is_new', label: 'Бейдж: Новинка (TRUE/FALSE)', required: false },
            { key: 'is_discount', label: 'Бейдж: Скидка (TRUE/FALSE)', required: false },
            { key: 'is_visible', label: 'Видимость (TRUE/FALSE)', required: false }
        ]

        const headerRow = headers.map(h => h.required ? h.label + ' *' : h.label)
        const exampleRow = [
            'Пример: Витамин C 1000 мг',
            'Витамины',
            'BrandX',
            500,
            650,
            100,
            '60 капсул',
            'VC-1000',
            '4601234567890',
            'Аскорбиновая кислота...',
            'По 1 капсуле в день',
            'Индивидуальная непереносимость',
            '24 месяца',
            'TRUE',
            'TRUE',
            'FALSE',
            'TRUE'
        ]

        const ws = XLSX.utils.aoa_to_sheet([headerRow, exampleRow])
        const wb = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(wb, ws, 'Products')
        ws['!cols'] = headers.map(() => ({ wch: 22 }))
        XLSX.writeFile(wb, 'jack-nutrition-template.xlsx')
    } catch (error) {
        console.error('Error exporting template:', error)
        alert('Ошибка создания шаблона: ' + error.message)
    }
}


async function handleBackup() {
    try {
        const response = await fetchWithTimeout(`${CONFIG.adminApiUrl}/backup`, {
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
    } catch (error) {
        console.error('Error backup:', error)
        alert('Ошибка резервного копирования: ' + error.message)
    }
}

async function handleBackupSql() {
    try {
        const response = await fetchWithTimeout(`${CONFIG.adminApiUrl}/backup-sql`, {
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
    } catch (error) {
        console.error('Error SQL backup:', error)
        alert('Ошибка SQL-дампа: ' + error.message)
    }
}

// ============================================
// AI Description Generation
// ============================================

async function handleGenerateDescriptions() {
    const apiKey = document.getElementById('geminiApiKey')?.value || localStorage.getItem('gemini-api-key') || ''
    if (!apiKey) {
        alert('Введите DeepSeek API ключ в настройках')
        return
    }

    const btn = document.getElementById('generateDescBtn')
    const originalText = btn.textContent
    btn.disabled = true
    btn.textContent = '⏳ Генерация...'

    try {
        const productsRes = await fetchWithTimeout(
            `${CONFIG.supabaseUrl}/rest/v1/products?select=id,name,brands(name),brand_id,description,dosage,usage,contraindications,full_description&description=is.null&order=id`,
            {
                headers: {
                    'apikey': CONFIG.supabaseAnonKey,
                    'Authorization': `Bearer ${CONFIG.supabaseAnonKey}`
                }
            }
        )

        if (!productsRes.ok) throw new Error('Ошибка загрузки товаров')

        const products = await productsRes.json()

        if (products.length === 0) {
            alert('Все товары уже имеют описания')
            btn.disabled = false
            btn.textContent = originalText
            return
        }

        const CHUNK_SIZE = 30
        const chunks = []
        for (let i = 0; i < products.length; i += CHUNK_SIZE) {
            chunks.push(products.slice(i, i + CHUNK_SIZE))
        }

        let totalSuccess = 0
        let totalError = 0

        for (let c = 0; c < chunks.length; c++) {
            const chunk = chunks[c]
            btn.textContent = `⏳ Генерация... ${c * CHUNK_SIZE}/${products.length}`

            for (const product of chunk) {
                try {
                    const result = await generateAndValidateDescription(product, apiKey)
                    if (result) {
                        const updateRes = await fetchWithTimeout(
                            `${CONFIG.supabaseUrl}/rest/v1/products?id=eq.${product.id}`,
                            {
                                method: 'PATCH',
                                headers: {
                                    'apikey': CONFIG.supabaseAnonKey,
                                    'Authorization': `Bearer ${CONFIG.supabaseAnonKey}`,
                                    'Content-Type': 'application/json',
                                    'Prefer': 'return=minimal'
                                },
                                body: JSON.stringify({
                                    description: result.description,
                                    dosage: result.dosage,
                                    usage: result.usage,
                                    contraindications: result.contraindications
                                })
                            }
                        )

                        if (updateRes.ok) {
                            totalSuccess++
                        } else {
                            totalError++
                            console.error(`Failed to update product ${product.id}:`, await updateRes.text())
                        }
                    } else {
                        totalError++
                    }
                } catch (err) {
                    totalError++
                    console.error(`Error generating description for product ${product.id}:`, err)
                }

                await new Promise(r => setTimeout(r, 300))
            }

            if (c < chunks.length - 1) {
                await new Promise(r => setTimeout(r, 2000))
            }
        }

        alert(`Генерация завершена: ${totalSuccess} успешно, ${totalError} ошибок`)
    } catch (error) {
        alert('Ошибка при генерации описаний: ' + error.message)
        console.error(error)
    } finally {
        btn.disabled = false
        btn.textContent = originalText
    }
}

async function generateAndValidateDescription(product, apiKey) {
    const brandName = product.brands?.name || ''
    const productName = product.name || ''

    const messages = [
        {
            role: 'system',
            content: 'You are a professional copywriter for a dietary supplement e-commerce store. Always respond with valid JSON only, no markdown, no explanations.'
        },
        {
            role: 'user',
            content: `Generate a product description for a dietary supplement.

Product name: "${productName}"
Brand: "${brandName}"

Return ONLY valid JSON with these exact fields:
{
  "description": "2-3 sentences about product benefits matching the name",
  "dosage": "amount extracted from product name (e.g., '120 капсул')",
  "usage": "short intake instruction (e.g., 'По 1 капсуле 2 раза в день во время еды')",
  "contraindications": "basic contraindications (individual intolerance, pregnancy, breastfeeding)"
}

Rules:
- description must exactly match "${productName}" and "${brandName}"
- dosage must be extracted from the product name
- usage: brief instruction
- contraindications: standard list only
- Do not confuse with similar products`
        }
    ]

    const data = await callDeepSeekWithRetry(apiKey, messages, {
        temperature: 0.3,
        max_tokens: 500,
        response_format: { type: 'json_object' }
    })

    const rawText = data?.choices?.[0]?.message?.content?.trim()

    if (!rawText) throw new Error('Empty response from AI')

    let parsed
    try {
        parsed = JSON.parse(rawText)
    } catch (e) {
        console.error('Failed to parse AI response:', rawText)
        return null
    }

    const auditMessages = [
        {
            role: 'system',
            content: 'You are a quality checker. Respond with only "OK" or "ERROR: reason".'
        },
        {
            role: 'user',
            content: `Check if this supplement description matches the product.

Product: "${productName}"
Brand: "${brandName}"
Description: "${parsed.description || ''}"
Dosage: "${parsed.dosage || ''}"

Answer ONLY "OK" if correct, or "ERROR: reason" if there is a mismatch or error.`
        }
    ]

    const auditData = await callDeepSeekWithRetry(apiKey, auditMessages, {
        temperature: 0.1,
        max_tokens: 100
    })

    const auditResult = auditData?.choices?.[0]?.message?.content?.trim() || ''

    if (auditResult.toLowerCase().includes('error:')) {
        console.warn('Self-audit failed for product:', productName, auditResult)
        return null
    }

    return parsed
}

async function callDeepSeekWithRetry(apiKey, messages, params, attempts = 3) {
    for (let i = 0; i < attempts; i++) {
        try {
        const response = await fetchWithTimeout(
            'https://api.deepseek.com/chat/completions',
                {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model: 'deepseek-v4-flash',
                        messages: messages,
                        stream: false,
                        ...params
                    })
                }
            )

            if (response.ok) {
                return await response.json()
            }

            const errData = await response.json().catch(() => ({}))
            const errorMsg = errData.error?.message || errData.error || 'AI API error'

            if ((response.status === 429 || response.status === 503) && i < attempts - 1) {
                const delay = Math.pow(2, i) * 3000
                console.warn(`DeepSeek rate limit/server busy, retrying in ${delay}ms...`)
                await new Promise(r => setTimeout(r, delay))
                continue
            }

            throw new Error(errorMsg)
        } catch (err) {
            if (i < attempts - 1) {
                const delay = Math.pow(2, i) * 2000
                await new Promise(r => setTimeout(r, delay))
                continue
            }
            throw err
        }
    }
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
        const response = await fetchWithTimeout(CONFIG.orderFunctionUrl + '/health', {
            method: 'GET',
            skipAuthRedirect: true
        })
        
        const dot = document.querySelector('.indicator-dot')
        const text = document.querySelector('.indicator-text')
        
        if (!dot || !text) return
        
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
        if (!dot || !text) return
        dot.className = 'indicator-dot error'
        text.textContent = 'Нет подключения: ' + error.message
        console.error('Monitor error:', error)
    }
}

async function sendAlert(message) {
    try {
        const response = await fetchWithTimeout(`${CONFIG.adminApiUrl}/settings`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('admin-token')}` },
            skipAuthRedirect: true
        })
        
        if (!response.ok) return
        
        const settings = await response.json()
        const whatsappNumber = settings.whatsapp_number?.replace(/\D/g, '')
        if (whatsappNumber) {
            const url = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`
            const a = document.createElement('a')
            a.href = url
            a.target = '_blank'
            a.rel = 'noopener noreferrer'
            document.body.appendChild(a)
            a.click()
            document.body.removeChild(a)
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
    if ('serviceWorker' in navigator && location.pathname.startsWith('/admin/')) {
        navigator.serviceWorker.register('../sw.js')
            .then(reg => {
                if (navigator.serviceWorker.controller) {
                    navigator.serviceWorker.addEventListener('controllerchange', () => location.reload())
                }
                reg.update()
            })
            .catch(error => console.error('Service Worker registration failed:', error))
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    init()
    registerServiceWorker()
})
