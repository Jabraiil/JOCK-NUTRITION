import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { getCorsHeaders, normalizePath, jsonResponse, structuredLog, parseBoolean, getDateFilter, safeParseInt, GEMINI_DEFAULTS, IMPORT_CONSTANTS, healthResponse, formatDay } from "../_shared/index.ts"

export interface ProductRow {
  id: string
  name: string
  volume?: string
  composition?: string
  brands?: BrandRow
  categories?: CategoryRow
}

export interface ProductImage {
  id: string
  product_id: string
  url: string
  sort_order: number
}

export interface ProductLink {
  id: string
  product_id: string
  url: string
  sort_order: number
}

export interface CategoryRow {
  id: string
  name: string
}

export interface BrandRow {
  id: string
  name: string
}

export interface ImportProduct {
  name: string
  volume?: string
  composition?: string
  brand?: string
  category?: string
}

interface ImportedProductRow {
  name: string
  description: string
  full_description: string
  composition: string
  dosage: string
  usage: string
  contraindications: string
  category_id: string | null
  brand_id: string | null
  price: number
  old_price: number | null
  stock: number
  volume: string
  sku: string | null
  barcode: string | null
  is_hit: boolean
  is_new: boolean
  is_discount: boolean
  shelf_life: string
  is_visible: boolean
}

interface ExistingSkuProduct {
  data: ImportedProductRow
  prev: ProductRow
}

export interface OrderItem {
  id: string
  order_id: string
  product_id: string
  quantity: number
  price: number
  products?: ProductRow
}

export interface OrderAnalyticsRow {
  id: string
  created_at: string
  total_amount: number
  items?: OrderItem[]
}

export interface GeminiParams {
  temperature?: number
  maxOutputTokens?: number
  responseMimeType?: string
  responseSchema?: Record<string, unknown>
}

export interface GeminiResponse {
  text: string
  raw: unknown
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req.headers.get("origin"))

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

    async function callGemini(apiKey: string, prompt: string, params: GeminiParams = {}, attempts = GEMINI_DEFAULTS.retryAttempts): Promise<GeminiResponse | null> {
      const body = {
        contents: [
          {
            parts: [{ text: prompt }]
          }
        ],
        generationConfig: {
          temperature: params.temperature ?? GEMINI_DEFAULTS.temperature,
          maxOutputTokens: params.maxOutputTokens ?? GEMINI_DEFAULTS.maxOutputTokens,
          responseMimeType: params.responseMimeType || 'text/plain',
          responseSchema: params.responseMimeType === 'application/json' ? (params.responseSchema || {
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
          }) : undefined
        }
      }

      for (let i = 0; i < attempts; i++) {
        try {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent`
          const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
            body: JSON.stringify(body)
          })

          if (response.ok) {
            const data = await response.json()
            const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
            
            if (!text) {
              structuredLog("warn", `Empty Gemini response for attempt ${i + 1}`)
              if (i < attempts - 1) {
                await new Promise(r => setTimeout(r, Math.pow(2, i) * GEMINI_DEFAULTS.baseRetryDelayMs))
                continue
              }
              throw new Error('Empty response from AI')
            }
            
            return { text, raw: data }
          }

          const errData = await response.json().catch(() => ({}))
          const errorMsg = errData.error?.message || errData.error || `AI API error: ${response.status}`

          if ((response.status === 429 || response.status === 503) && i < attempts - 1) {
            const delay = Math.pow(2, i) * GEMINI_DEFAULTS.rateLimitRetryDelayMs
            structuredLog("warn", `Gemini rate limit/server busy, retrying in ${delay}ms...`)
            await new Promise(r => setTimeout(r, delay))
            continue
          }

          throw new Error(errorMsg)
        } catch (err) {
          if (i < attempts - 1) {
            const delay = Math.pow(2, i) * GEMINI_DEFAULTS.baseRetryDelayMs
            structuredLog("warn", `Gemini call failed, retrying in ${delay}ms...`)
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
    async function generateProductDescription(product: ProductRow, apiKey: string) {
      const brandName = product.brands?.name || ''
      const productName = product.name || ''
      const volume = product.volume || ''
      const composition = product.composition || ''
      const detected = detectProductType(productName)
      const productType = detected.type
      const categoryName = detected.category

      const isPerfume = productType === 'perfume'
      const isPharmacy = productType === 'pharmacy'

      const prompt = `Создай описание для товара в интернет-магазине питания/спорта.

Название: "${productName}"
Бренд: "${brandName}"
Категория: "${categoryName}"
Объём: "${volume || 'не указан'}"
${composition ? `Состав: "${composition}"` : ''}

Ответь ТОЛЬКО валидным JSON без markdown:
{
  "description": "Краткое описание 3-4 строки. Без воды, понятно каждому.",
  "full_description": "Развёрнутое описание 5-7 строк. Короткие абзацы, удобно на телефоне.",
  "composition": "Состав. Для БАДов/аптечных — основные компоненты с дозировками на русском. Для парфюма — аромат/семейство/ноты на русском.",
  "dosage": "Дозировка с упаковки на русском. Для парфюма — объём флакона.",
  "usage": "Способ применения на русском. Для парфюма — способ нанесения.",
  "contraindications": "${isPerfume ? 'Пусто' : 'Индивидуальная непереносимость, беременность, кормление грудью. Для аптечных добавь характерные.'}"
}

Правила:
- description: максимум 4 строки, без воды
- full_description: 5-7 строк, короткие абзацы
- composition: точный состав как на упаковке, на русском
- dosage: дозировка как на упаковке, на русском
- usage: кратко, на русском
- contraindications: ${isPerfume ? 'пусто' : 'только фактические, без выдуманных'}
- Не придумывай состав/дозировку — только общеизвестные стандартные данные.`

      const data = await callGemini(apiKey, prompt, {
        temperature: GEMINI_DEFAULTS.temperature,
        maxOutputTokens: 1200,
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
      if (!rawText) return null

      let parsed
      try {
        const cleaned = rawText.replace(/```json\n?|\n?```/g, '').trim()
        parsed = JSON.parse(cleaned)
      } catch (e) {
        structuredLog("error", 'Failed to parse AI response for ' + productName + ': ' + rawText)
        return null
      }

      return {
        description: parsed.description || '',
        full_description: parsed.full_description || '',
        composition: parsed.composition || '',
        dosage: parsed.dosage || '',
        usage: parsed.usage || '',
        contraindications: parsed.contraindications || ''
      }
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
      .ilike("email", user.email.toLowerCase())
      .single()

    if (adminError || !adminUser) {
      return new Response(
        JSON.stringify({ error: "Доступ запрещён" }),
        { status: 403, headers: { "Content-Type": "application/json", ...corsHeaders } }
      )
    }

    const url = new URL(req.url)
    const path = normalizePath(url.pathname, "/admin-api")

    // GET /settings
    if (req.method === "GET" && path === "/settings") {
      const { data, error } = await supabase
        .from("settings")
        .select("*")

      if (error) return jsonResponse({ error: error.message }, 500, corsHeaders)

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

      if (productError) return jsonResponse({ error: productError.message }, 500, corsHeaders)

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
      const page = safeParseInt(url.searchParams.get("page"), 1)
      const limit = safeParseInt(url.searchParams.get("limit"), 20)
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

      if (error) return jsonResponse({ error: error.message }, 500, corsHeaders)

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
        return jsonResponse({ error: error.message }, 500, corsHeaders)
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
        return jsonResponse({ error: error.message }, 500, corsHeaders)
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

      if (error) return jsonResponse({ error: error.message }, 500, corsHeaders)

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

      if (error) return jsonResponse({ error: error.message }, 500, corsHeaders)

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

      if (error) return jsonResponse({ error: error.message }, 500, corsHeaders)

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

      if (error) return jsonResponse({ error: error.message }, 500, corsHeaders)

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

      if (error) return jsonResponse({ error: error.message }, 500, corsHeaders)

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

      if (error) return jsonResponse({ error: error.message }, 500, corsHeaders)

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

      if (error) return jsonResponse({ error: error.message }, 500, corsHeaders)

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

      if (error) return jsonResponse({ error: error.message }, 500, corsHeaders)

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

      if (error) return jsonResponse({ error: error.message }, 500, corsHeaders)

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

      if (error) return jsonResponse({ error: error.message }, 500, corsHeaders)

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

      if (error) return jsonResponse({ error: error.message }, 500, corsHeaders)

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { "Content-Type": "application/json", ...corsHeaders } }
      )
    }

    // GET /analytics
    if (req.method === "GET" && path === "/analytics") {
      const period = url.searchParams.get("period") || "month"

      const dateFilter = getDateFilter(period)

      // Total stats
      const { data: totalStats, error: totalError } = await supabase
        .from("orders_analytics")
        .select("total", { count: "exact" })
        .gte("created_at", dateFilter)

      if (totalError) {
        structuredLog("error", "Analytics query (total) failed", { error: String(totalError) })
        return jsonResponse({ error: totalError.message }, 500, corsHeaders)
      }


      const totalRevenue = totalStats?.reduce((sum, o) => sum + o.total, 0) || 0
      const totalOrders = totalStats?.length || 0

      // Top products
      const { data: orders, error: ordersError } = await supabase
        .from("orders_analytics")
        .select("items")
        .gte("created_at", dateFilter)

      if (ordersError) {
        structuredLog("error", "Analytics query (orders) failed", { error: String(ordersError) })
        return jsonResponse({ error: ordersError.message }, 500, corsHeaders)
      }

      const productSales: Record<string, { name: string; quantity: number; total: number }> = {}
      for (const order of orders || []) {
        for (const item of (order.items || [])) {
          const key = item.name + "___" + item.price
          if (!productSales[key]) {
            productSales[key] = { name: item.name, quantity: 0, total: 0 }
          }
          productSales[key].quantity += item.quantity
          productSales[key].total += item.total
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

      if (dailyError) {
        structuredLog("error", "Analytics query (daily) failed", { error: String(dailyError) })
        return jsonResponse({ error: dailyError.message }, 500, corsHeaders)
      }

      // Group by day
      const dailyStats = {}
      for (const order of dailyData || []) {
        const day = formatDay(order.created_at || "")
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
      const page = safeParseInt(url.searchParams.get("page"), 1)
      const limit = safeParseInt(url.searchParams.get("limit"), 20)
      const offset = (page - 1) * limit

      const dateFilter = getDateFilter(period)

      const { data, error, count } = await supabase
        .from("orders_analytics")
        .select("*", { count: "exact" })
        .gte("created_at", dateFilter)
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1)

      if (error) return jsonResponse({ error: error.message }, 500, corsHeaders)

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

      if (error) return jsonResponse({ error: error.message }, 500, corsHeaders)

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

      const skuProducts: ImportedProductRow[] = []
      const noSkuProducts: ImportedProductRow[] = []

      for (const p of excelProducts) {
        let categoryName = p.category || ''
        if (!categoryName) {
          const detected = detectProductType(p.name || '')
          categoryName = detected.category
        }
        const categoryId = categoryName ? categoryMap[categoryName] || null : null
        const brandId = p.brand ? brandMap[p.brand] || null : null

        const productData: ImportedProductRow = {
          name: p.name,
          description: p.description || "",
          full_description: p.full_description || "",
          composition: p.composition || "",
          dosage: p.dosage || "",
          usage: p.usage || "",
          contraindications: p.contraindications || "",
          category_id: categoryId,
          brand_id: brandId,
          price: Number(p.price) || 0,
          old_price: p.old_price ? Number(p.old_price) || null : null,
          stock: Number(p.stock) || 0,
          volume: p.volume || "",
          sku: p.sku || null,
          barcode: p.barcode || null,
          is_hit: parseBoolean(p.is_hit),
          is_new: parseBoolean(p.is_new),
          is_discount: parseBoolean(p.is_discount),
          shelf_life: p.shelf_life || "",
          is_visible: parseBoolean(p.is_visible)
        }

        if (p.sku && p.sku.trim() !== '') {
          skuProducts.push(productData)
        } else {
          noSkuProducts.push(productData)
        }
      }

      const existingSkuSet = new Set<string>()
      const existingSkuMap: Record<string, ProductRow> = {}

      if (skuProducts.length > 0) {
        const allSkus = skuProducts.map(p => p.sku).filter(Boolean)
        const BATCH_SIZE = IMPORT_CONSTANTS.SKU_BATCH_SIZE
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

      const existingSkuProducts: ExistingSkuProduct[] = []
      const newSkuProducts: ImportedProductRow[] = []

      for (const p of skuProducts) {
        if (existingSkuSet.has(p.sku)) {
          existingSkuProducts.push({ data: p, prev: existingSkuMap[p.sku] })
        } else {
          newSkuProducts.push(p)
        }
      }

      const UPDATE_BATCH = IMPORT_CONSTANTS.UPDATE_BATCH
      for (let i = 0; i < existingSkuProducts.length; i += UPDATE_BATCH) {
        const batch = existingSkuProducts.slice(i, i + UPDATE_BATCH)
        await Promise.all(batch.map(async ({ data: p, prev }) => {
          const updateData: Partial<ImportedProductRow> = {}
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
        const INSERT_BATCH = IMPORT_CONSTANTS.INSERT_BATCH
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
        const INSERT_BATCH = IMPORT_CONSTANTS.INSERT_BATCH
        for (let i = 0; i < noSkuProducts.length; i += INSERT_BATCH) {
          const batch = noSkuProducts.slice(i, i + INSERT_BATCH)
          const { error: insertError } = await supabase.from("products").insert(batch)
          if (insertError) {
            results.errors.push({ row: i + 1, error: insertError.message })
          }
        }
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

      if (error) return jsonResponse({ error: error.message }, 500, corsHeaders)

      return new Response(
        JSON.stringify(products),
        { headers: { "Content-Type": "application/json", ...corsHeaders } }
      )
    }

    // GET /backup
    if (req.method === "GET" && path === "/backup") {
      const tables = ["categories", "brands", "products", "product_images", "product_links", "settings", "orders_analytics", "order_counter"]
      const backup: Record<string, unknown> = {}

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

        if (error) {
          structuredLog("error", "Backup SQL error", { error: String(error) })
          return jsonResponse({ error: error.message }, 500, corsHeaders)
        }

        if (typeof data !== "string") {
          return jsonResponse({ error: "SQL-дамп временно недоступен. Используйте JSON-дамп." }, 500, corsHeaders)
        }

        return new Response(
          data,
          {
            headers: {
              "Content-Type": "application/sql",
              "Content-Disposition": `attachment; filename=jock-nutrition-backup-${new Date().toISOString().split("T")[0]}.sql`
            }
          }
        )
      } catch (sqlError) {
        structuredLog("error", "SQL backup error", { error: String(sqlError) })
        return new Response(
          JSON.stringify({ error: "SQL-дамп временно недоступен. Используйте JSON-дампа." }),
          { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
        )
      }
    }

    // Health check
    if (req.method === "GET" && path === "/health") {
      return healthResponse(corsHeaders)
    }

    // POST /generate-descriptions
    if (req.method === "POST" && path === "/generate-descriptions") {
      const body = await req.json()
      const apiKey = Deno.env.get("GEMINI_API_KEY") || body.apiKey || ''

      if (!apiKey) {
        return new Response(
          JSON.stringify({ error: "API ключ не указан" }),
          { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
        )
      }

      const { data: products, error: productsError } = await supabase
        .from("products")
        .select("id, name, volume, composition, brands(name)")
        .or("full_description.is.null,full_description.eq.")

      if (productsError) {
        structuredLog("error", "Generate descriptions query failed", { error: String(productsError) })
        return jsonResponse({ error: productsError.message }, 500, corsHeaders)
      }

      if (!products || products.length === 0) {
        return new Response(
          JSON.stringify({ success: 0, errors: 0, message: "Все товары уже имеют описания" }),
          { headers: { "Content-Type": "application/json", ...corsHeaders } }
        )
      }

      const CHUNK_SIZE = IMPORT_CONSTANTS.CHUNK_SIZE
      const chunks: ProductRow[][] = []
      for (let i = 0; i < products.length; i += CHUNK_SIZE) {
        chunks.push(products.slice(i, i + CHUNK_SIZE))
      }

      let totalSuccess = 0
      let totalError = 0

      for (let c = 0; c < chunks.length; c++) {
        const chunk = chunks[c]
        structuredLog("info", `Processing chunk ${c + 1}/${chunks.length}, ${chunk.length} products`)

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
                structuredLog("error", `Failed to update product ${product.id}`, { error: String(updateError) })
              } else {
                totalSuccess++
                structuredLog("info", `✓ Generated description for: ${product.name}`)
              }
            } else {
              totalError++
              structuredLog("warn", `✗ Failed to generate description for: ${product.name}`)
            }
          } catch (err) {
            totalError++
            structuredLog("error", `Error generating description for product ${product.id}`, { error: String(err) })
          }

          await new Promise(r => setTimeout(r, GEMINI_DEFAULTS.requestDelayMs))
        }

        if (chunks.length > 1 && c < chunks.length - 1) {
          await new Promise(r => setTimeout(r, GEMINI_DEFAULTS.chunkDelayMs))
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
    structuredLog("error", "Admin API error", { error: String(error) })
    return new Response(
      JSON.stringify({ error: "Внутренняя ошибка сервера" }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    )
  }
})
