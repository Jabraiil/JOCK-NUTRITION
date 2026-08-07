import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

serve(async (req) => {
  const origin = req.headers.get("origin") || "*"
  const corsHeaders = {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400"
  }

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  const url = new URL(req.url)
  const path = url.pathname.replace("/create-order", "")

  if (req.method === "GET" && path === "/health") {
    return new Response(
      JSON.stringify({ status: "ok", timestamp: new Date().toISOString() }),
      { headers: { "Content-Type": "application/json", ...corsHeaders } }
    )
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    
    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ error: "Server misconfigured" }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      )
    }
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    let body
    try {
      body = await req.json()
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      )
    }
    
    const { cart } = body

    if (!cart || !Array.isArray(cart) || cart.length === 0) {
      return new Response(
        JSON.stringify({ error: "Корзина пуста" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      )
    }

    const { data: settings, error: settingsError } = await supabase
      .from("settings")
      .select("key, value")

    if (settingsError) {
      console.error("Settings error:", settingsError)
    }

    const settingsMap = {}
    if (settings) {
      for (const s of settings) {
        settingsMap[s.key] = s.value
      }
    }

    const timeLimitEnabled = settingsMap.order_time_limit_enabled === "true"
    if (timeLimitEnabled) {
      const startHour = parseInt(settingsMap.order_start_hour || "9")
      const endHour = parseInt(settingsMap.order_end_hour || "20")
      const now = new Date()
      const timezone = settingsMap.timezone || "Europe/Moscow"
      const options = { timeZone: timezone, hour: "numeric", hour12: false }
      const formatter = new Intl.DateTimeFormat("ru-RU", options)
      const currentHour = parseInt(formatter.format(now))
      if (currentHour < startHour || currentHour >= endHour) {
        return new Response(
          JSON.stringify({ error: "Заказы принимаются с 9:00 до 20:00.", time_restricted: true }),
          { status: 403, headers: { "Content-Type": "application/json", ...corsHeaders } }
        )
      }
    }

    const productIds = cart.map(item => item.id)
    const { data: products, error: productsError } = await supabase
      .from("products")
      .select("id, name, price, stock, is_visible, volume")
      .in("id", productIds)

    if (productsError) {
      console.error("Products error:", productsError)
      return new Response(
        JSON.stringify({ error: "Ошибка проверки товаров" }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      )
    }

    const productMap = {}
    for (const p of products) {
      productMap[p.id] = p
    }

    const orderItems = []
    let total = 0
    let hasError = false
    let errorCode = ""

    for (const cartItem of cart) {
      const product = productMap[cartItem.id]
      if (!product || !product.is_visible) {
        hasError = true
        errorCode = settingsMap.order_error_code || "[!CHECK!]"
        continue
      }
      const quantity = Math.min(cartItem.quantity, product.stock)
      const itemTotal = product.price * quantity
      orderItems.push({ name: product.name, volume: product.volume || "", quantity, price: product.price, total: itemTotal })
      total += itemTotal
    }

    if (orderItems.length === 0) {
      return new Response(
        JSON.stringify({ error: "Нет доступных товаров" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      )
    }

    const { data: counter, error: counterError } = await supabase
      .from("order_counter")
      .select("counter")
      .eq("id", 1)
      .single()

    if (counterError || !counter) {
      console.error("Counter error:", counterError)
      return new Response(
        JSON.stringify({ error: "Ошибка генерации номера" }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      )
    }

    const newCounter = counter.counter + 1
    const now = new Date()
    const timezone = settingsMap.timezone || "Europe/Moscow"
    const dateOpts = { timeZone: timezone, day: "2-digit", month: "2-digit", year: "2-digit" }
    const dateFormatter = new Intl.DateTimeFormat("ru-RU", dateOpts)
    const dateParts = dateFormatter.formatToParts(now)
    const day = dateParts.find(p => p.type === "day")?.value || String(now.getDate()).padStart(2, "0")
    const month = dateParts.find(p => p.type === "month")?.value || String(now.getMonth() + 1).padStart(2, "0")
    const year = dateParts.find(p => p.type === "year")?.value || String(now.getFullYear()).slice(-2)
    const orderNumber = `${day}${month}${year}/${String(newCounter).padStart(3, "0")}`

    await supabase.from("order_counter").update({ counter: newCounter }).eq("id", 1)
    await supabase.from("orders_analytics").insert({ order_number: orderNumber, items: orderItems, total })

    const storeName = settingsMap.store_name || "JACK NUTRITION"
    const currency = settingsMap.currency || "₽"
    const timeOpts = { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }
    const timeFormatter = new Intl.DateTimeFormat("ru-RU", timeOpts)
    const formattedDate = timeFormatter.format(now)

    let message = `_Новый заказ ${orderNumber}_\n\nМагазин: ${storeName}\n\n*Товары:*\n`
    for (const item of orderItems) {
      message += `• ${item.name}${item.volume ? ` (${item.volume})` : ''}\n  ${item.quantity} шт. × ${item.price}${currency} = ${item.total}${currency}\n`
    }
    message += `\n*Итого: ${total}${currency}*\n\n`
    if (hasError) message += `${errorCode} - проверьте цены\n`
    message += `\nДата: ${formattedDate}`

    const whatsappNumber = settingsMap.whatsapp_number?.replace(/\D/g, "") || ""
    const whatsappUrl = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`

    return new Response(
      JSON.stringify({ success: true, orderNumber, total, items: orderItems, whatsappUrl, hasError, errorCode }),
      { headers: { "Content-Type": "application/json", ...corsHeaders } }
    )

  } catch (error) {
    console.error("Unexpected error:", error)
    return new Response(
      JSON.stringify({ error: "Внутренняя ошибка" }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    )
  }
})