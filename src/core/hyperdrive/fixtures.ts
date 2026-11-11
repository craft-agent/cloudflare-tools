import { ACCOUNT_ID, envFor } from "../cloudflare/client.fixtures"
import { fakeCloudflare, type FakeRoute } from "../cloudflare/testing"
import { defineHyperdriveRead } from "./read"

export { errorOf, refusalOf } from "../workers/fixtures"
export { CTX } from "../zone/fixtures"

export const CONFIG_ID = "a1".repeat(16)
export const CONFIGS_PATH = `/accounts/${ACCOUNT_ID}/hyperdrive/configs`
export const CONFIG_PATH = `${CONFIGS_PATH}/${CONFIG_ID}`
export const CONFIG = { id: CONFIG_ID, name: "app-db" }
export const EMPTY_ORIGIN = {
  scheme: null,
  host: null,
  port: null,
  database: null,
  user: null,
  access_client_id: null,
  service_id: null,
}
export const EMPTY_CACHING = { disabled: null, max_age: null, stale_while_revalidate: null }
export const EMPTY_MTLS = { ca_certificate_id: null, mtls_certificate_id: null, sslmode: null }

/** The tool wired to a fake Cloudflare that answers `routes`. */
export function toolFor(...routes: FakeRoute[]) {
  const { fetch, requests } = fakeCloudflare(routes)
  return { tool: defineHyperdriveRead({ fetch, env: envFor() }), requests }
}
