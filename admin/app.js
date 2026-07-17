// ============================================
// Admin Panel JavaScript
// ============================================

const CONFIG = {
    // Замените на реальные значения из вашего Supabase проекта
    supabaseUrl: 'https://YOUR_PROJECT_ID.supabase.co',
    supabaseAnonKey: 'YOUR_ANON_KEY',
    adminApiUrl: 'https://YOUR_PROJECT_ID.supabase.co/functions/v1/admin-api',
    orderFunctionUrl: 'https://YOUR_PROJECT_ID.supabase.co/functions/v1/create-order'
}

let supabase = null
let currentPage = 'products'
let editingProductId = null
let productImages = []
let productLinks = []
let monitorInterval = null
let salesChart = null

function init() {
    const token = localStorage.getItem('admin-token')
    
    if (token) {
        showAdminPage()
        loadPageData(currentPage)
    } else {
        showAuthPage()
    }

    setupEventListeners()
    startMonitor()
}

function setupEventListeners() {
    // Login
    document.getElementById('loginForm').addEventListener('submit', handleLogin)
    document.getElementById('forgotPassword').addEventListener('click', handleForgotPassword)
    document.getElementById('logoutBtn').addEventListener('click', handleLogout)

    // Navigation
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            const page = item.dataset.page
            switchPage(page)
        })
    })

    // Products
    document.getElementById('addProductBtn').addEventListener('click', () => openProductModal())
    document.getElementById('productSearch').addEventListener('input', debounce(() => loadProducts(), 300))
    document.getElementById('cancelProduct').addEventListener('click', closeProductModal)
    document.getElementById('productForm').addEventListener('submit', handleProductSubmit)
    document.getElementById('addLinkBtn').addEventListener('click', addLinkField)

    // Categories
    document.getElementById('addCategoryBtn').addEventListener('click', openCategoryModal)

    // Brands
    document.getElementById('addBrandBtn').addEventListener('click', openBrandModal)

    // Analytics
    document.getElementById('analyticsPeriod').addEventListener('change', () => loadAnalytics())

    // Settings
    document.getElementById('settingsForm').addEventListener('submit', handleSettingsSave)
    document.getElementById('changePasswordForm').addEventListener('submit', handleChangePassword)

    // Import/Export
    document.getElementById('importFileBtn').addEventListener('click', () => document.getElementById('importFile').click())
    document.getElementById('importFile').addEventListener('change', handleImportFileSelect)
    document.getElementById('importBtn').addEventListener('click', handleImport)
    document.getElementById('exportBtn').addEventListener('click', handleExport)
    document.getElementById('backupBtn').addEventListener('click', handleBackup)

    // Modal
    document.querySelector('.modal-close').addEventListener('click', closeProductModal)
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
        // For demo purposes, using Supabase Auth
        // In production, use proper Supabase client
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
            throw new Error(data.msg || 'Неверный email или пароль')
        }
    } catch (error) {
        errorEl.textContent = error.message
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
            body: JSON.stringify({ email })
        })
        
        if (response.ok) {
            alert('Письмо для сброса пароля отправлено на почту')
        } else {
            alert('Ошибка отправки письма')
        }
    } catch (error) {
        alert('Ошибка: ' + error.message)
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
    const params = new URLSearchParams({ limit: '20', page: '1' })
    if (search) params.set('search', search)
    
    const response = await fetch(`${CONFIG.adminApiUrl}/products?${params}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('admin-token')}` }
    })
    
    const { data, total } = await response.json()
    
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
                <button class="btn btn-sm btn-danger" onclick="deleteProduct('${product.id}')">🗑️</button>
            </td>
        </tr>
    `).join('')
}

function openProductModal(productId = null) {
    editingProductId = productId
    document.getElementById('modalTitle').textContent = productId ? 'Редактировать товар' : 'Добавить товар'
    
    // Reset form
    document.getElementById('productForm').reset()
    productImages = []
    productLinks = []
    document.getElementById('imagePreview').innerHTML = ''
    document.getElementById('linksContainer').innerHTML = ''
    
    if (productId) {
        // Load product data
        // For demo, we'll use the existing data from products array
    }
    
    // Load categories and brands
    loadFormOptions()
    
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
    
    const categories = await categoriesRes.json()
    const brands = await brandsRes.json()
    
    document.getElementById('prodCategory').innerHTML = 
        '<option value="">Не выбрана</option>' +
        categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('')
    
    document.getElementById('prodBrand').innerHTML = 
        '<option value="">Не выбран</option>' +
        brands.map(b => `<option value="${b.id}">${b.name}</option>`).join('')
}

async function handleProductSubmit(e) {
    e.preventDefault()
    
    const productData = {
        name: document.getElementById('prodName').value,
        description: document.getElementById('prodDescription').value,
        full_description: document.getElementById('prodFullDescription').value,
        composition: document.getElementById('prodComposition').value,
        dosage: document.getElementById('prodDosage').value,
        usage: document.getElementById('prodUsage').value,
        contraindications: document.getElementById('prodContraindications').value,
        category_id: document.getElementById('prodCategory').value || null,
        brand_id: document.getElementById('prodBrand').value || null,
        price: parseInt(document.getElementById('prodPrice').value),
        old_price: document.getElementById('prodOldPrice').value ? parseInt(document.getElementById('prodOldPrice').value) : null,
        stock: parseInt(document.getElementById('prodStock').value),
        volume: document.getElementById('prodVolume').value,
        sku: document.getElementById('prodSku').value,
        barcode: document.getElementById('prodBarcode').value,
        is_hit: document.getElementById('prodIsHit').checked,
        is_new: document.getElementById('prodIsNew').checked,
        is_discount: document.getElementById('prodIsDiscount').checked,
        shelf_life: document.getElementById('prodShelfLife').value,
        is_visible: document.getElementById('prodIsVisible').value === 'true'
    }
    
    // Handle images
    const imageInput = document.getElementById('prodImages')
    if (imageInput.files.length > 0) {
        // Upload images to Supabase Storage
        for (const file of imageInput.files) {
            const formData = new FormData()
            formData.append('file', file)
            
            const uploadRes = await fetch(`${CONFIG.supabaseUrl}/storage/v1/object/product-images/${Date.now()}-${file.name}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('admin-token')}`,
                    'apikey': CONFIG.supabaseAnonKey
                },
                body: formData
            })
            
            if (uploadRes.ok) {
                const imageUrl = `${CONFIG.supabaseUrl}/storage/v1/object/public/product-images/${Date.now()}-${file.name}`
                productImages.push({ url: imageUrl })
            }
        }
    }
    
    // Handle links
    const linkInputs = document.querySelectorAll('.link-item input')
    productLinks = Array.from(linkInputs).map(input => ({
        url: input.value,
        title: ''
    })).filter(l => l.url)
    
    const body = {
        ...productData,
        images: productImages,
        links: productLinks
    }
    
    const url = editingProductId 
        ? `${CONFIG.adminApiUrl}/products/${editingProductId}`
        : `${CONFIG.adminApiUrl}/products`
    
    const method = editingProductId ? 'PUT' : 'POST'
    
    const response = await fetch(url, {
        method,
        headers: {
            'Authorization': `Bearer ${localStorage.getItem('admin-token')}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    })
    
    if (response.ok) {
        closeProductModal()
        loadProducts()
    } else {
        alert('Ошибка сохранения товара')
    }
}

function addLinkField() {
    const container = document.getElementById('linksContainer')
    const div = document.createElement('div')
    div.className = 'link-item'
    div.innerHTML = `<input type="url" placeholder="https://..." required>`
    container.appendChild(div)
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

// ============================================
// Categories
// ============================================

async function loadCategories() {
    const response = await fetch(`${CONFIG.adminApiUrl}/categories`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('admin-token')}` }
    })
    
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

function openCategoryModal(categoryId = null) {
    const name = categoryId ? prompt('Новое название категории:') : prompt('Название категории:')
    if (!name) return
    
    const url = categoryId 
        ? `${CONFIG.adminApiUrl}/categories/${categoryId}`
        : `${CONFIG.adminApiUrl}/categories`
    
    const method = categoryId ? 'PUT' : 'POST'
    
    fetch(url, {
        method,
        headers: {
            'Authorization': `Bearer ${localStorage.getItem('admin-token')}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name })
    }).then(() => loadCategories())
}

async function deleteCategory(id) {
    if (!confirm('Удалить категорию?')) return
    
    await fetch(`${CONFIG.adminApiUrl}/categories/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('admin-token')}` }
    })
    
    loadCategories()
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

function openBrandModal(brandId = null) {
    const name = brandId ? prompt('Новое название бренда:') : prompt('Название бренда:')
    if (!name) return
    
    const url = brandId 
        ? `${CONFIG.adminApiUrl}/brands/${brandId}`
        : `${CONFIG.adminApiUrl}/brands`
    
    const method = brandId ? 'PUT' : 'POST'
    
    fetch(url, {
        method,
        headers: {
            'Authorization': `Bearer ${localStorage.getItem('admin-token')}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name })
    }).then(() => loadBrands())
}

async function deleteBrand(id) {
    if (!confirm('Удалить бренд?')) return
    
    await fetch(`${CONFIG.adminApiUrl}/brands/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('admin-token')}` }
    })
    
    loadBrands()
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
    const ordersRes = await fetch(`${CONFIG.adminApiUrl}/orders?period=${period}&limit=50`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('admin-token')}` }
    })
    
    const ordersData = await ordersRes.json()
    
    document.getElementById('ordersTable').innerHTML = ordersData.data.map(order => `
        <tr>
            <td>${order.order_number}</td>
            <td>${order.items.map(i => `${i.name} (${i.quantity})`).join(', ')}</td>
            <td>${order.total.toLocaleString()} ₽</td>
            <td>${new Date(order.created_at).toLocaleString('ru-RU')}</td>
        </tr>
    `).join('')
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
            alert(data.msg || 'Ошибка изменения пароля')
        }
    } catch (error) {
        alert('Ошибка: ' + error.message)
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
    
    const blob = await response.blob()
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `jack-nutrition-backup-${new Date().toISOString().split('T')[0]}.json`
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
        const response = await fetch(CONFIG.orderFunctionUrl.replace('/create-order', '/health'), {
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
    const settings = await fetch(`${CONFIG.adminApiUrl}/settings`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('admin-token')}` }
    }).then(r => r.json())
    
    const whatsappNumber = settings.whatsapp_number?.replace(/\D/g, '')
    if (whatsappNumber) {
        const url = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`
        window.open(url, '_blank')
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

// Initialize
document.addEventListener('DOMContentLoaded', init)
