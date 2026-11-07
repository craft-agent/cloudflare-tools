import type { CloudflareClient } from "../cloudflare/client"
import { ROUTES } from "../cloudflare/routes"
import type { QueryValue } from "../cloudflare/url"
import { ToolError } from "../errors"
import { shapeSchema } from "./shape.d1"
import { KIND_INFO, requestForWrite, type Kind } from "./write"

/** A store as the delete tool read it: `key` is what its routes take, `name` its name or title. */
export type Store = { kind: Kind; key: string; name: string | null; id: string }

/** How many keys one page of the KV key listing holds at most. */
const KV_PAGE_SIZE = 1000

/** How many pages of the key listing prove a namespace empty before the tool gives up. */
const KV_MAX_PAGES = 20

/** How many table names a refusal lists. */
const MAX_LISTED_TABLES = 10

/** The store as a message names it: a namespace with its id, since titles repeat. */
export function describeStore(store: Store): string {
  const { noun } = KIND_INFO[store.kind]
  const name = store.name ?? store.id
  return store.kind === "kv" ? `${noun} ${name} (${store.id})` : `${noun} ${name}`
}

/** The refusal of a store that still holds `holds`; `rule` says what is deleted here and what to do first. */
function notEmpty(store: Store, holds: string, rule: string): ToolError {
  return new ToolError("invalid_argument", `${describeStore(store)} still holds ${holds}: ${rule}`)
}

function unexpected(what: string): ToolError {
  return new ToolError("upstream_error", `Cloudflare returned an unexpected ${what} response.`)
}

async function assertBucketEmpty(client: CloudflareClient, store: Store): Promise<void> {
  const { result } = await requestForWrite<unknown>(client, store.kind, ROUTES.r2BucketObjects, {
    path: { bucket_name: store.key },
    query: { per_page: 1 },
  })
  if (!Array.isArray(result)) throw unexpected("R2 objects")
  if (result.length > 0) throw notEmpty(store, "objects", "only an empty bucket is deleted here; empty it first.")
}

async function assertNamespaceEmpty(client: CloudflareClient, store: Store): Promise<void> {
  let cursor: string | undefined
  for (let page = 1; page <= KV_MAX_PAGES; page++) {
    const query: Record<string, QueryValue> = { limit: KV_PAGE_SIZE }
    if (cursor !== undefined) query.cursor = cursor
    const { result, resultInfo } = await requestForWrite<unknown>(client, store.kind, ROUTES.kvNamespaceKeys, {
      path: { namespace_id: store.key },
      query,
    })
    if (!Array.isArray(result)) throw unexpected("KV keys")
    if (result.length > 0) throw notEmpty(store, "keys", "only an empty namespace is deleted here; empty it first.")
    if (typeof resultInfo?.cursor !== "string" || resultInfo.cursor === "") return
    cursor = resultInfo.cursor
  }
  throw new ToolError(
    "invalid_argument",
    `${describeStore(store)}: its key listing goes on past ${KV_MAX_PAGES} pages without a key, so it is not proven empty; nothing was deleted.`,
  )
}

async function assertDatabaseEmpty(client: CloudflareClient, store: Store): Promise<void> {
  const { result } = await requestForWrite<unknown>(client, store.kind, ROUTES.d1Schema, {
    path: { database_id: store.key },
  })
  const { tables } = shapeSchema(result)
  if (tables.length === 0) return
  const listed = tables.slice(0, MAX_LISTED_TABLES).map((table) => table.name)
  const names = tables.length > MAX_LISTED_TABLES ? [...listed, "…"] : listed
  throw notEmpty(
    store,
    `tables (${names.join(", ")})`,
    "only a database without tables is deleted here; drop them first.",
  )
}

const PROOFS: Record<Kind, (client: CloudflareClient, store: Store) => Promise<void>> = {
  r2: assertBucketEmpty,
  kv: assertNamespaceEmpty,
  d1: assertDatabaseEmpty,
}

/**
 * Proves the store holds nothing, or throws: `invalid_argument` naming what it still holds, or that the
 * proof could not be completed. Any failure while reading is thrown as it is, a forbidden one naming the Edit permission.
 */
export function assertEmpty(client: CloudflareClient, store: Store): Promise<void> {
  return PROOFS[store.kind](client, store)
}
