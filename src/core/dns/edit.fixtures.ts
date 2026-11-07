import { envFor } from "../cloudflare/client.fixtures"
import { fakeCloudflare, ok, type FakeRequest, type FakeRoute } from "../cloudflare/testing"
import { ZONE_NAME, ZONE_ROUTE } from "../zone/fixtures"
import { defineDnsRecordEdit } from "./edit"
import { A_RECORD, CAA_RECORD, batchRoute, recordRoute } from "./fixtures"

export { CTX, ZONE_PATH } from "./add.fixtures"

/** An A record that is not proxied and has a ttl of 300, so it cannot be proxied without an automatic ttl. */
export const PLAIN_A_RECORD = {
  ...A_RECORD,
  id: "1".repeat(32),
  name: `api.${ZONE_NAME}`,
  content: "192.0.2.7",
  proxied: false,
  ttl: 300,
  comment: null,
}

export const CNAME_RECORD = {
  ...PLAIN_A_RECORD,
  id: "2".repeat(32),
  type: "CNAME",
  name: `blog.${ZONE_NAME}`,
  content: "Hosting.example.net.",
  proxied: false,
  proxiable: true,
  ttl: 1,
}

export const SRV_RECORD = {
  ...CAA_RECORD,
  id: "3".repeat(32),
  type: "SRV",
  name: `_sip._tcp.${ZONE_NAME}`,
  content: "10 5 5060 sip.example.org",
  data: {
    priority: 10,
    weight: 5,
    port: 5060,
    target: "Sip.Example.org.",
    name: `_sip._tcp.${ZONE_NAME}`,
    proto: "_tcp",
    service: "_sip",
  },
}

export const HTTPS_RECORD = { ...A_RECORD, id: "4".repeat(32), type: "HTTPS", content: '1 . alpn="h2"' }

export const WORKER_RECORD = {
  ...A_RECORD,
  id: "5".repeat(32),
  name: `app.${ZONE_NAME}`,
  meta: { read_only: true, origin_worker_id: "worker-id" },
}

export const PRODUCT_RECORD = { ...A_RECORD, id: "6".repeat(32), name: `x.${ZONE_NAME}`, meta: { read_only: true } }

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
