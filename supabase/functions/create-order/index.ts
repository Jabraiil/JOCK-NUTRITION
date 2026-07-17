import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
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

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const body = await req.json()
    const { cart } = body

    if (!cart || !Array.isArray(cart) || cart.length === 0) {
      return new Response(
        JSON.stringify({ error: "Корзина пуста" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      )
    }

    // Get settings
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

    // Check time restriction
    const timeLimitEnabled = settingsMap.order_time_limit_enabled === "true"
    if (timeLimitEnabled) {
      const startHour = parseInt(settingsMap.order_start_hour || "9")
      const endHour = parseInt(settingsMap.order_end_hour || "20")
      
      const now = new Date()
      const timezone = settingsMap.timezone || "Europe/Moscow"
      
      // Convert to target timezone
      const options: Intl.DateTimeFormatOptions = {
        timeZone: timezone,
        hour: "numeric",
        hour12: false,
      }
      const formatter = new Intl.DateTimeFormat("ru-RU", options)
      const currentHour = parseInt(formatter.format(now))
      
      if (currentHour < startHour || currentHour >= endHour) {
        return new Response(
          JSON.stringify({ 
            error: "Заказы принимаются с 9:00 до 20:00. Добавьте товары в корзину и оформите заказ утром.",
            time_restricted: true
          }),
          { status: 403, headers: { "Content-Type": "application/json", ...corsHeaders } }
        )
      }
    }

    // Validate cart and get current prices
    const productIds = cart.map(item => item.id)
    const { data: products, error: productsError } = await supabase
      .from("products")
      .select("id, name, price, stock, is_visible")
      .in("id", productIds)

    if (productsError) {
      console.error("Products error:", productsError)
      return new Response(
        JSON.stringify({ error: "Ошибка проверки товаров" }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      )
    }

    // Build product map
    const productMap = {}
    for (const p of products) {
      productMap[p.id] = p
    }

    // Calculate order
    const orderItems = []
    let total = 0
    let hasError = false
    let errorCode = ""

    for (const cartItem of cart) {
      const product = productMap[cartItem.id]
      
      if (!product) {
        hasError = true
        errorCode = settingsMap.order_error_code || "[!CHECK!]"
        continue
      }

      if (!product.is_visible) {
        hasError = true
        errorCode = settingsMap.order_error_code || "[!CHECK!]"
        continue
      }

      const quantity = Math.min(cartItem.quantity, product.stock)
      const itemTotal = product.price * quantity
      
      orderItems.push({
        name: product.name,
        quantity: quantity,
        price: product.price,
        total: itemTotal
      })
      
      total += itemTotal
    }

    if (orderItems.length === 0) {
      return new Response(
        JSON.stringify({ error: "Нет доступных товаров в заказе" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      )
    }

    // Get next order number
    const { data: counter, error: counterError } = await supabase
      .from("order_counter")
      .select("counter")
      .eq("id", 1)
      .single()

    if (counterError || !counter) {
      console.error("Counter error:", counterError)
      return new Response(
        JSON.stringify({ error: "Ошибка генерации номера заказа" }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      )
    }

    const newCounter = counter.counter + 1
    const now = new Date()
    const day = String(now.getDate()).padStart(2, "0")
    const month = String(now.getMonth() + 1).padStart(2, "0")
    const year = String(now.getFullYear()).slice(-2)
    const orderNumber = `${day}${month}${year}/${String(newCounter).padStart(3, "0")}`

    // Update counter
    const { error: updateCounterError } = await supabase
      .from("order_counter")
      .update({ counter: newCounter })
      .eq("id", 1)

    if (updateCounterError) {
      console.error("Update counter error:", updateCounterError)
    }

    // Save analytics
    const { error: analyticsError } = await supabase
      .from("orders_analytics")
      .insert({
        order_number: orderNumber,
        items: orderItems,
        total: total
      })

    if (analyticsError) {
      console.error("Analytics error:", analyticsError)
    }

    // Generate WhatsApp message
    const storeName = settingsMap.store_name || "JACK NUTRITION"
    const currency = settingsMap.currency || "₽"
    
    let message = `*Новый заказ ${orderNumber}*\n\n`
    message += `Магазин: ${storeName}\n\n`
    message += `*Товары:*\n`
    
    for (const item of orderItems) {
      message += `• ${item.name}\n`
      message += `  ${item.quantity} шт. × ${item.price}${currency} = ${item.total}${currency}\n`
    }
    
    message += `\n*Итого: ${total}${currency}*\n\n`
    
    if (hasError) {
      message += `${errorCode} - проверьте цены и наличие\n`
    }
    
    message += `\nДата: ${now.toLocaleString("ru-RU")}`

    // Encode for WhatsApp URL
    const whatsappNumber = settingsMap.whatsapp_number?.replace(/\D/g, "") || ""
    const encodedMessage = encodeURIComponent(message)
    const whatsappUrl = `https://wa.me/${whatsappNumber}?text=${encodedMessage}`

    return new Response(
      JSON.stringify({
        success: true,
        orderNumber: orderNumber,
        total: total,
        items: orderItems,
        whatsappUrl: whatsappUrl,
        hasError: hasError,
        errorCode: errorCode
      }),
      { headers: { "Content-Type": "application/json", ...corsHeaders } }
    )

  } catch (error) {
    console.error("Unexpected error:", error)
    return new Response(
      JSON.stringify({ error: "Внутренняя ошибка сервера" }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    )
  }
})
