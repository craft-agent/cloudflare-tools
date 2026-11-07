import { envFor } from "../cloudflare/client.fixtures"
import { fakeCloudflare, type FakeRoute } from "../cloudflare/testing"
import { CTX, ZONE_PATH, ZONE_ROUTE } from "../zone/fixtures"
import { defineDnsRecordAdd } from "./add"

export { CTX, ZONE_PATH, ZONE_ROUTE }

/** The add tool wired to a fake Cloudflare that answers `routes`, and the zone lookup unless a route answers it first. */
export function setup(...routes: FakeRoute[]) {
  const { fetch, requests } = fakeCloudflare([...routes, ZONE_ROUTE])
  return { tool: defineDnsRecordAdd({ fetch, env: envFor() }), requests }
}
