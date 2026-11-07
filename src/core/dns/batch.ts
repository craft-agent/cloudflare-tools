import type { CloudflareClient } from "../cloudflare/client"
import { isPlainObject } from "../cloudflare/reply"
import { ROUTES } from "../cloudflare/routes"
import { ToolError, isToolError, type ErrorCode } from "../errors"
import { shapeRecord, type RecordListItem } from "./records"

/** The record operations of one batch: Cloudflare runs them together, deletes first, then patches, then posts. */
export type BatchOps = {
  deletes?: { id: string }[]
  patches?: Record<string, unknown>[]
  posts?: Record<string, unknown>[]
}

/** The records Cloudflare reports for each list of a batch. */
export type BatchResult = { deletes: RecordListItem[]; patches: RecordListItem[]; posts: RecordListItem[] }

const BATCH_LISTS = ["deletes", "patches", "posts"] as const

/** Codes of a failure that Cloudflare raised before it applied anything. */
const REFUSED_CODES: readonly ErrorCode[] = [
  "invalid_argument",
  "not_found",
  "forbidden",
  "unauthenticated",
  "rate_limited",
]

const NOTHING_CHANGED = "Nothing was changed."
const MAYBE_APPLIED =
  "Cloudflare may or may not have applied the whole batch; read the records with cloudflare_dns_read before sending it again."

function withNote(message: string, note: string): string {
  return `${message} ${note}`
}

function recordsOf(result: Record<string, unknown>, key: string): RecordListItem[] {
  const list = result[key]
  return Array.isArray(list) ? list.map(shapeRecord) : []
}

/**
 * Sends one DNS batch to the zone and returns the records Cloudflare reports. Cloudflare applies a batch as one
 * transaction: a refusal (400, 403, 404, 429, a bad token) means nothing was applied and says so; a failure that does
 * not tell (5xx, timeout, network, an odd body) is an `upstream_error` saying the batch may or may not have been applied.
 */
export async function sendBatch(client: CloudflareClient, zoneId: string, ops: BatchOps): Promise<BatchResult> {
  const body = Object.fromEntries(BATCH_LISTS.flatMap((key) => (ops[key]?.length ? [[key, ops[key]]] : [])))

  let result: unknown
  try {
    result = (await client.request<unknown>(ROUTES.dnsRecordsBatch, { path: { zone_id: zoneId }, body })).result
  } catch (error) {
    if (!isToolError(error)) throw error
    if (REFUSED_CODES.includes(error.code)) {
      throw new ToolError(error.code, withNote(error.message, NOTHING_CHANGED), { cause: error })
    }
    if (error.code === "upstream_error") {
      throw new ToolError("upstream_error", withNote(error.message, MAYBE_APPLIED), { cause: error })
    }
    throw error
  }

  if (!isPlainObject(result)) {
    throw new ToolError(
      "upstream_error",
      withNote("Cloudflare returned an unexpected DNS batch response.", MAYBE_APPLIED),
    )
  }
  return {
    deletes: recordsOf(result, "deletes"),
    patches: recordsOf(result, "patches"),
    posts: recordsOf(result, "posts"),
  }
}
