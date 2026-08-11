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
let initialized = false

// Admin Barcode Scanner State
let adminBarcodeStream = null
let adminScannerWorker = null
let adminScannerDetector = null
let adminScanRafId = null
let adminWorkerBusy = false
let adminScanLastTime = 0
let adminLastVideoTime = -1
let adminScanCropCache = null
let adminScanCropVideoW = 0
let adminScanCropVideoH = 0
let adminScannerMode = 'none'
let adminHtml5QrCode = null
const ADMIN_SCAN_INTERVAL_MS = 250

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

function showError(message) {
    const errorEl = document.getElementById('productError')
    if (!errorEl) return
    errorEl.textContent = message
    errorEl.classList.remove('hidden')
}

function init() {
    if (initialized) return
    initialized = true
    try {
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
                    window.location.href = './admin/'
                    return
                }
                if (!window.location.pathname.includes('/admin/')) {
                    window.location.href = './admin/'
                    return
                }
            }
        }

        const token = localStorage.getItem('admin-token')
        
        applyTheme()

        if (token) {
            showAdminPage()
            loadPageData(currentPage)
            startMonitor()
        } else {
            showAuthPage()
        }

        setupEventListeners()
    } catch (error) {
        console.error('Init error:', error)
        const errorEl = document.getElementById('loginError')
        if (errorEl) {
            errorEl.textContent = 'Ошибка инициализации: ' + (error && error.message ? error.message : String(error))
            errorEl.classList.remove('hidden')
        }
    }
}

function applyTheme() {
    const darkMode = localStorage.getItem('jock-theme') === 'dark'
    if (darkMode) {
        document.documentElement.setAttribute('data-theme', 'dark')
    } else {
        document.documentElement.removeAttribute('data-theme')
    }
}

function toggleTheme() {
    const darkMode = localStorage.getItem('jock-theme') === 'dark'
    localStorage.setItem('jock-theme', darkMode ? 'light' : 'dark')
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
            const copyBtn = e.target.closest('button[data-action="copy-image-url"]')
            const delBtn = e.target.closest('button[data-action="delete-product"]')
            if (editBtn) editProduct(editBtn.dataset.id)
            if (dupBtn) duplicateProduct(dupBtn.dataset.id)
            if (copyBtn) copyImageUrl(copyBtn.dataset.url, copyBtn)
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

    // Orders table actions (event delegation)
    const ordersTable = document.getElementById('ordersTable')
    if (ordersTable) {
        ordersTable.addEventListener('click', (e) => {
            const delBtn = e.target.closest('button[data-action="delete-order"]')
            if (delBtn) deleteOrder(delBtn.dataset.id)
        })
        ordersTable.addEventListener('change', (e) => {
            if (e.target.type === 'checkbox' && e.target.id === 'selectAllOrders') {
                ordersTable.querySelectorAll('input[type="checkbox"][data-order-id]').forEach(cb => {
                    cb.checked = e.target.checked
                })
                updateDeleteSelectedBtn()
            }
            if (e.target.type === 'checkbox' && e.target.dataset.orderId) {
                updateDeleteSelectedBtn()
            }
        })
    }

    const deleteSelectedOrdersBtn = document.getElementById('deleteSelectedOrdersBtn')
    if (deleteSelectedOrdersBtn) {
        deleteSelectedOrdersBtn.addEventListener('click', deleteSelectedOrders)
    }
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
    const importRemoveFileBtn = document.getElementById('importRemoveFileBtn')
    if (importRemoveFileBtn) importRemoveFileBtn.addEventListener('click', clearImportFile)
    const undoImportBtn = document.getElementById('undoImportBtn')
    if (undoImportBtn) undoImportBtn.addEventListener('click', undoLastImport)
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

    const productForm = document.getElementById('productForm')
    if (productForm) productForm.addEventListener('submit', handleProductSubmit)

    // Product image removal
    const imagePreview = document.getElementById('imagePreview')
    if (imagePreview) {
        imagePreview.addEventListener('click', (e) => {
            if (e.target.classList.contains('remove-image')) {
                const idx = parseInt(e.target.dataset.idx, 10)
                productImages.splice(idx, 1)
                imagePreview.innerHTML = productImages.map((img, i) => `<span class="image-wrapper"><img src="${escapeHtml(img.url)}" alt="" decoding="async"><button type="button" class="remove-image" data-idx="${i}">&times;</button></span>`).join('')
            }
        })
    }

    const addProductBtn = document.getElementById('addProductBtn')
    if (addProductBtn) addProductBtn.addEventListener('click', () => openProductModal())

    const addCategoryBtn = document.getElementById('addCategoryBtn')
    if (addCategoryBtn) addCategoryBtn.addEventListener('click', () => openCategoryModal())

    const addBrandBtn = document.getElementById('addBrandBtn')
    if (addBrandBtn) addBrandBtn.addEventListener('click', () => openBrandModal())

    const addBannerSlideBtn = document.getElementById('addBannerSlideBtn')
    if (addBannerSlideBtn) addBannerSlideBtn.addEventListener('click', () => openBannerSlideModal())

    const saveBannerBtn = document.getElementById('saveBannerBtn')
    if (saveBannerBtn) saveBannerBtn.addEventListener('click', saveBannerSettings)

    const bannerSlidesList = document.getElementById('bannerSlidesList')
    if (bannerSlidesList) {
        bannerSlidesList.addEventListener('click', (e) => {
            const editBtn = e.target.closest('button[data-action="edit-banner-slide"]')
            const delBtn = e.target.closest('button[data-action="delete-banner-slide"]')
            if (editBtn) openBannerSlideModal(parseInt(editBtn.dataset.index, 10))
            if (delBtn) deleteBannerSlide(parseInt(delBtn.dataset.index, 10))
        })
    }

    const bannerSlideForm = document.getElementById('bannerSlideForm')
    if (bannerSlideForm) bannerSlideForm.addEventListener('submit', saveBannerSlide)

    const bannerSlideModalClose = document.getElementById('bannerSlideModalClose')
    if (bannerSlideModalClose) bannerSlideModalClose.addEventListener('click', closeBannerSlideModal)

    const bannerSlideCancel = document.getElementById('bannerSlideCancel')
    if (bannerSlideCancel) bannerSlideCancel.addEventListener('click', closeBannerSlideModal)

    const bannerSlideType = document.getElementById('bannerSlideType')
    if (bannerSlideType) bannerSlideType.addEventListener('change', updateBannerFormVisibility)

    setupGlobalTooltip()

    const bannerProduct = document.getElementById('bannerProduct')
    if (bannerProduct) {
        bannerProduct.addEventListener('change', async (e) => {
            const productId = e.target.value
            if (!productId) return

            try {
                const response = await fetchWithTimeout(`${CONFIG.adminApiUrl}/products/${productId}`, {
                    headers: { 'Authorization': `Bearer ${localStorage.getItem('admin-token')}` }
                })

                if (!response.ok) return

                const product = await response.json()
                const mainImage = product.images?.find(img => img.is_main) || product.images?.[0]
                const bannerImage = document.getElementById('bannerImage')
                const bannerTitle = document.getElementById('bannerTitle')
                const bannerSubtitle = document.getElementById('bannerSubtitle')

                if (mainImage?.url && bannerImage && !bannerImage.value) {
                    bannerImage.value = mainImage.url
                }
                if (product.name && bannerTitle && !bannerTitle.value) {
                    bannerTitle.value = product.name
                }
                if (product.brands?.name && bannerSubtitle && !bannerSubtitle.value) {
                    bannerSubtitle.value = product.brands.name
                }
            } catch (err) {
                console.error('Error loading product for banner:', err)
            }
        })
    }

    // Admin Barcode Scanner
    const adminBarcodeScanBtn = document.getElementById('adminBarcodeScanBtn')
    if (adminBarcodeScanBtn) adminBarcodeScanBtn.addEventListener('click', openAdminBarcodeScanner)

    const adminCloseScannerX = document.getElementById('adminCloseScannerX')
    if (adminCloseScannerX) adminCloseScannerX.addEventListener('click', closeAdminBarcodeScanner)

    const adminScannerUploadBtn = document.getElementById('adminScannerUploadBtn')
    const adminScannerFileInput = document.getElementById('adminScannerFileInput')
    if (adminScannerUploadBtn && adminScannerFileInput) {
        adminScannerUploadBtn.addEventListener('click', () => adminScannerFileInput.click())
        adminScannerFileInput.addEventListener('change', handleAdminFileUpload)
    }

    const adminProductForm = document.getElementById('productForm')
    if (adminProductForm) {
        adminProductForm.addEventListener('submit', () => {
            if (adminScanRafId || adminHtml5QrCode) closeAdminBarcodeScanner()
        })
    }
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
    
    const emailInput = document.getElementById('loginEmail')
    const passwordInput = document.getElementById('loginPassword')
    const errorEl = document.getElementById('loginError')
    
    if (!emailInput || !passwordInput || !errorEl) return
    
    errorEl.classList.add('hidden')
    
    const email = emailInput.value
    const password = passwordInput.value
    
    try {
        const response = await fetchWithTimeout(`${CONFIG.supabaseUrl}/auth/v1/token?grant_type=password`, {
            method: 'POST',
            headers: {
                'apikey': CONFIG.supabaseAnonKey,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email, password })
        })
        
        const data = await response.json().catch(() => ({}))
        
        if (response.ok && data.access_token) {
            localStorage.setItem('admin-token', data.access_token)
            showAdminPage()
            loadPageData('products')
        } else {
            const errorMessage = data.msg || data.error || data.error_description || 'Неверный email или пароль'
            throw new Error(translateError(errorMessage))
        }
    } catch (error) {
        errorEl.textContent = translateError(error.message || String(error))
        errorEl.classList.remove('hidden')
    }
}

async function handleForgotPassword() {
    const email = await openNameModal('Сброс пароля', 'Email')
    if (!email) return
    if (!email.includes('@')) {
            showError('Введите корректный email')
            return
        }
    
    try {
        const response = await fetchWithTimeout(`${CONFIG.supabaseUrl}/auth/v1/recover`, {
            method: 'POST',
            headers: {
                'apikey': CONFIG.supabaseAnonKey,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email, redirect_to: window.location.origin + '/JOCK-NUTRITION/admin/' })
        })
        
        if (response.ok) {
            showError('Письмо для сброса пароля отправлено на почту')
        } else {
            const result = await response.json().catch(() => ({}))
            showError(translateError(result.msg || result.error || result.error_description || 'Ошибка отправки письма'))
        }
    } catch (error) {
        showError('Ошибка: ' + translateError(error.message || String(error)))
    }
}

function handleLogout() {
    if (monitorInterval) {
        clearInterval(monitorInterval)
        monitorInterval = null
    }
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
    
    if (page === 'export') {
        buildExportColumnsUI()
    }
    
    if (page === 'import') {
        updateUndoImportButton()
    }
    
    const titles = {
        products: 'Товары',
        categories: 'Категории',
        brands: 'Бренды',
        banner: 'Баннер',
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
        case 'banner':
            await loadBannerSlides()
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
    const searchInput = document.getElementById('productSearch')
    const search = searchInput ? searchInput.value || '' : ''
    const params = new URLSearchParams({ limit: String(PRODUCTS_PER_PAGE), page: String(productsPage) })
    if (search) params.set('search', search)
    
    try {
        const response = await fetchWithTimeout(`${CONFIG.adminApiUrl}/products?${params}`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('admin-token')}` }
        })
        
        if (!response.ok) {
            const result = await response.json().catch(() => ({}))
            const errorEl = document.getElementById('loginError')
            if (errorEl) {
                errorEl.textContent = translateError(result.error) || 'Ошибка загрузки товаров'
                errorEl.classList.remove('hidden')
            }
            return
        }
        
        const { data, total } = await response.json()
        productsTotal = total || 0
        
        const tbody = document.getElementById('productsTable')
        const products = Array.isArray(data) ? data : []
        if (products.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--text-secondary)">Товары не найдены</td></tr>'
        } else {
            tbody.innerHTML = data.map(product => `
                <tr>
                    <td>${product.product_images?.[0]?.url ? `<img src="${escapeHtml(product.product_images[0].url)}" alt="" decoding="async" width="80" height="80">` : '<span style="color:var(--text-secondary)">—</span>'}</td>
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
                        <button class="btn btn-sm btn-accent" data-action="copy-image-url" data-id="${escapeHtml(String(product.id))}" data-url="${escapeHtml(product.product_images?.[0]?.url || '')}" title="Скопировать ссылку на фото">🔗</button>
                        <button class="btn btn-sm btn-danger" data-action="delete-product" data-id="${escapeHtml(String(product.id))}">🗑️</button>
                    </td>
                </tr>
            `).join('')
        }
        
        renderProductsPagination()
    } catch (error) {
        console.error('Error loading products:', error)
        showError('Ошибка загрузки товаров: ' + (error && error.message ? error.message : String(error)))
    }
}

function renderProductsPagination() {
    const container = document.getElementById('productsPagination')
    if (!container) return
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
                showError(translateError(result.error) || 'Ошибка загрузки товара')
                closeProductModal()
                return
            }
            const product = await response.json()

            if (product && product.id) {
                const prodName = document.getElementById('prodName')
                const prodDescription = document.getElementById('prodDescription')
                const prodFullDescription = document.getElementById('prodFullDescription')
                const prodComposition = document.getElementById('prodComposition')
                const prodDosage = document.getElementById('prodDosage')
                const prodUsage = document.getElementById('prodUsage')
                const prodContraindications = document.getElementById('prodContraindications')
                const prodCategory = document.getElementById('prodCategory')
                const prodBrand = document.getElementById('prodBrand')
                const prodPrice = document.getElementById('prodPrice')
                const prodOldPrice = document.getElementById('prodOldPrice')
                const prodStock = document.getElementById('prodStock')
                const prodVolume = document.getElementById('prodVolume')
                const prodSku = document.getElementById('prodSku')
                const prodBarcode = document.getElementById('prodBarcode')
                const prodIsHit = document.getElementById('prodIsHit')
                const prodIsNew = document.getElementById('prodIsNew')
                const prodIsDiscount = document.getElementById('prodIsDiscount')
                const prodIsRelated = document.getElementById('prodIsRelated')
                const prodShelfLife = document.getElementById('prodShelfLife')
                const prodIsVisible = document.getElementById('prodIsVisible')

                if (prodName) prodName.value = product.name || ''
                if (prodDescription) prodDescription.value = product.description || ''
                if (prodFullDescription) prodFullDescription.value = product.full_description || ''
                if (prodComposition) prodComposition.value = product.composition || ''
                if (prodDosage) prodDosage.value = product.dosage || ''
                if (prodUsage) prodUsage.value = product.usage || ''
                if (prodContraindications) prodContraindications.value = product.contraindications || ''
                if (prodCategory) prodCategory.value = product.category_id || ''
                if (prodBrand) prodBrand.value = product.brand_id || ''
                if (prodPrice) prodPrice.value = product.price ?? ''
                if (prodOldPrice) prodOldPrice.value = product.old_price ?? ''
                if (prodStock) prodStock.value = product.stock ?? ''
                if (prodVolume) prodVolume.value = product.volume || ''
                if (prodSku) prodSku.value = product.sku || ''
                if (prodBarcode) prodBarcode.value = product.barcode || ''
                if (prodIsHit) prodIsHit.checked = Boolean(product.is_hit)
                if (prodIsNew) prodIsNew.checked = Boolean(product.is_new)
                if (prodIsDiscount) prodIsDiscount.checked = Boolean(product.is_discount)
                if (prodIsRelated) prodIsRelated.checked = Boolean(product.is_related_enabled)
                if (prodShelfLife) prodShelfLife.value = product.shelf_life || ''
                if (prodIsVisible) prodIsVisible.value = String(product.is_visible)

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
            showError('Ошибка загрузки товара: ' + (error && error.message ? error.message : String(error)))
            closeProductModal()
            return
        }
    }

    document.getElementById('productModal')?.classList.remove('hidden')
}

function closeProductModal() {
    document.getElementById('productModal')?.classList.add('hidden')
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
        
        const prodCategoryEl = document.getElementById('prodCategory')
        if (prodCategoryEl) {
            prodCategoryEl.innerHTML = 
                '<option value="">Не выбрана</option>' +
                categories.map(c => `<option value="${escapeHtml(String(c.id))}">${escapeHtml(c.name)}</option>`).join('')
        }
        
        const prodBrandEl = document.getElementById('prodBrand')
        if (prodBrandEl) {
            prodBrandEl.innerHTML = 
                '<option value="">Не выбран</option>' +
                brands.map(b => `<option value="${escapeHtml(String(b.id))}">${escapeHtml(b.name)}</option>`).join('')
        }

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
        showError('Ошибка загрузки справочников: ' + (error && error.message ? error.message : String(error)))
        return false
    }
}

async function handleProductSubmit(e) {
    e.preventDefault()
        const errorEl = document.getElementById('productError')
        if (!errorEl) return

        errorEl.classList.add('hidden')

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
        price: parseInt(prodPrice.value, 10) || 0,
        old_price: (() => { const el = document.getElementById('prodOldPrice'); return el?.value ? parseInt(el.value, 10) : null })(),
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
    if (imageInput && imageInput.files.length > 0) {
        for (const file of imageInput.files) {
            const formData = new FormData()
            formData.append('file', file)

            const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
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
    const related = relatedSelect ? Array.from(relatedSelect.selectedOptions).map(opt => opt.value) : []

    const body = {
        ...productData,
        images: productImages,
        related: related
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
        const translated = translateError(err.message) || 'Неизвестная ошибка при сохранении'
        errorEl.textContent = translated + (err.message && err.message !== translated ? ' (' + err.message + ')' : '')
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
            showError(translateError(result.error) || 'Ошибка удаления товара')
        }
    } catch (error) {
        console.error('Error deleting product:', error)
        showError('Ошибка удаления товара: ' + (error && error.message ? error.message : String(error)))
    }
}

function editProduct(id) {
    // Load product data and open modal
    openProductModal(id)
}

async function duplicateProduct(id) {
    try {
        editingProductId = null
        const modalTitle = document.getElementById('modalTitle')
        const productForm = document.getElementById('productForm')
        const imagePreview = document.getElementById('imagePreview')
        if (modalTitle) modalTitle.textContent = 'Дублировать товар'
        if (productForm) productForm.reset()
        productImages = []
        if (imagePreview) imagePreview.innerHTML = ''

        await loadFormOptions()

        const response = await fetchWithTimeout(`${CONFIG.adminApiUrl}/products/${id}`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('admin-token')}` }
        })
        if (!response.ok) {
            const result = await response.json().catch(() => ({}))
            showError(translateError(result.error) || 'Ошибка загрузки товара')
            return
        }
        const product = await response.json()

        if (product && product.id) {
            const prodName = document.getElementById('prodName')
            const prodDescription = document.getElementById('prodDescription')
            const prodFullDescription = document.getElementById('prodFullDescription')
            const prodComposition = document.getElementById('prodComposition')
            const prodDosage = document.getElementById('prodDosage')
            const prodUsage = document.getElementById('prodUsage')
            const prodContraindications = document.getElementById('prodContraindications')
            const prodCategory = document.getElementById('prodCategory')
            const prodBrand = document.getElementById('prodBrand')
            const prodPrice = document.getElementById('prodPrice')
            const prodStock = document.getElementById('prodStock')
            const prodVolume = document.getElementById('prodVolume')
            const prodSku = document.getElementById('prodSku')
            const prodBarcode = document.getElementById('prodBarcode')
            const prodIsHit = document.getElementById('prodIsHit')
            const prodIsNew = document.getElementById('prodIsNew')
            const prodIsDiscount = document.getElementById('prodIsDiscount')
            const prodIsRelated = document.getElementById('prodIsRelated')
            const prodShelfLife = document.getElementById('prodShelfLife')
            const prodIsVisible = document.getElementById('prodIsVisible')

            if (prodName) prodName.value = product.name + ' (копия)'
            if (prodDescription) prodDescription.value = product.description || ''
            if (prodFullDescription) prodFullDescription.value = product.full_description || ''
            if (prodComposition) prodComposition.value = product.composition || ''
            if (prodDosage) prodDosage.value = product.dosage || ''
            if (prodUsage) prodUsage.value = product.usage || ''
            if (prodContraindications) prodContraindications.value = product.contraindications || ''
            if (prodCategory) prodCategory.value = product.category_id || ''
            if (prodBrand) prodBrand.value = product.brand_id || ''
            if (prodPrice) prodPrice.value = product.price ?? ''
            if (prodStock) prodStock.value = product.stock ?? ''
            if (prodVolume) prodVolume.value = product.volume || ''
            if (prodSku) prodSku.value = ''
            if (prodBarcode) prodBarcode.value = ''
            if (prodIsHit) prodIsHit.checked = Boolean(product.is_hit)
            if (prodIsNew) prodIsNew.checked = Boolean(product.is_new)
            if (prodIsDiscount) prodIsDiscount.checked = Boolean(product.is_discount)
            if (prodIsRelated) prodIsRelated.checked = Boolean(product.is_related_enabled)
            if (prodShelfLife) prodShelfLife.value = product.shelf_life || ''
            if (prodIsVisible) prodIsVisible.value = String(product.is_visible)

            productImages = Array.isArray(product.images) ? product.images.map(img => ({ ...img })) : []

            const preview = document.getElementById('imagePreview')
            if (preview) {
                preview.innerHTML = productImages.map((img, idx) => `<span class="image-wrapper"><img src="${escapeHtml(img.url)}" alt=""><button type="button" class="remove-image" data-idx="${idx}">&times;</button></span>`).join('')
            }

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

    document.getElementById('productModal')?.classList.remove('hidden')
    } catch (error) {
        console.error('Error duplicating product:', error)
        showError('Ошибка дублирования товара: ' + (error && error.message ? error.message : String(error)))
    }
}

async function copyImageUrl(url, btn) {
    if (!url) {
        showError('У товара нет фото')
        return
    }

    try {
        await navigator.clipboard.writeText(url)
        if (btn) {
            const original = btn.textContent
            btn.textContent = '✅'
            setTimeout(() => { btn.textContent = original }, 1500)
        }
    } catch (error) {
        console.error('Copy error:', error)
        showError('Ошибка копирования ссылки')
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
            showError(translateError(result.error) || 'Ошибка загрузки категорий')
            return
        }
        
        const data = await response.json()
        
        const categoriesTable = document.getElementById('categoriesTable')
        if (categoriesTable) {
            categoriesTable.innerHTML = data.map(cat => `
                <tr>
                    <td>${escapeHtml(cat.name)}</td>
                    <td>
                        <button class="btn btn-sm btn-secondary" data-action="edit-category" data-id="${escapeHtml(String(cat.id))}">✏️</button>
                        <button class="btn btn-sm btn-danger" data-action="delete-category" data-id="${escapeHtml(String(cat.id))}">🗑️</button>
                    </td>
                </tr>
            `).join('')
        }
    } catch (error) {
        console.error('Error loading categories:', error)
        showError('Ошибка загрузки категорий: ' + (error && error.message ? error.message : String(error)))
    }
}

let nameModalResolve = null

function openNameModal(title, label, value = '') {
    return new Promise((resolve) => {
        nameModalResolve = resolve
        const nameModalTitle = document.getElementById('nameModalTitle')
        const nameModalLabel = document.getElementById('nameModalLabel')
        const input = document.getElementById('nameModalInput')
        const nameModal = document.getElementById('nameModal')
        if (nameModalTitle) nameModalTitle.textContent = title
        if (nameModalLabel) nameModalLabel.textContent = label
        if (input) {
            input.value = value
            setTimeout(() => input.focus(), 50)
        }
        if (nameModal) nameModal.classList.remove('hidden')
    })
}

function closeNameModal() {
    const nameModal = document.getElementById('nameModal')
    const nameModalInput = document.getElementById('nameModalInput')
    if (nameModal) nameModal.classList.add('hidden')
    if (nameModalInput) nameModalInput.value = ''
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
            showError(translateError(result.error) || 'Ошибка сохранения категории')
        }
    } catch (error) {
        console.error('Error saving category:', error)
        showError('Ошибка сохранения категории: ' + (error && error.message ? error.message : String(error)))
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
            showError(translateError(result.error) || 'Ошибка удаления категории')
        }
    } catch (error) {
        console.error('Error deleting category:', error)
        showError('Ошибка удаления категории: ' + (error && error.message ? error.message : String(error)))
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
            showError(translateError(result.error) || 'Ошибка загрузки брендов')
            return
        }

        const data = await response.json()

        const brandsTable = document.getElementById('brandsTable')
        if (brandsTable) {
            brandsTable.innerHTML = data.map(brand => `
            <tr>
                <td>${escapeHtml(brand.name)}</td>
                <td>
                    <button class="btn btn-sm btn-secondary" data-action="edit-brand" data-id="${escapeHtml(String(brand.id))}">✏️</button>
                    <button class="btn btn-sm btn-danger" data-action="delete-brand" data-id="${escapeHtml(String(brand.id))}">🗑️</button>
                </td>
            </tr>
            `).join('')
        }
    } catch (error) {
        console.error('Error loading brands:', error)
        showError('Ошибка загрузки брендов: ' + (error && error.message ? error.message : String(error)))
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
            showError(translateError(result.error) || 'Ошибка сохранения бренда')
        }
    } catch (error) {
        console.error('Error saving brand:', error)
        showError('Ошибка сохранения бренда: ' + (error && error.message ? error.message : String(error)))
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
            showError(translateError(result.error) || 'Ошибка удаления бренда')
        }
    } catch (error) {
        console.error('Error deleting brand:', error)
        showError('Ошибка удаления бренда: ' + (error && error.message ? error.message : String(error)))
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
        const analyticsPeriodEl = document.getElementById('analyticsPeriod')
        const period = analyticsPeriodEl ? analyticsPeriodEl.value : 'month'
        
        const response = await fetchWithTimeout(`${CONFIG.adminApiUrl}/analytics?period=${period}`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('admin-token')}` }
        })
        
        if (!response.ok) {
            const result = await response.json().catch(() => ({}))
            showError(translateError(result.error) || 'Ошибка загрузки статистики')
            return
        }
        
        const data = await response.json()
        
        const totalRevenueEl = document.getElementById('totalRevenue')
        const totalOrdersEl = document.getElementById('totalOrders')
        if (totalRevenueEl) totalRevenueEl.textContent = `${(data.totalRevenue || 0).toLocaleString()} ₽`
        if (totalOrdersEl) totalOrdersEl.textContent = (data.totalOrders || 0).toLocaleString()
        
        // Top products
        const topProductsTable = document.getElementById('topProductsTable')
        if (topProductsTable) {
            const topProducts = Array.isArray(data.topProducts) ? data.topProducts : []
            topProductsTable.innerHTML = topProducts.map(p => `
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
            showError(translateError(result.error) || 'Ошибка загрузки заказов')
            return
        }
        
        const ordersData = await ordersRes.json()
        ordersTotal = ordersData.total || 0
        
        const ordersTable = document.getElementById('ordersTable')
        if (ordersTable) {
            const orders = Array.isArray(ordersData.data) ? ordersData.data : []
            ordersTable.innerHTML = orders.map(order => `
                <tr>
                    <td><input type="checkbox" data-order-id="${escapeHtml(String(order.id))}"></td>
                    <td>${escapeHtml(String(order.order_number))}</td>
                    <td>${escapeHtml((order.items || []).map(i => `${i.name} (${i.quantity})`).join(', '))}</td>
                    <td>${escapeHtml(String(order.total))} ₽</td>
                    <td>${escapeHtml(new Date(order.created_at).toLocaleString('ru-RU'))}</td>
                    <td><button class="btn btn-sm btn-danger" data-action="delete-order" data-id="${escapeHtml(String(order.id))}">🗑️</button></td>
                </tr>
            `).join('')
        }
        
        renderOrdersPagination()
    } catch (error) {
        console.error('Error loading analytics:', error)
        showError('Ошибка загрузки статистики: ' + (error && error.message ? error.message : String(error)))
    }
}

function renderOrdersPagination() {
    const container = document.getElementById('ordersPagination')
    if (!container) return
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

function updateDeleteSelectedBtn() {
    const btn = document.getElementById('deleteSelectedOrdersBtn')
    const checkboxes = document.querySelectorAll('#ordersTable input[type="checkbox"][data-order-id]:checked')
    if (btn) btn.disabled = checkboxes.length === 0
}

async function deleteOrder(id) {
    if (!confirm('Удалить заказ?')) return
    try {
        const response = await fetchWithTimeout(`${CONFIG.adminApiUrl}/orders/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${localStorage.getItem('admin-token')}` }
        })

        if (response.ok) {
            loadAnalytics()
        } else {
            const result = await response.json().catch(() => ({}))
            showError(translateError(result.error) || 'Ошибка удаления заказа')
        }
    } catch (error) {
        console.error('Error deleting order:', error)
        showError('Ошибка удаления заказа: ' + (error && error.message ? error.message : String(error)))
    }
}

async function deleteSelectedOrders() {
    const checkboxes = document.querySelectorAll('#ordersTable input[type="checkbox"][data-order-id]:checked')
    if (checkboxes.length === 0) return
    if (!confirm(`Удалить ${checkboxes.length} заказов?`)) return

    try {
        const ids = Array.from(checkboxes).map(cb => cb.dataset.orderId)
        const results = await Promise.allSettled(ids.map(id =>
            fetchWithTimeout(`${CONFIG.adminApiUrl}/orders/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${localStorage.getItem('admin-token')}` }
            })
        ))
        const failed = results.filter(r => r.status === 'rejected')
        if (failed.length > 0) {
            showError(`Удалено: ${results.length - failed.length}. Ошибок: ${failed.length}`)
        }
        loadAnalytics()
    } catch (error) {
        console.error('Error deleting orders:', error)
        showError('Ошибка удаления заказов: ' + (error && error.message ? error.message : String(error)))
    }
}

function renderSalesChart(dailyStats) {
    const canvas = document.getElementById('salesChart')
    if (!canvas || !dailyStats || !dailyStats.length) return
    if (typeof Chart === 'undefined') {
        console.warn('Chart.js не загружен')
        return
    }
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
            showError(translateError(result.error) || 'Ошибка загрузки настроек')
            return
        }
        
        const settings = await response.json()
        
        const whatsappNumberEl = document.getElementById('whatsappNumber')
        const whatsappBusinessNumberEl = document.getElementById('whatsappBusinessNumber')
        const whatsappAccountTypeEl = document.getElementById('whatsappAccountType')
        const storeNameEl = document.getElementById('storeName')
        const logoTextEl = document.getElementById('logoText')
        const timezoneEl = document.getElementById('timezone')
        const orderTimeLimitEnabledEl = document.getElementById('orderTimeLimitEnabled')
        const stockAvailabilityEnabledEl = document.getElementById('stockAvailabilityEnabled')
        const orderStartHourEl = document.getElementById('orderStartHour')
        const orderEndHourEl = document.getElementById('orderEndHour')
        const orderErrorCodeEl = document.getElementById('orderErrorCode')
        const currencyEl = document.getElementById('currency')
        const orderTemplateEl = document.getElementById('orderTemplate')
        const geminiApiKeyEl = document.getElementById('geminiApiKey')

        if (whatsappNumberEl) whatsappNumberEl.value = settings.whatsapp_number || ''
        if (whatsappBusinessNumberEl) whatsappBusinessNumberEl.value = settings.whatsapp_business_number || ''
        if (whatsappAccountTypeEl) whatsappAccountTypeEl.value = settings.whatsapp_account_type || 'personal'
        if (storeNameEl) storeNameEl.value = settings.store_name || ''
        if (logoTextEl) logoTextEl.value = settings.logo_text || ''
        if (timezoneEl) timezoneEl.value = settings.timezone || 'Europe/Moscow'
        if (orderTimeLimitEnabledEl) orderTimeLimitEnabledEl.checked = settings.order_time_limit_enabled === 'true'
        if (stockAvailabilityEnabledEl) stockAvailabilityEnabledEl.checked = settings.stock_availability_enabled === 'true'
        if (orderStartHourEl) orderStartHourEl.value = settings.order_start_hour || '09:00'
        if (orderEndHourEl) orderEndHourEl.value = settings.order_end_hour || '20:00'
        if (orderErrorCodeEl) orderErrorCodeEl.value = settings.order_error_code || '[!CHECK!]'
        if (currencyEl) currencyEl.value = settings.currency || '₽'
        if (orderTemplateEl) orderTemplateEl.value = settings.order_template || ''
        if (geminiApiKeyEl) geminiApiKeyEl.value = settings.gemini_api_key || ''
    } catch (error) {
        console.error('Error loading settings:', error)
        showError('Ошибка загрузки настроек: ' + (error && error.message ? error.message : String(error)))
    }
}

async function handleSettingsSave(e) {
    e.preventDefault()
    
    try {
    const settings = {
        whatsapp_number: document.getElementById('whatsappNumber')?.value || '',
        whatsapp_business_number: document.getElementById('whatsappBusinessNumber')?.value || '',
        whatsapp_account_type: document.getElementById('whatsappAccountType')?.value || 'personal',
        store_name: document.getElementById('storeName')?.value || '',
        logo_text: document.getElementById('logoText')?.value || '',
        timezone: document.getElementById('timezone')?.value || 'Europe/Moscow',
        order_time_limit_enabled: document.getElementById('orderTimeLimitEnabled')?.checked ? 'true' : 'false',
        stock_availability_enabled: document.getElementById('stockAvailabilityEnabled')?.checked ? 'true' : 'false',
        order_start_hour: document.getElementById('orderStartHour')?.value || '09:00',
        order_end_hour: document.getElementById('orderEndHour')?.value || '20:00',
        order_error_code: document.getElementById('orderErrorCode')?.value || '[!CHECK!]',
        currency: document.getElementById('currency')?.value || '₽',
        order_template: document.getElementById('orderTemplate')?.value || '',
        gemini_api_key: document.getElementById('geminiApiKey')?.value || ''
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
        showError('Настройки сохранены')
    } else {
        const result = await response.json().catch(() => ({}))
        showError(translateError(result.error) || 'Ошибка сохранения настроек')
    }
    } catch (err) {
        console.error('Settings save error:', err)
        showError('Ошибка сохранения настроек: ' + (err && err.message ? err.message : String(err)))
    }
}

async function handleChangePassword(e) {
    e.preventDefault()
    
    const currentPasswordEl = document.getElementById('currentPassword')
    const newPasswordEl = document.getElementById('newPassword')
    const confirmPasswordEl = document.getElementById('confirmPassword')
    
    if (!currentPasswordEl || !newPasswordEl || !confirmPasswordEl) return
    
    const currentPassword = currentPasswordEl.value
    const newPassword = newPasswordEl.value
    const confirmPassword = confirmPasswordEl.value
    
    if (newPassword !== confirmPassword) {
        showError('Пароли не совпадают')
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
            showError('Пароль изменён')
            const changePasswordForm = document.getElementById('changePasswordForm')
            if (changePasswordForm) changePasswordForm.reset()
        } else {
            const data = await response.json().catch(() => ({}))
            showError(translateError(data.msg || data.error || data.error_description) || 'Ошибка изменения пароля')
        }
    } catch (error) {
        showError('Ошибка: ' + translateError(error.message || String(error)))
    }
}

// ============================================
// Banner Management
// ============================================

let bannerSlidesData = []
let editingBannerSlideId = null

async function loadBannerSlides() {
    try {
        const response = await fetchWithTimeout(`${CONFIG.adminApiUrl}/settings`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('admin-token')}` }
        })

        if (!response.ok) {
            const result = await response.json().catch(() => ({}))
            showBannerError(translateError(result.error) || 'Ошибка загрузки баннера')
            return
        }

        const settings = await response.json()
        const raw = settings.promo_banner_slides || '[]'

        try {
            bannerSlidesData = JSON.parse(raw)
        } catch (e) {
            bannerSlidesData = []
        }

        renderBannerSlidesList()
        await populateBannerProductSelect()
    } catch (error) {
        console.error('Error loading banner:', error)
        showBannerError('Ошибка загрузки баннера: ' + (error && error.message ? error.message : String(error)))
    }
}

function renderBannerSlidesList() {
    const container = document.getElementById('bannerSlidesList')
    if (!container) return

    if (!bannerSlidesData.length) {
        container.innerHTML = '<div class="banner-empty">Нет слайдов. Добавьте первый слайд.</div>'
        return
    }

    container.innerHTML = bannerSlidesData.map((slide, idx) => {
        const previewStyle = slide.image ? `background-image: url('${escapeHtml(slide.image)}');` : ''
        const typeLabel = { auto: 'Авто', product: 'Товар', promo: 'Промо', split: 'Раздельный' }[slide.type] || slide.type
        const layoutLabel = slide.layout === 'split' ? 'Раздельное' : 'Фон'
        const posLabel = { left: 'Слева', right: 'Справа', center: 'По центру' }[slide.image_position] || slide.image_position

        return `
            <div class="banner-slide-item">
                <div class="slide-preview" style="${previewStyle}"></div>
                <div class="slide-info">
                    <div class="slide-title">${escapeHtml(slide.title || 'Без заголовка')}</div>
                    <div class="slide-meta">${escapeHtml(typeLabel)} | ${escapeHtml(layoutLabel)} | ${escapeHtml(posLabel)} | Порядок: ${slide.sort_order || idx}</div>
                    ${slide.subtitle ? `<div class="slide-meta">${escapeHtml(slide.subtitle)}</div>` : ''}
                </div>
                <div class="slide-actions">
                    <button class="btn btn-sm btn-secondary" data-action="edit-banner-slide" data-index="${idx}">✏️</button>
                    <button class="btn btn-sm btn-danger" data-action="delete-banner-slide" data-index="${idx}">🗑️</button>
                </div>
            </div>
        `
    }).join('')
}

async function populateBannerProductSelect() {
    const select = document.getElementById('bannerProduct')
    if (!select) return

    try {
        const response = await fetchWithTimeout(`${CONFIG.adminApiUrl}/products?limit=1000&page=1`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('admin-token')}` }
        })

        if (!response.ok) return

        const result = await response.json()
        const products = result.data || []

        select.innerHTML = '<option value="">— не выбран —</option>' +
            products.map(p => `<option value="${escapeHtml(String(p.id))}">${escapeHtml(p.name)}</option>`).join('')
    } catch (e) {
        console.error('Error loading products for banner:', e)
    }
}

function openBannerSlideModal(slideIndex = null) {
    editingBannerSlideId = slideIndex
    const modal = document.getElementById('bannerSlideModal')
    const title = document.getElementById('bannerSlideModalTitle')
    const form = document.getElementById('bannerSlideForm')
    const error = document.getElementById('bannerSlideError')

    if (!modal || !form) return

    error.classList.add('hidden')
    form.reset()

    const slide = slideIndex !== null ? bannerSlidesData[slideIndex] : null

    if (slide) {
        title.textContent = 'Редактировать слайд'
        document.getElementById('bannerSlideType').value = slide.type || 'promo'
        document.getElementById('bannerProduct').value = slide.product_id || ''
        document.getElementById('bannerImage').value = slide.image || ''
        document.getElementById('bannerTitle').value = slide.title || ''
        document.getElementById('bannerSubtitle').value = slide.subtitle || ''
        document.getElementById('bannerText').value = slide.text || ''
        document.getElementById('bannerBadge').value = slide.badge || ''
        document.getElementById('bannerLink').value = slide.link || ''
        document.getElementById('bannerLayout').value = slide.layout || 'full'
        document.getElementById('bannerImagePosition').value = slide.image_position || 'center'
        document.getElementById('bannerSort').value = slide.sort_order ?? 0
    } else {
        title.textContent = 'Новый слайд'
        document.getElementById('bannerSlideType').value = 'promo'
        document.getElementById('bannerProduct').value = ''
        document.getElementById('bannerImage').value = ''
        document.getElementById('bannerTitle').value = ''
        document.getElementById('bannerSubtitle').value = ''
        document.getElementById('bannerText').value = ''
        document.getElementById('bannerBadge').value = ''
        document.getElementById('bannerLink').value = ''
        document.getElementById('bannerLayout').value = 'full'
        document.getElementById('bannerImagePosition').value = 'center'
        document.getElementById('bannerSort').value = '0'
    }

    updateBannerFormVisibility()
    modal.classList.remove('hidden')
}

function closeBannerSlideModal() {
    const modal = document.getElementById('bannerSlideModal')
    if (modal) modal.classList.add('hidden')
    editingBannerSlideId = null
}

function updateBannerFormVisibility() {
    const type = document.getElementById('bannerSlideType')?.value || 'promo'
    const productGroup = document.getElementById('bannerProductGroup')
    const textField = document.getElementById('bannerText')

    if (productGroup) {
        productGroup.style.display = type === 'product' ? 'block' : 'none'
    }
    if (textField) {
        textField.style.display = type === 'split' ? 'block' : 'none'
    }
}

async function saveBannerSlide(e) {
    e.preventDefault()

    const error = document.getElementById('bannerSlideError')
    if (error) error.classList.add('hidden')

    const type = document.getElementById('bannerSlideType')?.value || 'promo'
    const productId = document.getElementById('bannerProduct')?.value || ''
    const image = document.getElementById('bannerImage')?.value || ''
    const title = document.getElementById('bannerTitle')?.value?.trim() || ''
    const subtitle = document.getElementById('bannerSubtitle')?.value?.trim() || ''
    const text = document.getElementById('bannerText')?.value?.trim() || ''
    const badge = document.getElementById('bannerBadge')?.value?.trim() || ''
    const link = document.getElementById('bannerLink')?.value?.trim() || ''
    const layout = document.getElementById('bannerLayout')?.value || 'full'
    const imagePosition = document.getElementById('bannerImagePosition')?.value || 'center'
    const sortOrder = parseInt(document.getElementById('bannerSort')?.value || '0', 10)

    if (!title) {
        if (error) {
            error.textContent = 'Введите заголовок'
            error.classList.remove('hidden')
        }
        return
    }

    const slide = {
        id: editingBannerSlideId !== null ? bannerSlidesData[editingBannerSlideId]?.id || Date.now().toString() : Date.now().toString(),
        type,
        product_id: productId || null,
        image: image || null,
        title,
        subtitle: subtitle || null,
        text: text || null,
        badge: badge || null,
        link: link || null,
        layout,
        image_position: imagePosition,
        sort_order: sortOrder
    }

    if (editingBannerSlideId !== null) {
        bannerSlidesData[editingBannerSlideId] = slide
    } else {
        bannerSlidesData.push(slide)
    }

    bannerSlidesData.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))

    await saveBannerSettings()
    closeBannerSlideModal()
    renderBannerSlidesList()
}

async function saveBannerSettings() {
    try {
        const payload = {
            promo_banner_slides: JSON.stringify(bannerSlidesData)
        }

        const response = await fetchWithTimeout(`${CONFIG.adminApiUrl}/settings`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('admin-token')}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        })

        if (response.ok) {
            showBannerError('Баннер сохранён')
        } else {
            const result = await response.json().catch(() => ({}))
            showBannerError(translateError(result.error) || 'Ошибка сохранения баннера')
        }
    } catch (error) {
        console.error('Error saving banner:', error)
        showBannerError('Ошибка сохранения баннера: ' + (error && error.message ? error.message : String(error)))
    }
}

function deleteBannerSlide(index) {
    if (!confirm('Удалить слайд?')) return
    bannerSlidesData.splice(index, 1)
    saveBannerSettings()
    renderBannerSlidesList()
}

function showBannerError(message) {
    const error = document.getElementById('bannerError')
    if (!error) return
    error.textContent = message
    error.classList.remove('hidden')
    setTimeout(() => error.classList.add('hidden'), 4000)
}

function setupGlobalTooltip() {
    const tooltip = document.getElementById('globalTooltip')
    if (!tooltip) return

    let activeHint = null
    let showTimeout = null
    let hideTimeout = null
    let isHoveringTooltip = false

    function getPlacement(hintRect) {
        const tooltipRect = tooltip.getBoundingClientRect()
        const viewportH = window.innerHeight
        const gap = 10
        const padding = 16

        const spaceAbove = hintRect.top - padding
        const spaceBelow = viewportH - hintRect.bottom - padding

        if (spaceAbove >= tooltipRect.height + gap || spaceAbove >= spaceBelow) {
            return 'top'
        }
        return 'bottom'
    }

    function positionTooltip(hint) {
        const hintRect = hint.getBoundingClientRect()
        const tooltipRect = tooltip.getBoundingClientRect()
        const viewportW = window.innerWidth
        const viewportH = window.innerHeight
        const gap = 10
        const padding = 16

        const placement = getPlacement(hintRect)

        let top
        if (placement === 'top') {
            top = hintRect.top - tooltipRect.height - gap
        } else {
            top = hintRect.bottom + gap
        }

        let left = hintRect.left + hintRect.width / 2 - tooltipRect.width / 2

        if (left < padding) {
            left = padding
        } else if (left + tooltipRect.width > viewportW - padding) {
            left = viewportW - padding - tooltipRect.width
        }

        if (top < padding) {
            top = padding
        } else if (top + tooltipRect.height > viewportH - padding) {
            top = viewportH - padding - tooltipRect.height
        }

        tooltip.style.top = `${top}px`
        tooltip.style.left = `${left}px`
        tooltip.setAttribute('data-placement', placement)
    }

    function showTooltip(hint) {
        if (hideTimeout) {
            clearTimeout(hideTimeout)
            hideTimeout = null
        }

        if (showTimeout) {
            clearTimeout(showTimeout)
        }

        const text = hint.dataset.tooltip || ''
        if (!text) return

        showTimeout = setTimeout(() => {
            tooltip.textContent = text
            tooltip.classList.add('visible')
            tooltip.setAttribute('aria-hidden', 'false')
            positionTooltip(hint)
            activeHint = hint
            showTimeout = null
        }, 400)
    }

    function hideTooltip() {
        if (showTimeout) {
            clearTimeout(showTimeout)
            showTimeout = null
        }

        hideTimeout = setTimeout(() => {
            if (!isHoveringTooltip) {
                tooltip.classList.remove('visible')
                tooltip.setAttribute('aria-hidden', 'true')
                activeHint = null
            }
            hideTimeout = null
        }, 100)
    }

    document.querySelectorAll('.field-hint').forEach(hint => {
        hint.setAttribute('aria-describedby', 'globalTooltip')
        hint.addEventListener('mouseenter', () => showTooltip(hint))
        hint.addEventListener('mouseleave', hideTooltip)
        hint.addEventListener('focus', () => showTooltip(hint))
        hint.addEventListener('blur', hideTooltip)
    })

    tooltip.addEventListener('mouseenter', () => {
        isHoveringTooltip = true
        if (hideTimeout) {
            clearTimeout(hideTimeout)
            hideTimeout = null
        }
    })

    tooltip.addEventListener('mouseleave', () => {
        isHoveringTooltip = false
        hideTooltip()
    })

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && tooltip.classList.contains('visible')) {
            tooltip.classList.remove('visible')
            tooltip.setAttribute('aria-hidden', 'true')
            if (activeHint) {
                activeHint.focus()
                activeHint = null
            }
            if (showTimeout) {
                clearTimeout(showTimeout)
                showTimeout = null
            }
            if (hideTimeout) {
                clearTimeout(hideTimeout)
                hideTimeout = null
            }
        }
    })

    document.addEventListener('scroll', () => {
        if (activeHint && tooltip.classList.contains('visible')) {
            positionTooltip(activeHint)
        }
    }, true)

    window.addEventListener('resize', () => {
        if (activeHint && tooltip.classList.contains('visible')) {
            positionTooltip(activeHint)
        }
    })
}

// ============================================
// Import/Export
// ============================================

const EXPORT_COLUMNS = [
    { key: 'description', label: 'Краткое описание', required: false },
    { key: 'full_description', label: 'Полное описание', required: false },
    { key: 'composition', label: 'Состав', required: false },
    { key: 'dosage', label: 'Дозировка', required: false },
    { key: 'usage', label: 'Способ применения', required: false },
    { key: 'contraindications', label: 'Противопоказания', required: false },
    { key: 'category', label: 'Категория', required: false },
    { key: 'brand', label: 'Бренд', required: false },
    { key: 'price', label: 'Цена', required: true },
    { key: 'old_price', label: 'Старая цена', required: false },
    { key: 'stock', label: 'Остаток', required: false },
    { key: 'volume', label: 'Объём', required: false },
    { key: 'sku', label: 'Артикул', required: false },
    { key: 'barcode', label: 'Штрих-код', required: false },
    { key: 'is_hit', label: 'Хит', required: false },
    { key: 'is_new', label: 'Новинка', required: false },
    { key: 'is_discount', label: 'Скидка', required: false },
    { key: 'is_visible', label: 'Видимость', required: false },
    { key: 'shelf_life', label: 'Срок годности', required: false },
    { key: 'stock_image', label: 'Картинка (остатки)', required: false },
    { key: 'cart_image', label: 'Картинка (корзина)', required: false },
    { key: 'wholesale_price', label: 'Оптовая цена', required: false },
    { key: 'unit', label: 'Ед. изм.', required: false }
]

const EXPORT_COLUMNS_STORAGE_KEY = 'jock-export-columns'

function getDefaultExportColumns() {
    return EXPORT_COLUMNS.filter(c => c.required).map(c => c.key)
}

function loadExportColumns() {
    try {
        const stored = localStorage.getItem(EXPORT_COLUMNS_STORAGE_KEY)
        if (stored) {
            const parsed = JSON.parse(stored)
            const validKeys = EXPORT_COLUMNS.map(c => c.key)
            const filtered = parsed.filter((k) => validKeys.includes(k))
            if (filtered.length > 0) return filtered
        }
    } catch (e) {
        console.error('Error loading export columns:', e)
    }
    return getDefaultExportColumns()
}

function saveExportColumns(keys) {
    try {
        localStorage.setItem(EXPORT_COLUMNS_STORAGE_KEY, JSON.stringify(keys))
    } catch (e) {
        console.error('Error saving export columns:', e)
    }
}

function buildExportColumnsUI() {
    const container = document.getElementById('exportColumns')
    if (!container) return

    const selectedKeys = loadExportColumns()

    container.innerHTML = EXPORT_COLUMNS.map(col => `
        <label class="checkbox-label export-column-checkbox">
            <input type="checkbox" value="${col.key}" ${selectedKeys.includes(col.key) ? 'checked' : ''} ${col.required ? 'disabled' : ''}>
            ${col.label}${col.required ? ' *' : ''}
        </label>
    `).join('')

    container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', () => {
            const checked = Array.from(container.querySelectorAll('input[type="checkbox"]:checked')).map(c => c.value)
            const requiredKeys = EXPORT_COLUMNS.filter(c => c.required).map(c => c.key)
            saveExportColumns([...new Set([...requiredKeys, ...checked])])
        })
    })
}

function getSelectedExportColumns() {
    const container = document.getElementById('exportColumns')
    if (!container) return getDefaultExportColumns()

    const checked = Array.from(container.querySelectorAll('input[type="checkbox"]:checked')).map(c => c.value)
    const requiredKeys = EXPORT_COLUMNS.filter(c => c.required).map(c => c.key)
    return [...new Set([...requiredKeys, ...checked])]
}

const IMPORT_COLUMN_MAP = {
    'наименование': 'name',
    'название': 'name',
    'остаток': 'stock',
    'артикул': 'sku',
    'штрих-код': 'barcode',
    'цена': 'price',
    'оптовая цена': 'wholesale_price',
    'старая цена': 'old_price',
    'категория': 'category',
    'бренд': 'brand',
    'состав': 'composition',
    'дозировка': 'dosage',
    'способ применения': 'usage',
    'противопоказания': 'contraindications',
    'объём': 'volume',
    'срок годности': 'shelf_life',
    'хит': 'is_hit',
    'новинка': 'is_new',
    'скидка': 'is_discount',
    'видимость': 'is_visible',
    'картинка остатки': 'stock_image',
    'картинка корзина': 'cart_image',
    'ед.изм': 'unit',
    'единица измерения': 'unit',
    'валюта': 'currency_display'
}

let importParsedData = null
let importSelectedKeys = null

function normalizeImportKey(header) {
    const lower = String(header || '').toLowerCase().trim()
    if (IMPORT_COLUMN_MAP[lower]) return IMPORT_COLUMN_MAP[lower]
    for (const [key, value] of Object.entries(IMPORT_COLUMN_MAP)) {
        if (lower.includes(key)) return value
    }
    return lower
}

function buildImportColumnsUI(headers) {
    const container = document.getElementById('importColumns')
    const section = document.getElementById('importColumnsSection')
    if (!container || !section) return

    const normalizedHeaders = headers.map(h => normalizeImportKey(h))
    const uniqueHeaders = []
    const seen = new Set()
    headers.forEach((h, idx) => {
        const norm = normalizedHeaders[idx]
        if (!seen.has(norm)) {
            seen.add(norm)
            uniqueHeaders.push({ original: h, normalized: norm })
        }
    })

    importSelectedKeys = new Set(uniqueHeaders.map(h => h.normalized))

    container.innerHTML = uniqueHeaders.map(h => `
        <label class="checkbox-label export-column-checkbox">
            <input type="checkbox" value="${escapeHtml(h.normalized)}" checked>
            ${escapeHtml(h.original)}${h.normalized !== h.original ? ` <small style="color:var(--text-secondary)">(${escapeHtml(h.normalized)})</small>` : ''}
        </label>
    `).join('')

    container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', () => {
            const checked = Array.from(container.querySelectorAll('input[type="checkbox"]:checked')).map(c => c.value)
            importSelectedKeys = new Set(checked)
        })
    })

    section.style.display = 'block'
    const importBtn = document.getElementById('importBtn')
    if (importBtn) importBtn.disabled = false
}

// ============================================
// Import/Export
// ============================================

let importFile = null

const IMPORT_HISTORY_KEY = 'jock-import-history'

function saveImportHistory(data) {
    try {
        localStorage.setItem(IMPORT_HISTORY_KEY, JSON.stringify({
            ...data,
            timestamp: Date.now()
        }))
    } catch (e) {
        console.error('Error saving import history:', e)
    }
}

function loadImportHistory() {
    try {
        const stored = localStorage.getItem(IMPORT_HISTORY_KEY)
        if (stored) return JSON.parse(stored)
    } catch (e) {
        console.error('Error loading import history:', e)
    }
    return null
}

function clearImportHistory() {
    try {
        localStorage.removeItem(IMPORT_HISTORY_KEY)
    } catch (e) {
        console.error('Error clearing import history:', e)
    }
}

function updateUndoImportButton() {
    const undoBtn = document.getElementById('undoImportBtn')
    const history = loadImportHistory()
    if (undoBtn) {
        if (history && history.createdProducts && history.createdProducts.length > 0) {
            undoBtn.style.display = 'inline-flex'
            undoBtn.textContent = `Отменить импорт (${history.createdProducts.length + history.updatedProducts.length} товаров)`
        } else {
            undoBtn.style.display = 'none'
        }
    }
}

async function undoLastImport() {
    const history = loadImportHistory()
    if (!history) {
        showError('Нет данных для отмены импорта')
        return
    }

    if (!confirm(`Отменить последний импорт?\n\nСозданные товары (${history.createdProducts.length}) будут удалены.\nОбновлённые товары (${history.updatedProducts.length}) будут восстановлены до предыдущего состояния.`)) {
        return
    }

    const token = localStorage.getItem('admin-token')
    if (!token) {
        showError('Сессия истекла. Войдите снова.')
        return
    }

    let errors = []

    try {
        for (const product of history.updatedProducts) {
            try {
                const previous = product.previous
                const updateData = {}
                const fields = [
                    "name", "description", "full_description", "composition",
                    "dosage", "usage", "contraindications", "price", "old_price",
                    "stock", "volume", "barcode", "is_hit", "is_new", "is_discount",
                    "shelf_life", "is_visible", "category_id", "brand_id"
                ]

                fields.forEach(field => {
                    if (previous[field] !== undefined && previous[field] !== null) {
                        updateData[field] = previous[field]
                    }
                })

                const response = await fetchWithTimeout(`${CONFIG.adminApiUrl}/products/${product.id}`, {
                    method: 'PUT',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(updateData)
                })

                if (!response.ok) {
                    const result = await response.json().catch(() => ({}))
                    errors.push({ id: product.id, name: product.name, error: result.error || 'Ошибка восстановления' })
                }
            } catch (err) {
                errors.push({ id: product.id, name: product.name, error: String(err) })
            }
        }

        for (const product of history.createdProducts) {
            try {
                const response = await fetchWithTimeout(`${CONFIG.adminApiUrl}/products/${product.id}`, {
                    method: 'DELETE',
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                })

                if (!response.ok) {
                    const result = await response.json().catch(() => ({}))
                    errors.push({ id: product.id, name: product.name, error: result.error || 'Ошибка удаления' })
                }
            } catch (err) {
                errors.push({ id: product.id, name: product.name, error: String(err) })
            }
        }

        if (errors.length === 0) {
            clearImportHistory()
            showError('Импорт успешно отменён')
        } else {
            showError(`Отменено с ошибками: ${errors.length}. Успешно: ${history.createdProducts.length + history.updatedProducts.length - errors.length}`)
        }
        updateUndoImportButton()
    } catch (error) {
        showError('Ошибка отмены импорта: ' + (error && error.message ? error.message : String(error)))
    }
}

function clearImportFile() {
    importFile = null
    importParsedData = null
    importSelectedKeys = null

    const importFileInput = document.getElementById('importFile')
    if (importFileInput) importFileInput.value = ''

    const importBtn = document.getElementById('importBtn')
    if (importBtn) importBtn.disabled = true

    const importFileInfo = document.getElementById('importFileInfo')
    if (importFileInfo) importFileInfo.style.display = 'none'

    const importFileName = document.getElementById('importFileName')
    if (importFileName) importFileName.textContent = ''

    const importColumnsSection = document.getElementById('importColumnsSection')
    if (importColumnsSection) importColumnsSection.style.display = 'none'

    const importColumns = document.getElementById('importColumns')
    if (importColumns) importColumns.innerHTML = ''

    const importStatus = document.getElementById('importStatus')
    if (importStatus) {
        importStatus.className = 'status-message'
        importStatus.textContent = ''
    }
}

async function handleImportFileSelect(e) {
    importFile = e.target.files[0]
    const importBtn = document.getElementById('importBtn')
    const importStatus = document.getElementById('importStatus')
    const importColumnsSection = document.getElementById('importColumnsSection')
    const importFileInfo = document.getElementById('importFileInfo')
    
    if (!importFile) {
        if (importBtn) importBtn.disabled = true
        if (importStatus) {
            importStatus.className = 'status-message'
            importStatus.textContent = ''
        }
        return
    }

    if (importStatus) {
        importStatus.className = 'status-message'
        importStatus.textContent = 'Чтение файла...'
    }

    if (typeof XLSX === 'undefined') {
        if (importStatus) {
            importStatus.className = 'status-message error'
            importStatus.textContent = 'Библиотека Excel не загружена.'
        }
        return
    }
    
    const reader = new FileReader()
    
    reader.onload = async (e) => {
        try {
            const data = new Uint8Array(e.target.result)
            const workbook = XLSX.read(data, { type: 'array' })
            if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
                throw new Error('В файле нет листов')
            }
            const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
            const jsonData = XLSX.utils.sheet_to_json(firstSheet, { header: 1 })
            
            if (!jsonData.length) {
                throw new Error('Файл пуст')
            }

            const headers = jsonData[0].filter(h => h !== null && h !== undefined && String(h).trim() !== '')
            
            if (headers.length === 0) {
                throw new Error('Не найдены заголовки столбцов')
            }

            importParsedData = {
                headers: jsonData[0],
                rows: jsonData.slice(1),
                fileName: importFile.name
            }

            const importFileName = document.getElementById('importFileName')
            if (importFileName) importFileName.textContent = `Файл: ${importFile.name}, строк: ${importParsedData.rows.length}, столбцов: ${headers.length}`

            if (importFileInfo) {
                importFileInfo.className = 'status-message success'
                importFileInfo.style.display = 'block'
            }

            buildImportColumnsUI(headers)

            if (importStatus) {
                importStatus.className = 'status-message'
                importStatus.textContent = ''
            }
        } catch (error) {
            console.error('Import file read error:', error)
            if (importStatus) {
                importStatus.className = 'status-message error'
                importStatus.textContent = 'Ошибка чтения файла: ' + (error && error.message ? error.message : String(error))
            }
            if (importColumnsSection) importColumnsSection.style.display = 'none'
            if (importBtn) importBtn.disabled = true
            importParsedData = null
        }
    }
    
    reader.readAsArrayBuffer(importFile)
}

async function handleImport() {
    if (!importParsedData || !importParsedData.headers || !importParsedData.rows) {
        showError('Сначала выберите файл')
        return
    }

    if (!importSelectedKeys || importSelectedKeys.size === 0) {
        showError('Выберите хотя бы один столбец для импорта')
        return
    }
    
    if (typeof XLSX === 'undefined') {
        showError('Библиотека Excel не загружена. Проверьте подключение к интернету и обновите страницу.')
        return
    }
    
    const rawHeaders = importParsedData.headers
    const rows = importParsedData.rows
    const selectedKeys = Array.from(importSelectedKeys)

    const colIndices = []
    const normalizedHeaders = []
    rawHeaders.forEach((h, idx) => {
        const norm = normalizeImportKey(h)
        if (selectedKeys.includes(norm)) {
            colIndices.push(idx)
            normalizedHeaders.push(norm)
        }
    })

    if (colIndices.length === 0) {
        showError('Не выбраны столбцы для импорта')
        return
    }

    const jsonData = rows.map(row => {
        const obj = {}
        colIndices.forEach((idx, i) => {
            const val = row[idx]
            obj[normalizedHeaders[i]] = val !== null && val !== undefined ? val : ''
        })
        return obj
    }).filter(row => {
        const name = row.name || row.наименование || row.название || ''
        const sku = row.sku || row.артикул || ''
        return name.trim() !== '' || sku.trim() !== ''
    })

    if (jsonData.length === 0) {
        showError('В файле нет данных для импорта')
        return
    }

    try {
        const response = await fetchWithTimeout(`${CONFIG.adminApiUrl}/import`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('admin-token')}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ products: jsonData })
        }, 60000)
        
        if (!response.ok) {
            const result = await response.json().catch(() => ({}))
            const statusEl = document.getElementById('importStatus')
            if (statusEl) {
                statusEl.className = 'status-message error'
                statusEl.textContent = translateError(result.error) || 'Ошибка импорта'
            }
            return
        }
        
        const result = await response.json()
        const statusEl = document.getElementById('importStatus')
        
        if (result.success) {
            if (result.createdProducts || result.updatedProducts) {
                saveImportHistory({
                    createdProducts: result.createdProducts || [],
                    updatedProducts: result.updatedProducts || []
                })
                updateUndoImportButton()
            }
            if (statusEl) {
                statusEl.className = 'status-message success'
                statusEl.textContent = `Импортировано: ${result.results.success} товаров`
            }
        } else {
            if (statusEl) {
                statusEl.className = 'status-message error'
                statusEl.textContent = `Ошибки: ${result.results.errors.length}. Успешно: ${result.results.success}`
            }
        }
    } catch (error) {
        console.error('Import error:', error)
        const statusEl = document.getElementById('importStatus')
        if (statusEl) {
            statusEl.className = 'status-message error'
            statusEl.textContent = 'Ошибка импорта: ' + (error && error.message ? error.message : String(error))
        }
    }
}

async function handleExport() {
    try {
        if (typeof XLSX === 'undefined') {
            showError('Библиотека Excel не загружена. Проверьте подключение к интернету и обновите страницу.')
            return
        }
        
        const response = await fetchWithTimeout(`${CONFIG.adminApiUrl}/export`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('admin-token')}` }
        })
        
        if (!response.ok) {
            const result = await response.json().catch(() => ({}))
            showError(translateError(result.error) || 'Ошибка экспорта')
            return
        }
        
        const data = await response.json()
        const selectedKeys = getSelectedExportColumns()
        const selectedColumns = EXPORT_COLUMNS.filter(c => selectedKeys.includes(c.key))
        
        const products = Array.isArray(data) ? data : []
        const flatData = products.map(p => {
            const row = {}
            selectedColumns.forEach(col => {
                switch (col.key) {
                    case 'name':
                        row[col.key] = p.name || ''
                        break
                    case 'description':
                        row[col.key] = p.description || ''
                        break
                    case 'full_description':
                        row[col.key] = p.full_description || ''
                        break
                    case 'composition':
                        row[col.key] = p.composition || ''
                        break
                    case 'dosage':
                        row[col.key] = p.dosage || ''
                        break
                    case 'usage':
                        row[col.key] = p.usage || ''
                        break
                    case 'contraindications':
                        row[col.key] = p.contraindications || ''
                        break
                    case 'category':
                        row[col.key] = p.categories?.name || ''
                        break
                    case 'brand':
                        row[col.key] = p.brands?.name || ''
                        break
                    case 'price':
                        row[col.key] = p.price ?? ''
                        break
                    case 'old_price':
                        row[col.key] = p.old_price ?? ''
                        break
                    case 'stock':
                        row[col.key] = p.stock ?? ''
                        break
                    case 'volume':
                        row[col.key] = p.volume || ''
                        break
                    case 'sku':
                        row[col.key] = p.sku || ''
                        break
                    case 'barcode':
                        row[col.key] = p.barcode || ''
                        break
                    case 'is_hit':
                        row[col.key] = p.is_hit ? 'TRUE' : 'FALSE'
                        break
                    case 'is_new':
                        row[col.key] = p.is_new ? 'TRUE' : 'FALSE'
                        break
                    case 'is_discount':
                        row[col.key] = p.is_discount ? 'TRUE' : 'FALSE'
                        break
                    case 'is_visible':
                        row[col.key] = p.is_visible ? 'TRUE' : 'FALSE'
                        break
                    case 'is_related_enabled':
                        row[col.key] = p.is_related_enabled ? 'TRUE' : 'FALSE'
                        break
                    case 'shelf_life':
                        row[col.key] = p.shelf_life || ''
                        break
                    case 'stock_image':
                        row[col.key] = p.product_images?.[0]?.url || ''
                        break
                    case 'cart_image':
                        row[col.key] = p.product_images?.[0]?.url || ''
                        break
                    case 'wholesale_price':
                        row[col.key] = ''
                        break
                    case 'unit':
                        row[col.key] = 'шт'
                        break
                    default:
                        row[col.key] = ''
                }
            })
            return row
        })
        
        const ws = XLSX.utils.json_to_sheet(flatData)
        const wb = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(wb, ws, 'Products')
        XLSX.writeFile(wb, 'jock-nutrition-catalog.xlsx')
    } catch (error) {
        console.error('Error exporting:', error)
        showError('Ошибка экспорта: ' + (error && error.message ? error.message : String(error)))
    }
}

async function handleExportTemplate() {
    try {
        if (typeof XLSX === 'undefined') {
            showError('Библиотека Excel не загружена. Проверьте подключение к интернету и обновите страницу.')
            return
        }

        const selectedKeys = getSelectedExportColumns()
        const selectedColumns = EXPORT_COLUMNS.filter(c => selectedKeys.includes(c.key))

        const headerRow = selectedColumns.map(h => h.required ? h.label + ' *' : h.label)
        const exampleRow = selectedColumns.map(h => {
            switch (h.key) {
                case 'name': return 'Пример: Витамин C 1000 мг'
                case 'category': return 'Витамины'
                case 'brand': return 'BrandX'
                case 'price': return 500
                case 'old_price': return 650
                case 'stock': return 100
                case 'volume': return '60 капсул'
                case 'sku': return 'VC-1000'
                case 'barcode': return '4601234567890'
                case 'composition': return 'Аскорбиновая кислота...'
                case 'usage': return 'По 1 капсуле в день'
                case 'contraindications': return 'Индивидуальная непереносимость'
                case 'shelf_life': return '24 месяца'
                case 'is_hit': return 'TRUE'
                case 'is_new': return 'TRUE'
                case 'is_discount': return 'FALSE'
                case 'is_visible': return 'TRUE'
                case 'stock_image': return 'https://...'
                case 'cart_image': return 'https://...'
                case 'wholesale_price': return 400
                case 'unit': return 'шт'
                default: return ''
            }
        })

        const ws = XLSX.utils.aoa_to_sheet([headerRow, exampleRow])
        const wb = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(wb, ws, 'Products')
        ws['!cols'] = selectedColumns.map(() => ({ wch: 22 }))
        XLSX.writeFile(wb, 'jock-nutrition-template.xlsx')
    } catch (error) {
        console.error('Error exporting template:', error)
        showError('Ошибка создания шаблона: ' + (error && error.message ? error.message : String(error)))
    }
}


async function handleBackup() {
    try {
        const response = await fetchWithTimeout(`${CONFIG.adminApiUrl}/backup`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('admin-token')}` }
        })
        
        if (!response.ok) {
            const result = await response.json().catch(() => ({}))
            showError(translateError(result.error) || 'Ошибка резервного копирования')
            return
        }
        
        const blob = await response.blob()
        const url = window.URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `jock-nutrition-backup-${new Date().toISOString().split('T')[0]}.json`
        a.click()
    } catch (error) {
        console.error('Error backup:', error)
        showError('Ошибка резервного копирования: ' + (error && error.message ? error.message : String(error)))
    }
}

async function handleBackupSql() {
    try {
        const response = await fetchWithTimeout(`${CONFIG.adminApiUrl}/backup-sql`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('admin-token')}` }
        })

        if (!response.ok) {
            const result = await response.json().catch(() => ({}))
            showError(translateError(result.error) || 'Ошибка SQL-дампа')
            return
        }

        const blob = await response.blob()
        const url = window.URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `jock-nutrition-backup-${new Date().toISOString().split('T')[0]}.sql`
        a.click()
    } catch (error) {
        console.error('Error SQL backup:', error)
        showError('Ошибка SQL-дампа: ' + (error && error.message ? error.message : String(error)))
    }
}

// ============================================
// AI Description Generation
// ============================================

async function handleGenerateDescriptions() {
    const apiKey = document.getElementById('geminiApiKey')?.value || localStorage.getItem('gemini-api-key') || ''
    if (!apiKey) {
        showError('Введите Gemini API ключ в настройках')
        return
    }

    const btn = document.getElementById('generateDescBtn')
    if (!btn) return
    const originalText = btn.textContent
    btn.disabled = true
    btn.textContent = '⏳ Генерация...'

    try {
        const productsRes = await fetchWithTimeout(
            `${CONFIG.adminApiUrl}/generate-descriptions`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('admin-token')}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ apiKey })
            }
        )

        if (!productsRes.ok) {
            const result = await productsRes.json().catch(() => ({}))
            throw new Error(result.error || 'Ошибка запуска генерации')
        }

        const genResult = await productsRes.json()

        showError(`Генерация завершена: ${genResult.success || 0} успешно, ${genResult.errors || 0} ошибок`)
    } catch (error) {
        showError('Ошибка при генерации описаний: ' + (error && error.message ? error.message : String(error)))
        console.error(error)
    } finally {
        btn.disabled = false
        btn.textContent = originalText
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
        text.textContent = 'Нет подключения: ' + (error && error.message ? error.message : String(error))
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
// Admin Barcode Scanner
// ============================================

function invalidateAdminScanCropCache() {
    adminScanCropCache = null
    adminScanCropVideoW = 0
    adminScanCropVideoH = 0
}

function getCachedAdminScanCrop() {
    const video = document.getElementById('adminScannerVideo')
    if (!video || !video.videoWidth || !video.videoHeight) return null
    if (adminScanCropCache && adminScanCropVideoW === video.videoWidth && adminScanCropVideoH === video.videoHeight) {
        return adminScanCropCache
    }
    adminScanCropCache = getAdminScanCrop()
    adminScanCropVideoW = video.videoWidth
    adminScanCropVideoH = video.videoHeight
    return adminScanCropCache
}

function getAdminScanCrop() {
    const video = document.getElementById('adminScannerVideo')
    const frame = document.querySelector('.admin-scanner-frame')
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

function getCameraErrorMessage(error) {
    if (!error) return 'Камера недоступна. Разрешите доступ к камере или введите штрих-код вручную.'
    const name = error.name || ''
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        return 'Доступ к камере запрещён. Разрешите доступ в настройках браузера и попробуйте снова.'
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        return 'Камера не найдена на устройстве. Используйте загрузку фото.'
    }
    if (name === 'NotReadableError' || name === 'TrackStartError') {
        return 'Камера занята другим приложением. Закройте другие приложения, использующие камеру.'
    }
    if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') {
        return 'Камера не поддерживает нужные параметры. Попробуйте другой браузер или загрузите фото.'
    }
    if (name === 'TypeError') {
        return 'Браузер не поддерживает доступ к камере. Используйте загрузку фото.'
    }
    if (name === 'NotSupportedError') {
        return 'Доступ к камере не поддерживается в этом контексте. Используйте HTTPS.'
    }
    return 'Ошибка доступа к камере: ' + (error.message || error.name || 'неизвестная ошибка')
}

async function openAdminBarcodeScanner() {
    const scanner = document.getElementById('adminBarcodeScanner')
    const nativeContainer = document.getElementById('adminScannerNative')
    const fallbackContainer = document.getElementById('adminScannerFallback')
    const statusEl = document.getElementById('adminScannerStatus')
    if (!scanner || !statusEl) return

    closeAdminBarcodeScanner()

    scanner.classList.remove('hidden')
    scanner.classList.remove('not-found')
    statusEl.textContent = 'Наведите камеру на штрих-код'
    adminScannerMode = 'none'

    if (!('BarcodeDetector' in window)) {
        statusEl.textContent = 'Сканирование камерой не поддерживается этим браузером. Включите html5-qrcode или загрузите фото.'
        await startFallbackScanner()
        return
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } }
        })
        await startNativeScanner(stream)
    } catch (error) {
        console.error('Native camera error:', error)
        statusEl.textContent = getCameraErrorMessage(error)
        await startFallbackScanner()
    }
}

async function startNativeScanner(stream) {
    const scanner = document.getElementById('adminBarcodeScanner')
    const nativeContainer = document.getElementById('adminScannerNative')
    const fallbackContainer = document.getElementById('adminScannerFallback')
    const video = document.getElementById('adminScannerVideo')
    const statusEl = document.getElementById('adminScannerStatus')
    if (!scanner || !video || !nativeContainer) return

    adminScannerMode = 'native'
    if (nativeContainer) nativeContainer.classList.remove('hidden')
    if (fallbackContainer) fallbackContainer.classList.add('hidden')

    video.srcObject = stream
    adminBarcodeStream = stream

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

    adminScannerWorker = new Worker('../scanner-worker.js')
    adminScannerWorker.onmessage = onAdminWorkerMessage
    adminScannerWorker.onerror = (err) => console.error('Admin scanner worker error:', err)

    try {
        adminScannerDetector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'code_128'] })
    } catch (err) {
        console.warn('BarcodeDetector init failed, falling back')
        closeAdminBarcodeScanner()
        if (statusEl) statusEl.textContent = 'Не удалось инициализировать сканер. Загрузите фото штрих-кода.'
        await startFallbackScanner()
        return
    }

    invalidateAdminScanCropCache()
    const crop = getAdminScanCrop()
    if (crop) {
        adminScannerWorker.postMessage({ type: 'init', crop: crop, tw: 320 })
    }

    adminScanRafId = requestAnimationFrame(adminScanLoop)
    if (statusEl) statusEl.textContent = 'Наведите камеру на штрих-код'
}

async function startFallbackScanner() {
    const scanner = document.getElementById('adminBarcodeScanner')
    const nativeContainer = document.getElementById('adminScannerNative')
    const fallbackContainer = document.getElementById('adminScannerFallback')
    const fallbackEl = document.getElementById('adminScannerHtml5Qr')
    const statusEl = document.getElementById('adminScannerStatus')
    if (!scanner || !fallbackContainer || !fallbackEl || !statusEl) return

    if (adminScanRafId) {
        cancelAnimationFrame(adminScanRafId)
        adminScanRafId = null
    }
    if (adminScannerWorker) {
        adminScannerWorker.terminate()
        adminScannerWorker = null
    }
    adminWorkerBusy = false
    adminScannerDetector = null
    invalidateAdminScanCropCache()
    if (adminBarcodeStream) {
        adminBarcodeStream.getTracks().forEach(track => track.stop())
        adminBarcodeStream = null
    }
    const video = document.getElementById('adminScannerVideo')
    if (video) video.srcObject = null

    adminScannerMode = 'fallback'
    if (nativeContainer) nativeContainer.classList.add('hidden')
    fallbackContainer.classList.remove('hidden')
    statusEl.textContent = 'Сканирование через fallback-библиотеку...'

    try {
        if (typeof Html5Qrcode === 'undefined') {
            statusEl.textContent = 'Fallback-библиотека не загрузилась. Загрузите фото штрих-кода.'
            return
        }

        if (adminHtml5QrCode) {
            try { await adminHtml5QrCode.stop() } catch (e) { /* ignore */ }
            adminHtml5QrCode = null
        }

        adminHtml5QrCode = new Html5Qrcode('adminScannerHtml5Qr')
        const cameraConfig = { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } }

        await adminHtml5QrCode.start(
            cameraConfig,
            {
                fps: 10,
                qrbox: { width: 250, height: 120 },
                formatsToSupport: [
                    Html5QrcodeSupportedFormats.EAN_13,
                    Html5QrcodeSupportedFormats.EAN_8,
                    Html5QrcodeSupportedFormats.CODE_128,
                    Html5QrcodeSupportedFormats.CODE_39,
                    Html5QrcodeSupportedFormats.UPC_A,
                    Html5QrcodeSupportedFormats.UPC_E
                ]
            },
            (decodedText) => {
                handleAdminBarcodeDetected(decodedText)
            },
            () => { /* ignore scan failures */ }
        )

        statusEl.textContent = 'Наведите камеру на штрих-код (fallback)'
    } catch (error) {
        console.error('Fallback scanner error:', error)
        statusEl.textContent = 'Не удалось запустить сканер. Загрузите фото штрих-кода.'
        if (adminHtml5QrCode) {
            try { await adminHtml5QrCode.stop() } catch (e) { /* ignore */ }
            adminHtml5QrCode = null
        }
    }
}

async function handleAdminFileUpload(e) {
    const file = (e.target && e.target.files && e.target.files[0]) || (e.target.target && e.target.target.files && e.target.target.files[0])
    if (!file) return

    const statusEl = document.getElementById('adminScannerStatus')
    if (statusEl) statusEl.textContent = 'Обработка изображения...'

    try {
        if ('BarcodeDetector' in window) {
            const bitmap = await createImageBitmap(file)
            try {
                const detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e'] })
                const barcodes = await detector.detect(bitmap)
                const code = barcodes.length > 0 ? barcodes[0].rawValue : null
                if (code) {
                    handleAdminBarcodeDetected(code)
                    return
                }
            } catch (err) {
                console.error('BarcodeDetect on file error:', err)
            } finally {
                bitmap.close()
            }
        }

        if (typeof Html5Qrcode !== 'undefined') {
            const fileScanner = new Html5Qrcode('adminScannerFileContainer')
            const result = await fileScanner.scanFile(file, true)
            fileScanner.clear()
            if (result) {
                handleAdminBarcodeDetected(result)
                return
            }
        }

        if (statusEl) statusEl.textContent = 'Штрих-код на изображении не найден. Попробуйте другое фото.'
    } catch (error) {
        console.error('File scan error:', error)
        if (statusEl) statusEl.textContent = 'Ошибка обработки изображения. Попробуйте другое фото.'
    } finally {
        const fileInput = document.getElementById('adminScannerFileInput')
        if (fileInput) fileInput.value = ''
    }
}

function adminScanLoop(timestamp) {
    if (!adminBarcodeStream || adminScannerMode !== 'native') return
    if (!adminScannerWorker) return

    const video = document.getElementById('adminScannerVideo')
    if (!video) return

    if (timestamp - adminScanLastTime < ADMIN_SCAN_INTERVAL_MS) {
        adminScanRafId = requestAnimationFrame(adminScanLoop)
        return
    }

    if (video.readyState >= 2 && video.videoWidth > 0 && !adminWorkerBusy) {
        if (video.currentTime !== adminLastVideoTime) {
            adminLastVideoTime = video.currentTime
            adminWorkerBusy = true
            adminScanLastTime = timestamp
            try {
                const crop = getCachedAdminScanCrop()
                if (crop && crop.w > 0 && crop.h > 0) {
                    createImageBitmap(video).then(bitmap => {
                        if (adminWorkerBusy || !adminScannerWorker) {
                            bitmap.close()
                            adminWorkerBusy = false
                        } else {
                            adminScannerWorker.postMessage({
                                type: 'scan',
                                bitmap: bitmap,
                                crop: crop,
                                tw: 320
                            }, [bitmap])
                        }
                    }).catch((err) => {
                        console.error('createImageBitmap error:', err)
                        adminWorkerBusy = false
                    })
                } else {
                    adminWorkerBusy = false
                }
            } catch (error) {
                console.error('Scan error:', error)
                adminWorkerBusy = false
            }
        } else {
            adminWorkerBusy = false
        }
    }

    adminScanRafId = requestAnimationFrame(adminScanLoop)
}

function onAdminWorkerMessage(e) {
    const { type, error, bitmap } = e.data

    if (type === 'init_error') {
        console.warn('Worker init failed')
        adminWorkerBusy = false
        closeAdminBarcodeScanner()
        return
    }

    if (type === 'result' && bitmap) {
        if (adminScannerDetector) {
            adminScannerDetector.detect(bitmap).then(barcodes => {
                const code = barcodes.length > 0 ? barcodes[0].rawValue : null
                if (code) {
                    handleAdminBarcodeDetected(code)
                }
            }).catch(err => {
                console.error('Detect error:', err)
            }).finally(() => {
                adminWorkerBusy = false
                if (bitmap && typeof bitmap.close === 'function') {
                    bitmap.close()
                }
            })
        } else {
            adminWorkerBusy = false
            if (bitmap && typeof bitmap.close === 'function') {
                bitmap.close()
            }
        }
    } else if (type === 'error') {
        console.error('Scanner worker error:', error)
        adminWorkerBusy = false
    }
}

function handleAdminBarcodeDetected(code) {
    const prodBarcode = document.getElementById('prodBarcode')
    const scanner = document.getElementById('adminBarcodeScanner')
    const statusEl = document.getElementById('adminScannerStatus')

    if (prodBarcode) {
        prodBarcode.value = code
    }

    if (navigator.vibrate) navigator.vibrate(200)
    if (statusEl) statusEl.textContent = 'Штрих-код найден: ' + code

    setTimeout(() => {
        closeAdminBarcodeScanner()
    }, 600)
}

function closeAdminBarcodeScanner() {
    if (adminScanRafId) {
        cancelAnimationFrame(adminScanRafId)
        adminScanRafId = null
    }
    if (adminScannerWorker) {
        adminScannerWorker.terminate()
        adminScannerWorker = null
    }
    adminWorkerBusy = false
    adminScannerDetector = null
    adminScanLastTime = 0
    adminLastVideoTime = -1
    invalidateAdminScanCropCache()
    if (adminBarcodeStream) {
        adminBarcodeStream.getTracks().forEach(track => track.stop())
        adminBarcodeStream = null
    }
    if (adminHtml5QrCode) {
        try { adminHtml5QrCode.stop() } catch (e) { /* ignore */ }
        adminHtml5QrCode = null
    }
    adminScannerMode = 'none'
    const scanner = document.getElementById('adminBarcodeScanner')
    if (scanner) {
        scanner.classList.add('hidden')
        scanner.classList.remove('not-found')
    }
    const video = document.getElementById('adminScannerVideo')
    if (video) video.srcObject = null
    const fileInput = document.getElementById('adminScannerFileInput')
    if (fileInput) fileInput.value = ''
    const nativeContainer = document.getElementById('adminScannerNative')
    const fallbackContainer = document.getElementById('adminScannerFallback')
    if (nativeContainer) nativeContainer.classList.remove('hidden')
    if (fallbackContainer) fallbackContainer.classList.add('hidden')
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
let swControllerListenerAdded = false

function registerServiceWorker() {
    if ('serviceWorker' in navigator && location.pathname.startsWith('/admin/')) {
        navigator.serviceWorker.register('../sw.js')
            .then(reg => {
                if (navigator.serviceWorker.controller && !swControllerListenerAdded) {
                    swControllerListenerAdded = true
                    navigator.serviceWorker.addEventListener('controllerchange', () => location.reload())
                }
                reg.update()
            })
            .catch(error => console.error('Service Worker registration failed:', error))
    }
}

// Initialize
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        init()
        registerServiceWorker()
    })
} else {
    init()
    registerServiceWorker()
}
