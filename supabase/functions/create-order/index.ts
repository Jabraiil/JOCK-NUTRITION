import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import {
  getCorsHeaders,
  normalizePath,
  jsonResponse,
  structuredLog,
  healthResponse,
  safeParseInt,
} from "../_shared/index.ts"

interface OrderItem {
  name: string
  quantity: number
  price: number
  total: number
}

interface CreateOrderSettings {
  order_time_limit_enabled?: string
  order_start_hour?: string
  order_end_hour?: string
  timezone?: string
  store_name?: string
  currency?: string
  whatsapp_number?: string
  whatsapp_business_number?: string
  order_error_code?: string
}

const ADMIN_ROUTE_PREFIX = "/create-order"

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req.headers.get("origin"))

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  const url = new URL(req.url)
  const path = normalizePath(url.pathname, ADMIN_ROUTE_PREFIX)

  if (req.method === "GET" && path === "/health") {
    return healthResponse(corsHeaders)
  }

  if (req.method !== "POST") {
    return jsonResponse(
      { error: "Method Not Allowed" },
      405,
      corsHeaders,
    )
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")

    if (!supabaseUrl || !supabaseServiceKey) {
      structuredLog("error", "Server misconfigured", { supabaseUrl: !!supabaseUrl, supabaseServiceKey: !!supabaseServiceKey })
      return jsonResponse(
        { error: "Server misconfigured" },
        500,
        corsHeaders,
      )
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    let body
    try {
      body = await req.json()
    } catch {
      return jsonResponse(
        { error: "Invalid JSON" },
        400,
        corsHeaders,
      )
    }

    const { cart, whatsappAccountType = 'personal', customer } = body

    if (!cart || !Array.isArray(cart) || cart.length === 0) {
      return jsonResponse(
        { error: "Корзина пуста" },
        400,
        corsHeaders,
      )
    }

    const customerIsPickup = customer?.isPickup === true
    const customerMethodValue = typeof customer?.methodValue === 'string' ? customer.methodValue.slice(0, 50) : ''
    const customerMethodLabel = typeof customer?.methodLabel === 'string' ? customer.methodLabel.slice(0, 100) : ''
    const customerPhone = typeof customer?.phone === 'string' ? customer.phone.trim().slice(0, 50) : ''
    const customerAddress = typeof customer?.address === 'string' ? customer.address.trim().slice(0, 500) : ''

    const { data: settings, error: settingsError } = await supabase
      .from("settings")
      .select("key, value")

    if (settingsError) {
      structuredLog("error", "Settings error", { error: settingsError.message })
    }

    const settingsMap: CreateOrderSettings = {}
    if (settings) {
      for (const s of settings) {
        settingsMap[s.key as keyof CreateOrderSettings] = s.value
      }
    }

    const timeLimitEnabled = settingsMap.order_time_limit_enabled === "true"
    if (timeLimitEnabled) {
      const startHour = safeParseInt(settingsMap.order_start_hour, 9)
      const endHour = safeParseInt(settingsMap.order_end_hour, 20)
      const now = new Date()
      const timezone = settingsMap.timezone || "Europe/Moscow"
      const options = { timeZone: timezone, hour: "numeric", hour12: false }
      const formatter = new Intl.DateTimeFormat("ru-RU", options)
      const currentHour = safeParseInt(formatter.format(now))
      if (currentHour < startHour || currentHour >= endHour) {
        return jsonResponse(
          { error: `Заказы принимаются с ${startHour}:00 до ${endHour}:00.`, time_restricted: true },
          403,
          corsHeaders,
        )
      }
    }

    const productIds = cart
      .map((item: { id: unknown }) => String(item.id))
      .filter((id) => id && id !== 'undefined' && id !== 'null')
    const { data: products, error: productsError } = await supabase
      .from("products")
      .select("id, name, price, stock, is_visible, volume, dosage, brands(name)")
      .in("id", productIds)

    if (productsError) {
      structuredLog("error", "Products error", { error: productsError.message })
      return jsonResponse(
        { error: "Ошибка проверки товаров" },
        500,
        corsHeaders,
      )
    }

    const productMap = {}
    for (const p of products) {
      productMap[p.id] = p
    }

    const orderItems: OrderItem[] = []
    let total = 0
    let hasError = false
    let errorCode = ""

    for (const cartItem of cart) {
      const product = productMap[String(cartItem.id)]
      if (!product || !product.is_visible) {
        hasError = true
        errorCode = settingsMap.order_error_code || "[!CHECK!]"
        continue
      }
      const quantity = Math.min(cartItem.quantity, product.stock)
      const itemTotal = product.price * quantity
      const brandName = product.brands?.name || ""
      const nameLine = brandName
        ? `${brandName} ${product.name}${product.dosage ? ` ${product.dosage}` : ""}${product.volume ? ` ${product.volume}` : ""}`
        : `${product.name}${product.dosage ? ` ${product.dosage}` : ""}${product.volume ? ` ${product.volume}` : ""}`
      orderItems.push({ name: nameLine, quantity, price: product.price, total: itemTotal })
      total += itemTotal
    }

    if (orderItems.length === 0) {
      return jsonResponse(
        { error: "Нет доступных товаров" },
        400,
        corsHeaders,
      )
    }

    const { data: counter, error: counterError } = await supabase
      .from("order_counter")
      .select("counter")
      .eq("id", 1)
      .single()

    if (counterError || !counter) {
      structuredLog("error", "Counter error", { error: counterError?.message })
      return jsonResponse(
        { error: "Ошибка генерации номера" },
        500,
        corsHeaders,
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

    const { data: updatedCounter, error: updateCounterError } = await supabase
      .from("order_counter")
      .update({ counter: newCounter })
      .eq("id", 1)
      .eq("counter", counter.counter)
      .select("counter")
      .single()

    if (updateCounterError || !updatedCounter) {
      structuredLog("error", "Counter update error", { error: updateCounterError?.message })
      return jsonResponse(
        { error: "Ошибка генерации номера заказа" },
        500,
        corsHeaders,
      )
    }

    const { error: analyticsError } = await supabase
      .from("orders_analytics").insert({ order_number: orderNumber, items: orderItems, total })

    if (analyticsError) {
      structuredLog("error", "Analytics insert error", { error: analyticsError.message, orderNumber })
    }

    const currency = settingsMap.currency || "₽"
    let message = `_Новый заказ ${orderNumber}_\n\n`
    for (const item of orderItems) {
      message += `• ${item.name}\n  ${item.quantity} шт. × ${item.price}${currency} = ${item.total}${currency}\n`
    }
    message += `\n*Итого: ${total}${currency}*\n\n`

    if (customerPhone) message += `Телефон: ${customerPhone}\n`

    if (customerIsPickup) {
      message += `Получение: Самовывоз\n`
    } else {
      if (customerMethodLabel) message += `Доставка: ${customerMethodLabel}\n`
      else if (customerMethodValue) message += `Доставка: ${customerMethodValue}\n`
      if (customerAddress) message += `Адрес: ${customerAddress}\n`
    }

    if (hasError) message += `\n${errorCode} - проверьте наличие\n`

    const accountType = whatsappAccountType === 'business' ? 'business' : 'personal'
    const whatsappNumber = accountType === 'business'
      ? settingsMap.whatsapp_business_number?.replace(/\D/g, "") || settingsMap.whatsapp_number?.replace(/\D/g, "") || ""
      : settingsMap.whatsapp_number?.replace(/\D/g, "") || ""
    const whatsappUrl = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`

    return jsonResponse(
      { success: true, orderNumber, total, items: orderItems, whatsappUrl, hasError, errorCode },
      200,
      corsHeaders,
    )

  } catch (error) {
    structuredLog("error", "Unexpected error", { error: String(error) })
    return jsonResponse(
      { error: "Внутренняя ошибка" },
      500,
      corsHeaders,
    )
  }
})
