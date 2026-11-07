import { envFor } from "../cloudflare/client.fixtures"
import { fakeCloudflare, ok, type FakeRoute } from "../cloudflare/testing"
import type { ConfirmRequest } from "../tool"
import { CTX, ZONE_PATH, ZONE_ROUTE } from "../zone/fixtures"
import { defineDnsRecordDelete } from "./delete"
import { batchRoute, recordRoute } from "./fixtures"

export { CTX, ZONE_PATH }

/** The delete tool wired to a fake Cloudflare that answers `routes` and the zone lookup. */
export function setup(...routes: FakeRoute[]) {
  const { fetch, requests } = fakeCloudflare([...routes, ZONE_ROUTE])
  return { tool: defineDnsRecordDelete({ fetch, env: envFor() }), requests }
}

/** The tool set up with the endpoints of `records` and a batch endpoint that answers `result`. */
export function setupWith(records: { id: string }[], result: { deletes?: unknown[]; posts?: unknown[] } = {}) {
  return setup(...records.map(recordRoute), batchRoute(ok(result)))
}

/** A call context whose confirmation answers `answer` and records what it was asked. */
export function confirming(answer: boolean) {
  const asked: ConfirmRequest[] = []
  const ctx = {
    ...CTX,
    confirm: async (request: ConfirmRequest) => {
      asked.push(request)
      return answer
    },
  }
  return { asked, ctx }
}
