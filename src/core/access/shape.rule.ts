import { z } from "zod"
import { isPlainObject } from "../cloudflare/reply"

/** One include, exclude or require rule as configured, with secret-bearing keys removed. */
export const ruleSchema = z.record(z.string(), z.unknown())

const SECRET_KEY_PATTERN = /secret|password|passphrase|private_key|bearer|^token$|^api_key$/i
const MAX_RULE_DEPTH = 6

type Kept = { value: unknown }

/** Copies plain data; a container nested deeper than `MAX_RULE_DEPTH` and any other kind of value are dropped. */
function sanitize(value: unknown, depth: number): Kept | undefined {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return { value }
  }
  if (depth > MAX_RULE_DEPTH) return undefined
  if (Array.isArray(value)) {
    const items: unknown[] = []
    for (const item of value) {
      const kept = sanitize(item, depth + 1)
      if (kept) items.push(kept.value)
    }
    return { value: items }
  }
  if (isPlainObject(value)) {
    const entries: [string, unknown][] = []
    for (const [key, item] of Object.entries(value)) {
      if (SECRET_KEY_PATTERN.test(key)) continue
      const kept = sanitize(item, depth + 1)
      if (kept) entries.push([key, kept.value])
    }
    return { value: Object.fromEntries(entries) }
  }
  return undefined
}

/** A list of rules as configured; entries that are not objects are dropped, a missing list is empty. */
export function shapeRules(raw: unknown): z.output<typeof ruleSchema>[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((entry) => {
    const kept = isPlainObject(entry) ? sanitize(entry, 1) : undefined
    return kept ? [kept.value as z.output<typeof ruleSchema>] : []
  })
}
