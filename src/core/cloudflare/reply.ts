/** The paging fields Cloudflare puts next to a list result. */
export type ResultInfo = {
  page?: number
  per_page?: number
  count?: number
  total_count?: number
  total_pages?: number
  cursor?: string
  is_truncated?: boolean
  delimited?: readonly string[]
}

/** Returns numeric paging fields, or null when Cloudflare did not send a number. */
export function pagingFields(info: ResultInfo | undefined): {
  page: number | null
  per_page: number | null
  total_count: number | null
  total_pages: number | null
} {
  return {
    page: typeof info?.page === "number" ? info.page : null,
    per_page: typeof info?.per_page === "number" ? info.per_page : null,
    total_count: typeof info?.total_count === "number" ? info.total_count : null,
    total_pages: typeof info?.total_pages === "number" ? info.total_pages : null,
  }
}

/** Cloudflare's standard API response wrapper. */
export type Envelope = { success?: unknown; errors?: unknown; result?: unknown; result_info?: unknown }

/** The raw HTTP response details inspected by the client. */
export type Received = { status: number; statusText: string; retryAfter: string | null; text: string }

/** Whether a value is a non-null plain JavaScript object. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/** Recursively maps every string value inside a structure, preserving its shape. */
export function mapStrings<T>(value: T, map: (text: string) => string): T {
  if (typeof value === "string") return map(value) as T
  if (Array.isArray(value)) return value.map((item) => mapStrings(item, map)) as T
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapStrings(item, map)])) as T
  }
  return value
}

/** Parses Cloudflare's JSON response text into an envelope, or returns undefined if invalid. */
export function parseEnvelope(text: string): Envelope | undefined {
  try {
    const parsed: unknown = JSON.parse(text)
    return isPlainObject(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

/** Formats the error messages from Cloudflare's envelope, falling back to HTTP status text. */
export function describeErrors(envelope: Envelope, received: Received): string {
  const described = Array.isArray(envelope.errors)
    ? envelope.errors.flatMap((entry: unknown) =>
        isPlainObject(entry) && typeof entry.message === "string"
          ? [typeof entry.code === "number" ? `${entry.code}: ${entry.message}` : entry.message]
          : [],
      )
    : []
  return described.length > 0 ? described.join("; ") : received.statusText || `HTTP ${received.status}`
}
