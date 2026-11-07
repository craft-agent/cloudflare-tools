import { envFor } from "../cloudflare/client.fixtures"
import { fakeCloudflare, ok, type FakeReply, type FakeRequest, type FakeRoute } from "../cloudflare/testing"
import { CTX, ZONE_PATH, ZONE_ROUTE } from "../zone/fixtures"
import { defineDnsRecordAdd } from "./add"

export { CTX, ZONE_PATH, ZONE_ROUTE }
export const BATCH_PATH = `${ZONE_PATH}/dns_records/batch`

/** The batch endpoint answering `reply`, by default with an empty result. */
export function batchRoute(reply: FakeReply | ((request: FakeRequest) => FakeReply) = ok({})): FakeRoute {
  return { method: "POST", path: BATCH_PATH, reply }
}

/** The add tool wired to a fake Cloudflare that answers `routes`, and the zone lookup unless a route answers it first. */
export function setup(...routes: FakeRoute[]) {
  const { fetch, requests } = fakeCloudflare([...routes, ZONE_ROUTE])
  return { tool: defineDnsRecordAdd({ fetch, env: envFor() }), requests }
}

/** The requests that are batch posts. */
export function batchRequests(requests: FakeRequest[]): FakeRequest[] {
  return requests.filter((request) => request.path === BATCH_PATH)
}
