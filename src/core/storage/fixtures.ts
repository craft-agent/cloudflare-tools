import { ACCOUNT_ID, envFor } from "../cloudflare/client.fixtures"
import { fakeCloudflare, type FakeRoute } from "../cloudflare/testing"
import { defineStorageRead } from "./read"

export { errorOf, refusalOf } from "../workers/fixtures"
export { CTX } from "../zone/fixtures"

export const BUCKET_NAME = "my-bucket"
export const BUCKETS_PATH = `/accounts/${ACCOUNT_ID}/r2/buckets`
export const BUCKET_PATH = `/accounts/${ACCOUNT_ID}/r2/buckets/${BUCKET_NAME}`
export const MANAGED_DOMAIN_PATH = `${BUCKET_PATH}/domains/managed`
export const CUSTOM_DOMAINS_PATH = `${BUCKET_PATH}/domains/custom`
export const CORS_PATH = `${BUCKET_PATH}/cors`
export const LIFECYCLE_PATH = `${BUCKET_PATH}/lifecycle`
export const OBJECTS_PATH = `${BUCKET_PATH}/objects`

/** The tool wired to a fake Cloudflare that answers `routes`. */
export function toolFor(...routes: FakeRoute[]) {
  const { fetch, requests } = fakeCloudflare(routes)
  return { tool: defineStorageRead({ fetch, env: envFor() }), requests }
}
