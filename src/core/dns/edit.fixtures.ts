import { envFor } from "../cloudflare/client.fixtures"
import { fakeCloudflare, ok, type FakeRequest, type FakeRoute } from "../cloudflare/testing"
import { ZONE_ROUTE } from "../zone/fixtures"
import { defineDnsRecordEdit } from "./edit"
import { batchRoute, recordRoute } from "./fixtures"

export { CTX, ZONE_PATH } from "./add.fixtures"

/** The edit tool wired to a fake Cloudflare that answers `routes` and the zone lookup. */
export function setup(...routes: FakeRoute[]) {
  const { fetch, requests } = fakeCloudflare([...routes, ZONE_ROUTE])
  return { tool: defineDnsRecordEdit({ fetch, env: envFor() }), requests }
}

/** The tool set up with the endpoints of `records` and a batch endpoint that answers `patches`. */
export function setupWith(records: { id: string }[], patches: unknown[] = []) {
  return setup(...records.map(recordRoute), batchRoute(ok({ patches })))
}

/** The paths of the requests the tool sent, in order. */
export function pathsOf(requests: FakeRequest[]): string[] {
  return requests.map((request) => request.path)
}
