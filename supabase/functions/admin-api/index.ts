import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

serve(async (req) => {
  const origin = req.headers.get("origin") || "*"
  const corsHeaders = {
    "Access-Control-Allow-Origin": origin,
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
      .eq("email", user.email)
      .single()

    if (adminError || !adminUser) {
      return new Response(
        JSON.stringify({ error: "Доступ запрещён" }),
        { status: 403, headers: { "Content-Type": "application/json", ...corsHeaders } }
      )
    }

    const url = new URL(req.url)
    const path = url.pathname.replace("/admin-api", "")

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
        barcode: productData.barcode || null
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

      if (!Array.isArray(images) || images.length === 0) {
        await supabase.from("product_images").delete().eq("product_id", productId)
      } else {
        await supabase.from("product_images").delete().eq("product_id", productId)
        const hasMain = images.some(img => img.is_main)
        const imagesToInsert = images.map((img, idx) => ({
          product_id: productId,
          url: img.url,
          is_main: hasMain ? Boolean(img.is_main) : idx === 0,
          sort_order: idx
        }))
        await supabase.from("product_images").insert(imagesToInsert)
      }

      if (!Array.isArray(links) || links.length === 0) {
        await supabase.from("product_links").delete().eq("product_id", productId)
      } else {
        await supabase.from("product_links").delete().eq("product_id", productId)
        const linksToInsert = links.map((link, idx) => ({
          product_id: productId,
          url: link.url,
          title: link.title || "",
          sort_order: idx
        }))
        await supabase.from("product_links").insert(linksToInsert)
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

      let dateFilter = "now()"
      if (period === "day") dateFilter = "now() - interval '1 day'"
      else if (period === "week") dateFilter = "now() - interval '7 days'"
      else if (period === "month") dateFilter = "now() - interval '1 month'"
      else if (period === "quarter") dateFilter = "now() - interval '3 months'"
      else if (period === "year") dateFilter = "now() - interval '1 year'"

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

      let dateFilter = "now()"
      if (period === "day") dateFilter = "now() - interval '1 day'"
      else if (period === "week") dateFilter = "now() - interval '7 days'"
      else if (period === "month") dateFilter = "now() - interval '1 month'"
      else if (period === "quarter") dateFilter = "now() - interval '3 months'"
      else if (period === "year") dateFilter = "now() - interval '1 year'"

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

    // POST /import
    if (req.method === "POST" && path === "/import") {
      const body = await req.json()
      const { products: excelProducts } = body

      const results = { success: 0, errors: [] }

      for (let i = 0; i < excelProducts.length; i++) {
        const p = excelProducts[i]
        
        try {
          // Get or create category
          let categoryId = null
          if (p.category) {
            const { data: existingCategory } = await supabase
              .from("categories")
              .select("id")
              .eq("name", p.category)
              .single()

            if (existingCategory) {
              categoryId = existingCategory.id
            } else {
              const { data: newCategory } = await supabase
                .from("categories")
                .insert({ name: p.category })
                .select()
                .single()
              categoryId = newCategory.id
            }
          }

          // Get or create brand
          let brandId = null
          if (p.brand) {
            const { data: existingBrand } = await supabase
              .from("brands")
              .select("id")
              .eq("name", p.brand)
              .single()

            if (existingBrand) {
              brandId = existingBrand.id
            } else {
              const { data: newBrand } = await supabase
                .from("brands")
                .insert({ name: p.brand })
                .select()
                .single()
              brandId = newBrand.id
            }
          }

          // Check if product exists by SKU
          if (p.sku) {
            const { data: existingProduct } = await supabase
              .from("products")
              .select("*")
              .eq("sku", p.sku)
              .single()

            if (existingProduct) {
              // Update - only non-empty fields
              const updateData = {}
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

              if (categoryId) updateData.category_id = categoryId
              if (brandId) updateData.brand_id = brandId

              await supabase
                .from("products")
                .update(updateData)
                .eq("id", existingProduct.id)

              results.success++
              continue
            }
          }

          // Create new product
          const { error: insertError } = await supabase
            .from("products")
            .insert({
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
              is_hit: p.is_hit || false,
              is_new: p.is_new || false,
              is_discount: p.is_discount || false,
              shelf_life: p.shelf_life || "",
              is_visible: p.is_visible !== false
            })

          if (insertError) {
            results.errors.push({ row: i + 1, error: insertError.message })
          } else {
            results.success++
          }

        } catch (error) {
          results.errors.push({ row: i + 1, error: String(error) })
        }
      }

      if (results.errors.length > 0) {
        return new Response(
          JSON.stringify({ success: false, results }),
          { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
        )
      }

      return new Response(
        JSON.stringify({ success: true, results }),
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
            "Content-Disposition": "attachment; filename=jack-nutrition-backup.json"
          } 
        }
      )
    }

    // GET /backup-sql (SQL dump instead of JSON)
    if (req.method === "GET" && path === "/backup-sql") {
      const { data, error } = await supabase.rpc("generate_sql_dump")

      if (error) throw error

      return new Response(
        data as string,
        {
          headers: {
            "Content-Type": "application/sql",
            "Content-Disposition": `attachment; filename=jack-nutrition-backup-${new Date().toISOString().split("T")[0]}.sql`
          }
        }
      )
    }

    // Health check
    if (req.method === "GET" && path === "/health") {
      return new Response(
        JSON.stringify({ status: "ok", timestamp: new Date().toISOString() }),
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

  async function saveRelated(productId: string, related: any) {
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
})
