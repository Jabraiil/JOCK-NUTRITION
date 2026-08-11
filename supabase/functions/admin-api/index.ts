import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

serve(async (req) => {
  const origin = req.headers.get("origin") || ""
  const allowedOrigins = [
      "https://jabraiil.github.io",
      "https://jabraiil.github.io/JOCK-NUTRITION"
  ]
  const corsHeaders = {
      "Access-Control-Allow-Origin": allowedOrigins.includes(origin) ? origin : allowedOrigins[0],
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Max-Age": "86400"
  }

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    async function saveRelated(productId: string, related: string[]) {
      if (!Array.isArray(related)) return

      await supabase.from("product_related").delete().eq("product_id", productId)

      const unique = [...new Set(related.filter(Boolean))]
      if (unique.length === 0) return

      const rows = unique.map((relatedId: string, idx: number) => ({
        product_id: productId,
        related_id: relatedId,
        sort_order: idx
      }))

      await supabase.from("product_related").insert(rows)
    }

    async function callGemini(apiKey: string, prompt: string, params: any = {}, attempts = 3) {
      const body: any = {
        contents: [
          {
            parts: [{ text: prompt }]
          }
        ],
        generationConfig: {
          temperature: params.temperature ?? 0.3,
          maxOutputTokens: params.maxOutputTokens ?? 1500,
          responseMimeType: params.responseMimeType || 'text/plain'
        }
      }

      if (params.responseMimeType === 'application/json') {
        body.generationConfig.responseSchema = params.responseSchema || {
          type: 'object',
          properties: {
            description: { type: 'string' },
            full_description: { type: 'string' },
            composition: { type: 'string' },
            dosage: { type: 'string' },
            usage: { type: 'string' },
            contraindications: { type: 'string' }
          },
          required: ['description', 'full_description', 'composition', 'dosage', 'usage', 'contraindications']
        }
      }

      for (let i = 0; i < attempts; i++) {
        try {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`
          const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
          })

          if (response.ok) {
            const data = await response.json()
            const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
            
            if (!text) {
              console.warn(`Empty Gemini response for attempt ${i + 1}`)
              if (i < attempts - 1) {
                await new Promise(r => setTimeout(r, Math.pow(2, i) * 2000))
                continue
              }
              throw new Error('Empty response from AI')
            }
            
            return { text, raw: data }
          }

          const errData = await response.json().catch(() => ({}))
          const errorMsg = errData.error?.message || errData.error || `AI API error: ${response.status}`

          if ((response.status === 429 || response.status === 503) && i < attempts - 1) {
            const delay = Math.pow(2, i) * 3000
            console.warn(`Gemini rate limit/server busy, retrying in ${delay}ms...`)
            await new Promise(r => setTimeout(r, delay))
            continue
          }

          throw new Error(errorMsg)
        } catch (err) {
          if (i < attempts - 1) {
            const delay = Math.pow(2, i) * 2000
            console.warn(`Gemini call failed, retrying in ${delay}ms...`)
            await new Promise(r => setTimeout(r, delay))
            continue
          }
          throw err
        }
      }
    }

    async function detectProductType(name: string): Promise<{ type: string; category: string }> {
      const lower = (name || '').toLowerCase()
      const perfumeKeywords = ['парфюм', 'духи', 'perfume', 'cologne', 'eau de toilette', 'eau de parfum', 'edt', 'edp', 'парфюмер', 'аромат']
      const pharmacyKeywords = ['таблетки', 'мазь', 'гель', 'спрей', 'сироп', 'пластырь', 'спирт', 'раствор', 'ампулы', 'свечи', 'суппозитории', 'сироп', 'инъекции', 'масло для', 'бальзам', 'лосьон']
      
      for (const kw of perfumeKeywords) {
        if (lower.includes(kw)) return { type: 'perfume', category: 'Парфюм' }
      }
      for (const kw of pharmacyKeywords) {
        if (lower.includes(kw)) return { type: 'pharmacy', category: 'Аптека' }
      }
      return { type: 'supplement', category: 'БАДы' }
    }
    async function generateProductDescription(product: any, apiKey: string) {
      const brandName = product.brands?.name || ''
      const productName = product.name || ''
      const volume = product.volume || ''
      const composition = product.composition || ''
      const detected = detectProductType(productName)
      const productType = detected.type
      const categoryName = detected.category

      const isPerfume = productType === 'perfume'
      const isPharmacy = productType === 'pharmacy'
      const isSupplement = productType === 'supplement'

      const prompt = `Создай описание для товара в интернет-магазине.

Название: "${productName}"
Бренд: "${brandName}"
Категория: "${categoryName}"
Объём/количество в упаковке: "${volume || 'не указан'}"
${isSupplement && composition ? `Состав по умолчанию для этого типа: "${composition}"` : ''}

Ответь ТОЛЬКО валидным JSON с точными полями:

{
  "description": "Краткое описание 3-4 строки. Без воды, без рекламных фраз. Просто и понятно: для чего этот товар, какой эффект даёт, кто его обычно покупает. Язычком для обычного человека.",
  "full_description": "Развёрнутое описание 5-7 строк. Удобное для чтения на мобильном и ПК. Короткие абзацы. Объясни простым языком: что это, как работает, что даст пользователю. Если указан объём/количество в упаковке — используй его для расчёта 'хватит на X дней' на основе типовой дозировки для этого типа товара.",
  "composition": "Состав. Для БАДов и аптечных товаров — перечисли основные активные компоненты с дозировками как на упаковке, переведя на русский. Для парфюма — перечисли аромат, семейство, ноты как на упаковке, переведя на русский.",
  "dosage": "Дозировка с упаковки, переведённая на русский. Для парфюма — объём флакона. Если есть информация по объёму — оформи красиво с расчётом на сколько дней хватит.",
  "usage": "Способ применения дословно с упаковки, переведённый на русский язык. Для парфюма — способ нанесения.",
  "contraindications": "${isPerfume ? 'Для парфюма не указывай противопоказания. Оставь пустым.' : 'Стандартные противопоказания: индивидуальная непереносимость, беременность, кормление грудью. Для аптечных товаров добавь характерные противопоказания для этого типа препарата.'}"
}

Правила:
- description: максимум 4 строки, без воды, понятно каждому
- full_description: 5-7 строк, короткие абзацы, удобно читать на телефоне
- composition: точный состав как на упаковке, переведённый на русский
- dosage: дозировка как на упаковке, переведённая на русский, красиво отформатировать
- usage: способ применения как на упаковке, переведённый на русский, кратко
- contraindications: ${isPerfume ? 'пусто для парфюма' : 'только фактические, без выдуманных'}
- Не придумывай состав, дозировку и способ применения — используй только общеизвестные стандартные данные для этого типа товара и информации из названия/объёма.`

      const data = await callGemini(apiKey, prompt, {
        temperature: 0.3,
        maxOutputTokens: 1500,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'object',
          properties: {
            description: { type: 'string' },
            full_description: { type: 'string' },
            composition: { type: 'string' },
            dosage: { type: 'string' },
            usage: { type: 'string' },
            contraindications: { type: 'string' }
          },
          required: ['description', 'full_description', 'composition', 'dosage', 'usage', 'contraindications']
        }
      })

      const rawText = data.text
      if (!rawText) throw new Error('Empty response from AI')

      let parsed
      try {
        parsed = JSON.parse(rawText)
      } catch (e) {
        console.error('Failed to parse AI response:', rawText)
        return null
      }

      const auditPrompt = `Проверь описание товара.

Название: "${productName}"
Категория: "${categoryName}"

Description: "${parsed.description || ''}"
Full description: "${parsed.full_description || ''}"
Composition: "${parsed.composition || ''}"
Dosage: "${parsed.dosage || ''}"
Usage: "${parsed.usage || ''}"
Contraindications: "${parsed.contraindications || ''}"

Правила проверки:
- description максимум 4 строки, без воды, понятно
- full_description 5-7 строк, короткие абзацы, удобно для телефона
- composition соответствует типу товара
- dosage переведён на русский
- usage переведён на русский
- contraindications: для парфюма пусто, для остальных — стандартные

Ответь "OK" если всё хорошо, или "ERROR: причина" если есть проблемы.`

      const auditData = await callGemini(apiKey, auditPrompt, {
        temperature: 0.1,
        maxOutputTokens: 100,
        responseMimeType: 'text/plain'
      })

      const auditResult = auditData.text?.trim() || ''
      if (auditResult.toLowerCase().includes('error:')) {
        console.warn('Self-audit failed for product:', productName, auditResult)
        return null
      }

      return parsed
    }

    // Verify JWT token
    const authHeader = req.headers.get("Authorization")
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Не авторизован" }),
        { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } }
      )
    }

    const token = authHeader.replace("Bearer ", "")
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Сессия истекла. Войдите снова." }),
        { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } }
      )
    }

    // Check if user is admin
    const { data: adminUser, error: adminError } = await supabase
      .from("admin_users")
      .select("*")
      .ilike("email", user.email)
      .single()

    if (adminError || !adminUser) {
      return new Response(
        JSON.stringify({ error: "Доступ запрещён" }),
        { status: 403, headers: { "Content-Type": "application/json", ...corsHeaders } }
      )
    }

    const url = new URL(req.url)
    let path = url.pathname

    if (path.startsWith('/functions/v1/admin-api')) {
        path = path.replace('/functions/v1/admin-api', '')
    } else if (path.startsWith('/admin-api')) {
        path = path.replace('/admin-api', '')
    }

    // GET /settings
    if (req.method === "GET" && path === "/settings") {
      const { data, error } = await supabase
        .from("settings")
        .select("*")

      if (error) throw error

      const settingsMap = {}
      for (const s of data) {
        settingsMap[s.key] = s.value
      }

      return new Response(
        JSON.stringify(settingsMap),
        { headers: { "Content-Type": "application/json", ...corsHeaders } }
      )
    }

    // PUT /settings
    if (req.method === "PUT" && path === "/settings") {
      const body = await req.json()

      for (const [key, value] of Object.entries(body)) {
        const normalized = value === '' || value === null || value === undefined ? null : String(value)
        await supabase
          .from("settings")
          .upsert({ key, value: normalized }, { onConflict: "key" })
      }

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { "Content-Type": "application/json", ...corsHeaders } }
      )
    }

    // GET /products/:id
    if (req.method === "GET" && path.match(/^\/products\/[^/]+$/)) {
      const productId = path.split("/")[2]

      const { data: product, error: productError } = await supabase
        .from("products")
        .select("*, categories(name), brands(name)")
        .eq("id", productId)
        .single()

      if (productError) throw productError

      const { data: images } = await supabase
        .from("product_images")
        .select("*")
        .eq("product_id", productId)
        .order("sort_order")

      const { data: links } = await supabase
        .from("product_links")
        .select("*")
        .eq("product_id", productId)
        .order("sort_order")

      const { data: related } = await supabase
        .from("product_related")
        .select("product_id, related_id")
        .eq("product_id", productId)
        .order("sort_order")

      const result = {
        ...product,
        images: images || [],
        links: links || [],
        related: related?.map(rel => rel.related_id) || []
      }

      return new Response(
        JSON.stringify(result),
        { headers: { "Content-Type": "application/json", ...corsHeaders } }
      )
    }

    // GET /products
    if (req.method === "GET" && path.startsWith("/products")) {
      const search = url.searchParams.get("search") || ""
      const category = url.searchParams.get("category") || ""
      const brand = url.searchParams.get("brand") || ""
      const page = parseInt(url.searchParams.get("page") || "1")
      const limit = parseInt(url.searchParams.get("limit") || "20")
      const offset = (page - 1) * limit

      let query = supabase
        .from("products")
        .select("*, categories(name), brands(name)", { count: "exact" })

      if (search) {
        const escaped = search.replace(/%/g, '\\%').replace(/_/g, '\\_').replace(/,/g, '\\,')
        query = query.or(`name.ilike.%${escaped}%,sku.ilike.%${escaped}%,barcode.ilike.%${escaped}%`)
      }

      if (category) {
        query = query.eq("category_id", category)
      }

      if (brand) {
        query = query.eq("brand_id", brand)
      }

      const { data, error, count } = await query
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1)

      if (error) throw error

      // Get images, links and related products for each product
      const productIds = data?.map(p => p.id) || []
      const { data: images } = await supabase
        .from("product_images")
        .select("*")
        .in("product_id", productIds)
        .order("sort_order")

      const { data: links } = await supabase
        .from("product_links")
        .select("*")
        .in("product_id", productIds)
        .order("sort_order")

      const { data: related } = await supabase
        .from("product_related")
        .select("product_id, related_id")
        .in("product_id", productIds)
        .order("sort_order")

      const productsWithRelations = data?.map(product => ({
        ...product,
        images: images?.filter(img => img.product_id === product.id) || [],
        links: links?.filter(link => link.product_id === product.id) || [],
        related: related?.filter(rel => rel.product_id === product.id).map(rel => rel.related_id) || []
      })) || []

      return new Response(
        JSON.stringify({ data: productsWithRelations, total: count }),
        { headers: { "Content-Type": "application/json", ...corsHeaders } }
      )
    }

    // POST /products
    if (req.method === "POST" && path === "/products") {
      const body = await req.json()
      const { images, links, related, ...productData } = body

      const normalized = {
        ...productData,
        category_id: productData.category_id || null,
        brand_id: productData.brand_id || null,
        sku: productData.sku || null,
        barcode: productData.barcode || null,
        is_visible: productData.is_visible !== false
      }

      const { data: product, error } = await supabase
        .from("products")
        .insert(normalized)
        .select()
        .single()

      if (error) {
        return new Response(
          JSON.stringify({ error: error.message }),
          { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
        )
      }

      if (Array.isArray(images) && images.length > 0) {
        const hasMain = images.some(img => img.is_main)
        const imagesToInsert = images.map((img, idx) => ({
          product_id: product.id,
          url: img.url,
          is_main: hasMain ? Boolean(img.is_main) : idx === 0,
          sort_order: idx
        }))
        await supabase.from("product_images").insert(imagesToInsert)
      }

      if (Array.isArray(links) && links.length > 0) {
        const linksToInsert = links.map((link, idx) => ({
          product_id: product.id,
          url: link.url,
          title: link.title || "",
          sort_order: idx
        }))
        await supabase.from("product_links").insert(linksToInsert)
      }

      await saveRelated(product.id, related)

      return new Response(
        JSON.stringify(product),
        { headers: { "Content-Type": "application/json", ...corsHeaders } }
      )
    }

    // PUT /products/:id
    if (req.method === "PUT" && path.match(/^\/products\/[^/]+$/)) {
      const productId = path.split("/")[2]
      const body = await req.json()
      const { images, links, related, ...productData } = body

      const normalized = {
        ...productData,
        category_id: productData.category_id || null,
        brand_id: productData.brand_id || null,
        sku: productData.sku || null,
        barcode: productData.barcode || null
      }

      const { data: product, error } = await supabase
        .from("products")
        .update(normalized)
        .eq("id", productId)
        .select()
        .single()

      if (error) {
        return new Response(
          JSON.stringify({ error: error.message }),
          { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
        )
      }

      if (Array.isArray(images)) {
        await supabase.from("product_images").delete().eq("product_id", productId)
        if (images.length > 0) {
          const hasMain = images.some(img => img.is_main)
          const imagesToInsert = images.map((img, idx) => ({
            product_id: productId,
            url: img.url,
            is_main: hasMain ? Boolean(img.is_main) : idx === 0,
            sort_order: idx
          }))
          await supabase.from("product_images").insert(imagesToInsert)
        }
      }

      if (Array.isArray(links)) {
        await supabase.from("product_links").delete().eq("product_id", productId)
        if (links.length > 0) {
          const linksToInsert = links.map((link, idx) => ({
            product_id: productId,
            url: link.url,
            title: link.title || "",
            sort_order: idx
          }))
          await supabase.from("product_links").insert(linksToInsert)
        }
      }

      await saveRelated(productId, related)

      return new Response(
        JSON.stringify(product),
        { headers: { "Content-Type": "application/json", ...corsHeaders } }
      )
    }

    // DELETE /products/:id
    if (req.method === "DELETE" && path.match(/^\/products\/[^/]+$/)) {
      const productId = path.split("/")[2]
      
      const { error } = await supabase
        .from("products")
        .delete()
        .eq("id", productId)

      if (error) throw error

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { "Content-Type": "application/json", ...corsHeaders } }
      )
    }

    // GET /categories/:id
    if (req.method === "GET" && path.match(/^\/categories\/[^/]+$/)) {
      const categoryId = path.split("/")[2]

      const { data, error } = await supabase
        .from("categories")
        .select("*")
        .eq("id", categoryId)
        .single()

      if (error) throw error

      return new Response(
        JSON.stringify(data),
        { headers: { "Content-Type": "application/json", ...corsHeaders } }
      )
    }

    // GET /categories
    if (req.method === "GET" && path === "/categories") {
      const { data, error } = await supabase
        .from("categories")
        .select("*")
        .order("name")

      if (error) throw error

      return new Response(
        JSON.stringify(data),
        { headers: { "Content-Type": "application/json", ...corsHeaders } }
      )
    }

    // POST /categories
    if (req.method === "POST" && path === "/categories") {
      const body = await req.json()
      const { data, error } = await supabase
        .from("categories")
        .insert({ name: body.name })
        .select()
        .single()

      if (error) throw error

      return new Response(
        JSON.stringify(data),
        { headers: { "Content-Type": "application/json", ...corsHeaders } }
      )
    }

    // PUT /categories/:id
    if (req.method === "PUT" && path.match(/^\/categories\/[^/]+$/)) {
      const categoryId = path.split("/")[2]
      const body = await req.json()
      
      const { data, error } = await supabase
        .from("categories")
        .update({ name: body.name })
        .eq("id", categoryId)
        .select()
        .single()

      if (error) throw error

      return new Response(
        JSON.stringify(data),
        { headers: { "Content-Type": "application/json", ...corsHeaders } }
      )
    }

    // DELETE /categories/:id
    if (req.method === "DELETE" && path.match(/^\/categories\/[^/]+$/)) {
      const categoryId = path.split("/")[2]
      
      const { error } = await supabase
        .from("categories")
        .delete()
        .eq("id", categoryId)

      if (error) throw error

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { "Content-Type": "application/json", ...corsHeaders } }
      )
    }

    // GET /brands/:id
    if (req.method === "GET" && path.match(/^\/brands\/[^/]+$/)) {
      const brandId = path.split("/")[2]

      const { data, error } = await supabase
        .from("brands")
        .select("*")
        .eq("id", brandId)
        .single()

      if (error) throw error

      return new Response(
        JSON.stringify(data),
        { headers: { "Content-Type": "application/json", ...corsHeaders } }
      )
    }

    // GET /brands
    if (req.method === "GET" && path === "/brands") {
      const { data, error } = await supabase
        .from("brands")
        .select("*")
        .order("name")

      if (error) throw error

      return new Response(
        JSON.stringify(data),
        { headers: { "Content-Type": "application/json", ...corsHeaders } }
      )
    }

    // POST /brands
    if (req.method === "POST" && path === "/brands") {
      const body = await req.json()
      const { data, error } = await supabase
        .from("brands")
        .insert({ name: body.name })
        .select()
        .single()

      if (error) throw error

      return new Response(
        JSON.stringify(data),
        { headers: { "Content-Type": "application/json", ...corsHeaders } }
      )
    }

    // PUT /brands/:id
    if (req.method === "PUT" && path.match(/^\/brands\/[^/]+$/)) {
      const brandId = path.split("/")[2]
      const body = await req.json()
      
      const { data, error } = await supabase
        .from("brands")
        .update({ name: body.name })
        .eq("id", brandId)
        .select()
        .single()

      if (error) throw error

      return new Response(
        JSON.stringify(data),
        { headers: { "Content-Type": "application/json", ...corsHeaders } }
      )
    }

    // DELETE /brands/:id
    if (req.method === "DELETE" && path.match(/^\/brands\/[^/]+$/)) {
      const brandId = path.split("/")[2]
      
      const { error } = await supabase
        .from("brands")
        .delete()
        .eq("id", brandId)

      if (error) throw error

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { "Content-Type": "application/json", ...corsHeaders } }
      )
    }

    // GET /analytics
    if (req.method === "GET" && path === "/analytics") {
      const period = url.searchParams.get("period") || "month"

      const now = new Date()
      let dateFilter = now.toISOString()
      if (period === "day") dateFilter = new Date(now.getTime() - 86400000).toISOString()
      else if (period === "week") dateFilter = new Date(now.getTime() - 7 * 86400000).toISOString()
      else if (period === "month") dateFilter = new Date(now.getTime() - 30 * 86400000).toISOString()
      else if (period === "quarter") dateFilter = new Date(now.getTime() - 90 * 86400000).toISOString()
      else if (period === "year") dateFilter = new Date(now.getTime() - 365 * 86400000).toISOString()

      // Total stats
      const { data: totalStats, error: totalError } = await supabase
        .from("orders_analytics")
        .select("total", { count: "exact" })
        .gte("created_at", dateFilter)

      if (totalError) throw totalError

      const totalRevenue = totalStats?.reduce((sum, o) => sum + o.total, 0) || 0
      const totalOrders = totalStats?.length || 0

      // Top products
      const { data: orders, error: ordersError } = await supabase
        .from("orders_analytics")
        .select("items")
        .gte("created_at", dateFilter)

      if (ordersError) throw ordersError

      const productSales = {}
      for (const order of orders || []) {
        for (const item of (order.items || [])) {
          if (!productSales[item.name]) {
            productSales[item.name] = { name: item.name, quantity: 0, total: 0 }
          }
          productSales[item.name].quantity += item.quantity
          productSales[item.name].total += item.total
        }
      }

      const topProducts = Object.values(productSales)
        .sort((a, b) => b.quantity - a.quantity)
        .slice(0, 10)

      // Daily chart data
      const { data: dailyData, error: dailyError } = await supabase
        .from("orders_analytics")
        .select("created_at, total")
        .gte("created_at", dateFilter)
        .order("created_at")

      if (dailyError) throw dailyError

      // Group by day
      const dailyStats = {}
      for (const order of dailyData || []) {
        const day = (order.created_at || "").split("T")[0]
        if (!dailyStats[day]) {
          dailyStats[day] = { date: day, total: 0, orders: 0 }
        }
        dailyStats[day].total += order.total
        dailyStats[day].orders += 1
      }

      return new Response(
        JSON.stringify({
          totalRevenue,
          totalOrders,
          topProducts,
          dailyStats: Object.values(dailyStats).sort((a, b) => a.date.localeCompare(b.date))
        }),
        { headers: { "Content-Type": "application/json", ...corsHeaders } }
      )
    }

    // GET /orders
    if (req.method === "GET" && path === "/orders") {
      const period = url.searchParams.get("period") || "month"
      const page = parseInt(url.searchParams.get("page") || "1")
      const limit = parseInt(url.searchParams.get("limit") || "20")
      const offset = (page - 1) * limit

      const now = new Date()
      let dateFilter = now.toISOString()
      if (period === "day") dateFilter = new Date(now.getTime() - 86400000).toISOString()
      else if (period === "week") dateFilter = new Date(now.getTime() - 7 * 86400000).toISOString()
      else if (period === "month") dateFilter = new Date(now.getTime() - 30 * 86400000).toISOString()
      else if (period === "quarter") dateFilter = new Date(now.getTime() - 90 * 86400000).toISOString()
      else if (period === "year") dateFilter = new Date(now.getTime() - 365 * 86400000).toISOString()

      const { data, error, count } = await supabase
        .from("orders_analytics")
        .select("*", { count: "exact" })
        .gte("created_at", dateFilter)
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1)

      if (error) throw error

      return new Response(
        JSON.stringify({ data, total: count }),
        { headers: { "Content-Type": "application/json", ...corsHeaders } }
      )
    }

    // DELETE /orders/:id
    if (req.method === "DELETE" && path.match(/^\/orders\/[^/]+$/)) {
      const orderId = path.split("/")[2]

      const { error } = await supabase
        .from("orders_analytics")
        .delete()
        .eq("id", orderId)

      if (error) throw error

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { "Content-Type": "application/json", ...corsHeaders } }
      )
    }

    // POST /import
    if (req.method === "POST" && path === "/import") {
      const body = await req.json()
      const { products: excelProducts } = body

      const results = { success: 0, errors: [] }
      const createdProducts = []
      const updatedProducts = []

      const uniqueCategories = new Set<string>()
      const uniqueBrands = new Set<string>()
      const categoryMap: Record<string, string> = {}
      const brandMap: Record<string, string> = {}

      for (const p of excelProducts) {
        let categoryName = p.category || ''
        if (!categoryName) {
          const detected = detectProductType(p.name || '')
          categoryName = detected.category
        }
        if (categoryName) uniqueCategories.add(categoryName)
        if (p.brand) uniqueBrands.add(p.brand)
      }

      const categoryPromises = [...uniqueCategories].map(async (name) => {
        const { data: existing } = await supabase.from("categories").select("id").eq("name", name).single()
        if (existing) {
          categoryMap[name] = existing.id
        } else {
          const { data: newCat } = await supabase.from("categories").insert({ name }).select().single()
          if (newCat) categoryMap[name] = newCat.id
        }
      })
      const brandPromises = [...uniqueBrands].map(async (name) => {
        const { data: existing } = await supabase.from("brands").select("id").eq("name", name).single()
        if (existing) {
          brandMap[name] = existing.id
        } else {
          const { data: newBrand } = await supabase.from("brands").insert({ name }).select().single()
          if (newBrand) brandMap[name] = newBrand.id
        }
      })
      await Promise.all([...categoryPromises, ...brandPromises])

      const skuProducts: any[] = []
      const noSkuProducts: any[] = []

      for (const p of excelProducts) {
        let categoryName = p.category || ''
        if (!categoryName) {
          const detected = detectProductType(p.name || '')
          categoryName = detected.category
        }
        const categoryId = categoryName ? categoryMap[categoryName] || null : null
        const brandId = p.brand ? brandMap[p.brand] || null : null

        const productData: any = {
          name: p.name,
          description: p.description || "",
          full_description: p.full_description || "",
          composition: p.composition || "",
          dosage: p.dosage || "",
          usage: p.usage || "",
          contraindications: p.contraindications || "",
          category_id: categoryId,
          brand_id: brandId,
          price: parseInt(p.price) || 0,
          old_price: p.old_price ? parseInt(p.old_price) : null,
          stock: parseInt(p.stock) || 0,
          volume: p.volume || "",
          sku: p.sku || null,
          barcode: p.barcode || null,
          is_hit: p.is_hit === true || p.is_hit === "TRUE" || p.is_hit === "true" || p.is_hit === 1 || p.is_hit === "1",
          is_new: p.is_new === true || p.is_new === "TRUE" || p.is_new === "true" || p.is_new === 1 || p.is_new === "1",
          is_discount: p.is_discount === true || p.is_discount === "TRUE" || p.is_discount === "true" || p.is_discount === 1 || p.is_discount === "1",
          shelf_life: p.shelf_life || "",
          is_visible: p.is_visible === true || p.is_visible === "TRUE" || p.is_visible === "true" || p.is_visible === 1 || p.is_visible === "1"
        }

        if (p.sku && p.sku.trim() !== '') {
          skuProducts.push(productData)
        } else {
          noSkuProducts.push(productData)
        }
      }

      const existingSkuSet = new Set<string>()
      const existingSkuMap: Record<string, any> = {}

      if (skuProducts.length > 0) {
        const allSkus = skuProducts.map(p => p.sku).filter(Boolean)
        const BATCH_SIZE = 300
        for (let i = 0; i < allSkus.length; i += BATCH_SIZE) {
          const batch = allSkus.slice(i, i + BATCH_SIZE)
          const { data: existing } = await supabase.from("products").select("id,sku").in("sku", batch)
          if (existing) {
            for (const row of existing) {
              existingSkuSet.add(row.sku)
              existingSkuMap[row.sku] = row
            }
          }
        }
      }

      const existingSkuProducts: any[] = []
      const newSkuProducts: any[] = []

      for (const p of skuProducts) {
        if (existingSkuSet.has(p.sku)) {
          existingSkuProducts.push({ data: p, prev: existingSkuMap[p.sku] })
        } else {
          newSkuProducts.push(p)
        }
      }

      const UPDATE_BATCH = 50
      for (let i = 0; i < existingSkuProducts.length; i += UPDATE_BATCH) {
        const batch = existingSkuProducts.slice(i, i + UPDATE_BATCH)
        await Promise.all(batch.map(async ({ data: p, prev }) => {
          const updateData: any = {}
          const fields = [
            "name", "description", "full_description", "composition",
            "dosage", "usage", "contraindications", "price", "old_price",
            "stock", "volume", "barcode", "is_hit", "is_new", "is_discount",
            "shelf_life", "is_visible"
          ]
          for (const field of fields) {
            if (p[field] !== undefined && p[field] !== null && p[field] !== "") {
              updateData[field] = p[field]
            }
          }
          if (p.category_id) updateData.category_id = p.category_id
          if (p.brand_id) updateData.brand_id = p.brand_id

          const { error: updateError } = await supabase.from("products").update(updateData).eq("id", prev.id)
          if (!updateError) {
            updatedProducts.push({ id: prev.id, sku: p.sku, name: p.name, previous: { ...prev } })
          }
        }))
      }

      if (newSkuProducts.length > 0) {
        const INSERT_BATCH = 50
        for (let i = 0; i < newSkuProducts.length; i += INSERT_BATCH) {
          const batch = newSkuProducts.slice(i, i + INSERT_BATCH)
          const { data: inserted, error: insertError } = await supabase.from("products").insert(batch).select()
          if (insertError) {
            results.errors.push({ row: i + 1, error: insertError.message })
          } else if (inserted) {
            for (const row of inserted) {
              createdProducts.push({ id: row.id, sku: row.sku, name: row.name })
            }
          }
        }
      }

      if (noSkuProducts.length > 0) {
        const INSERT_BATCH = 50
        for (let i = 0; i < noSkuProducts.length; i += INSERT_BATCH) {
          const batch = noSkuProducts.slice(i, i + INSERT_BATCH)
          const { error: insertError } = await supabase.from("products").insert(batch)
          if (insertError) {
            results.errors.push({ row: i + 1, error: insertError.message })
          }
        }
      }

      for (const p of newSkuProducts) {
        createdProducts.push({ sku: p.sku, name: p.name })
      }

      results.success = createdProducts.length + updatedProducts.length

      const responseData = {
        success: results.errors.length === 0,
        results,
        createdProducts,
        updatedProducts
      }

      if (results.errors.length > 0) {
        return new Response(
          JSON.stringify(responseData),
          { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
        )
      }

      return new Response(
        JSON.stringify(responseData),
        { headers: { "Content-Type": "application/json", ...corsHeaders } }
      )
    }

    // GET /export
    if (req.method === "GET" && path === "/export") {
      const { data: products, error } = await supabase
        .from("products")
        .select("*, categories(name), brands(name)")
        .order("name")

      if (error) throw error

      return new Response(
        JSON.stringify(products),
        { headers: { "Content-Type": "application/json", ...corsHeaders } }
      )
    }

    // GET /backup
    if (req.method === "GET" && path === "/backup") {
      const tables = ["categories", "brands", "products", "product_images", "product_links", "settings", "orders_analytics", "order_counter"]
      const backup = {}

      for (const table of tables) {
        const { data, error } = await supabase
          .from(table)
          .select("*")

        if (!error && data) {
          backup[table] = data
        }
      }

      return new Response(
        JSON.stringify(backup, null, 2),
        { 
          headers: { 
            "Content-Type": "application/json",
            "Content-Disposition": "attachment; filename=jock-nutrition-backup.json"
          } 
        }
      )
    }

    // GET /backup-sql (SQL dump instead of JSON)
    if (req.method === "GET" && path === "/backup-sql") {
      try {
        const { data, error } = await supabase.rpc("generate_sql_dump")

        if (error) throw error

        return new Response(
          data as string,
          {
            headers: {
              "Content-Type": "application/sql",
              "Content-Disposition": `attachment; filename=jock-nutrition-backup-${new Date().toISOString().split("T")[0]}.sql`
            }
          }
        )
      } catch (sqlError) {
        console.error("SQL backup error:", sqlError)
        return new Response(
          JSON.stringify({ error: "SQL-дамп временно недоступен. Используйте JSON-дампа." }),
          { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
        )
      }
    }

    // Health check
    if (req.method === "GET" && path === "/health") {
      return new Response(
        JSON.stringify({ status: "ok", timestamp: new Date().toISOString() }),
        { headers: { "Content-Type": "application/json", ...corsHeaders } }
      )
    }

    // POST /generate-descriptions
    if (req.method === "POST" && path === "/generate-descriptions") {
      const body = await req.json()
      const apiKey = body.apiKey || ''

      if (!apiKey) {
        return new Response(
          JSON.stringify({ error: "API ключ не указан" }),
          { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
        )
      }

      const { data: products, error: productsError } = await supabase
        .from("products")
        .select("id, name, volume, composition, brands(name)")
        .is("full_description", null)

      if (productsError) throw productsError

      if (!products || products.length === 0) {
        return new Response(
          JSON.stringify({ success: 0, errors: 0, message: "Все товары уже имеют описания" }),
          { headers: { "Content-Type": "application/json", ...corsHeaders } }
        )
      }

      const CHUNK_SIZE = 30
      const chunks: any[][] = []
      for (let i = 0; i < products.length; i += CHUNK_SIZE) {
        chunks.push(products.slice(i, i + CHUNK_SIZE))
      }

      let totalSuccess = 0
      let totalError = 0

      for (let c = 0; c < chunks.length; c++) {
        const chunk = chunks[c]
        console.log(`Processing chunk ${c + 1}/${chunks.length}, ${chunk.length} products`)

        for (const product of chunk) {
          try {
            const result = await generateProductDescription(product, apiKey)
            if (result) {
              const { error: updateError } = await supabase
                .from("products")
                .update({
                  description: result.description,
                  full_description: result.full_description,
                  composition: result.composition,
                  dosage: result.dosage,
                  usage: result.usage,
                  contraindications: result.contraindications
                })
                .eq("id", product.id)

              if (updateError) {
                totalError++
                console.error(`Failed to update product ${product.id}:`, updateError)
              } else {
                totalSuccess++
                console.log(`✓ Generated description for: ${product.name}`)
              }
            } else {
              totalError++
              console.warn(`✗ Failed to generate description for: ${product.name}`)
            }
          } catch (err) {
            totalError++
            console.error(`Error generating description for product ${product.id}:`, err)
          }

          await new Promise(r => setTimeout(r, 300))
        }

        if (chunks.length > 1 && c < chunks.length - 1) {
          await new Promise(r => setTimeout(r, 2000))
        }
      }

      return new Response(
        JSON.stringify({ success: totalSuccess, errors: totalError }),
        { headers: { "Content-Type": "application/json", ...corsHeaders } }
      )
    }

    return new Response(
      JSON.stringify({ error: "Не найдено" }),
      { status: 404, headers: { "Content-Type": "application/json", ...corsHeaders } }
    )

  } catch (error) {
    console.error("Admin API error:", error)
    return new Response(
      JSON.stringify({ error: "Внутренняя ошибка сервера" }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    )
  }
})
