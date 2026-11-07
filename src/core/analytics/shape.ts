import { z } from "zod"
import { isPlainObject } from "../cloudflare/reply"

const countOrNull = z.number().nullable()

/** One UTC day of traffic; a field is null when Cloudflare sent no number for it. */
export const daySchema = z.object({
  date: z.string().describe("The UTC date, YYYY-MM-DD."),
  requests: countOrNull.describe("Requests served."),
  cached_requests: countOrNull.describe("Requests served from cache."),
  bytes: countOrNull.describe("Bytes served."),
  cached_bytes: countOrNull.describe("Bytes served from cache."),
  threats: countOrNull.describe("Threats stopped."),
  page_views: countOrNull.describe("Page views."),
  uniques: countOrNull.describe("Unique visitors that day; uniques of different days cannot be added."),
})

/** The traffic sums over the whole range, without uniques. */
export const totalsSchema = z.object({
  requests: z.number(),
  cached_requests: z.number(),
  bytes: z.number(),
  cached_bytes: z.number(),
  threats: z.number(),
  page_views: z.number(),
})

export type Day = z.infer<typeof daySchema>
export type Totals = z.infer<typeof totalsSchema>

const TOTAL_KEYS = ["requests", "cached_requests", "bytes", "cached_bytes", "threats", "page_views"] as const

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function objectOf(value: unknown): Record<string, unknown> {
  return isPlainObject(value) ? value : {}
}

/** Shapes one `httpRequests1dGroups` entry; an entry without a date is dropped (undefined). */
export function shapeDay(entry: unknown): Day | undefined {
  const raw = objectOf(entry)
  const date = objectOf(raw.dimensions).date
  if (typeof date !== "string") return undefined
  const sum = objectOf(raw.sum)
  return {
    date,
    requests: numberOrNull(sum.requests),
    cached_requests: numberOrNull(sum.cachedRequests),
    bytes: numberOrNull(sum.bytes),
    cached_bytes: numberOrNull(sum.cachedBytes),
    threats: numberOrNull(sum.threats),
    page_views: numberOrNull(sum.pageViews),
    uniques: numberOrNull(objectOf(raw.uniq).uniques),
  }
}

/** Adds up the numbers the days carry; a sum with no number is 0. */
export function totalsOf(days: readonly Day[]): Totals {
  const totals = { requests: 0, cached_requests: 0, bytes: 0, cached_bytes: 0, threats: 0, page_views: 0 }
  for (const day of days) {
    for (const key of TOTAL_KEYS) totals[key] += day[key] ?? 0
  }
  return totals
}
