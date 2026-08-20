export const ALLOWED_ORIGINS = [
  "https://jabraiil.github.io",
  "https://jabraiil.github.io/JOCK-NUTRITION",
]

export function getCorsHeaders(origin: string | null): Record<string, string> {
  const allowedOrigin = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Max-Age": "86400",
  }
}

export function normalizePath(pathname: string, prefix: string): string {
  if (pathname.startsWith(`/functions/v1${prefix}`)) {
    return pathname.replace(`/functions/v1${prefix}`, "")
  } else if (pathname.startsWith(prefix)) {
    return pathname.replace(prefix, "")
  }
  return pathname
}

export function jsonResponse(body: unknown, status = 200, corsHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  })
}

export function structuredLog(level: "info" | "warn" | "error", message: string, data?: Record<string, unknown>): void {
  const entry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...data,
  }
  if (level === "error") {
    console.error(JSON.stringify(entry))
  } else if (level === "warn") {
    console.warn(JSON.stringify(entry))
  } else {
    console.log(JSON.stringify(entry))
  }
}

export function parseBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value
  if (typeof value === "string") {
    return value === "true" || value === "TRUE" || value === "1"
  }
  if (typeof value === "number") {
    return value === 1
  }
  return false
}

export function getDateFilter(period: string): string {
  const now = new Date()
  const offsets: Record<string, number> = {
    day: 86400000,
    week: 7 * 86400000,
    month: 30 * 86400000,
    quarter: 90 * 86400000,
    year: 365 * 86400000,
  }
  const offset = offsets[period] ?? offsets.month
  return new Date(now.getTime() - offset).toISOString()
}

export function safeParseInt(value: string | undefined, fallback = 0): number {
  const parsed = parseInt(value ?? "", 10)
  return Number.isNaN(parsed) ? fallback : parsed
}

export const GEMINI_DEFAULTS = {
  temperature: 0.3,
  maxOutputTokens: 1500,
  retryAttempts: 3,
  baseRetryDelayMs: 2000,
  rateLimitRetryDelayMs: 3000,
  requestDelayMs: 300,
  chunkDelayMs: 2000,
} as const

export const IMPORT_CONSTANTS = {
  SKU_BATCH_SIZE: 300,
  UPDATE_BATCH: 50,
  INSERT_BATCH: 50,
  CHUNK_SIZE: 30,
} as const

export function healthResponse(corsHeaders: Record<string, string>): Response {
  return jsonResponse(
    { status: "ok", timestamp: new Date().toISOString() },
    200,
    corsHeaders
  )
}

export function formatDay(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}
