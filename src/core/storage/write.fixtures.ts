import { ACCOUNT_ID, envFor } from "../cloudflare/client.fixtures"
import { fakeCloudflare, ok, type FakeReply, type FakeRequest, type FakeRoute } from "../cloudflare/testing"
import { defineStorageCreate } from "./create"
import { defineStorageDelete } from "./delete"
import { BUCKET_NAME, BUCKET_PATH, BUCKETS_PATH, OBJECTS_PATH } from "./fixtures"

export { ACCOUNT_ID, BUCKET_NAME, BUCKET_PATH, BUCKETS_PATH, OBJECTS_PATH }
export { CTX, errorOf, refusalOf } from "./fixtures"

export const NAMESPACE_ID = "a".repeat(32)
export const NAMESPACE_TITLE = "My namespace"
export const NAMESPACES_PATH = `/accounts/${ACCOUNT_ID}/storage/kv/namespaces`
export const NAMESPACE_PATH = `${NAMESPACES_PATH}/${NAMESPACE_ID}`
export const KEYS_PATH = `${NAMESPACE_PATH}/keys`

export const DATABASE_ID = "12345678-1234-4abc-8def-123456789abc"
export const DATABASE_NAME = "my-db"
export const DATABASES_PATH = `/accounts/${ACCOUNT_ID}/d1/database`
export const DATABASE_PATH = `${DATABASES_PATH}/${DATABASE_ID}`
export const QUERY_PATH = `${DATABASE_PATH}/query`

/** The three kinds' delete arguments, with the store each reads. */
export const DELETE_ARGS = {
  r2: { kind: "r2", bucket: BUCKET_NAME },
  kv: { kind: "kv", namespace: NAMESPACE_ID },
  d1: { kind: "d1", database: DATABASE_ID },
} as const

/** The fixed schema statement's reply holding tables with these names. */
export function schemaReply(...tables: string[]): FakeReply {
  return ok([
    {
      success: true,
      results: tables.map((name) => ({ type: "table", name, tbl_name: name, sql: `CREATE TABLE ${name}` })),
    },
  ])
}

const DEFAULT_ROUTES: FakeRoute[] = [
  { method: "GET", path: BUCKET_PATH, reply: ok({ name: BUCKET_NAME, creation_date: "2024-01-01T00:00:00Z" }) },
  { method: "GET", path: OBJECTS_PATH, reply: ok([], { is_truncated: false }) },
  { method: "DELETE", path: BUCKET_PATH, reply: ok({}) },
  { method: "GET", path: NAMESPACE_PATH, reply: ok({ id: NAMESPACE_ID, title: NAMESPACE_TITLE }) },
  { method: "GET", path: KEYS_PATH, reply: ok([], { cursor: "" }) },
  { method: "DELETE", path: NAMESPACE_PATH, reply: ok({ id: NAMESPACE_ID }) },
  { method: "GET", path: DATABASE_PATH, reply: ok({ uuid: DATABASE_ID, name: DATABASE_NAME, file_size: 12288 }) },
  { method: "POST", path: QUERY_PATH, reply: schemaReply() },
  { method: "DELETE", path: DATABASE_PATH, reply: ok({}) },
]

/** The create tool wired to a fake Cloudflare that answers `routes`. */
export function createFor(...routes: FakeRoute[]) {
  const { fetch, requests } = fakeCloudflare(routes)
  return { tool: defineStorageCreate({ fetch, env: envFor() }), requests }
}

/** The delete tool wired to a fake Cloudflare: the `routes` given first, then every store empty and every delete accepted. */
export function deleteFor(...routes: FakeRoute[]) {
  const { fetch, requests } = fakeCloudflare([...routes, ...DEFAULT_ROUTES])
  return { tool: defineStorageDelete({ fetch, env: envFor() }), requests }
}

export function sent(requests: FakeRequest[], method: "GET" | "POST" | "DELETE"): FakeRequest[] {
  return requests.filter((request) => request.method === method)
}

/** Each request as `METHOD path`. */
export function calls(requests: FakeRequest[]): string[] {
  return requests.map((request) => `${request.method} ${request.path}`)
}
