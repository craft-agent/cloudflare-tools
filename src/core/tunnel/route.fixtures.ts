import { ACCOUNT_ID, ZONE_ID, envFor } from "../cloudflare/client.fixtures"
import { fakeCloudflare, ok, type FakeReply, type FakeRequest, type FakeRoute } from "../cloudflare/testing"
import { BATCH_PATH, RECORDS_PATH } from "../dns/fixtures"
import { SAMPLE_ZONE, ZONE_NAME, ZONE_PATH } from "../zone/fixtures"
import { TUNNEL_CONFIG_PATH, TUNNEL_ID, TUNNEL_PATH } from "./fixtures"
import { defineTunnelRouteAdd } from "./route-add"
import { defineTunnelRouteEdit } from "./route-edit"
import { defineTunnelRouteRemove } from "./route-remove"

export {
  ACCOUNT_ID,
  BATCH_PATH,
  RECORDS_PATH,
  TUNNEL_CONFIG_PATH,
  TUNNEL_ID,
  TUNNEL_PATH,
  ZONE_ID,
  ZONE_NAME,
  ZONE_PATH,
}
export { CTX, errorOf, refusalOf } from "./fixtures"

export const HOSTNAME = `app.${ZONE_NAME}`
export const SERVICE = "http://localhost:8080"
export const TARGET = `${TUNNEL_ID}.cfargotunnel.com`
export const ARGS = { tunnel: TUNNEL_ID, hostname: HOSTNAME, service: SERVICE }
export const ACCESS_PATH = `/accounts/${ACCOUNT_ID}/access/apps`
export const ZONES_PATH = "/zones"

/** The tunnel's target of a write: its hostname under the tunnel, and the DNS record at the hostname. */
export const ROUTE_TARGET = `${ACCOUNT_ID}/cfd_tunnel/${TUNNEL_ID}/${HOSTNAME}`
export const DNS_TARGET = `${ACCOUNT_ID}/zones/${ZONE_ID}/dns_records/${HOSTNAME}`

export const TUNNEL_NAME = "prod-tunnel"
export const TUNNEL_ENTRY = { id: TUNNEL_ID, name: TUNNEL_NAME, status: "healthy", config_src: "cloudflare" }

/** A rule that is not the new one, with fields of its own to keep. */
export const API_RULE = {
  hostname: "api.example.com",
  path: "/v1/.*",
  service: "http://localhost:3000",
  originRequest: { noTLSVerify: true },
}
export const CATCH_ALL = { service: "http_status:404" }

/** A configuration with fields besides the ingress, which must survive a write. */
export const CONFIG = {
  originRequest: { connectTimeout: 30 },
  "warp-routing": { enabled: false },
  futureField: { nested: [1, 2] },
  ingress: [API_RULE, CATCH_ALL],
}
export const VERSION = 7

export const NEW_RULE = { hostname: HOSTNAME, service: SERVICE }

/** The proxied CNAME to the tunnel, as Cloudflare lists it. */
export const OWN_CNAME = {
  id: "9".repeat(32),
  type: "CNAME",
  name: HOSTNAME,
  content: TARGET,
  proxied: true,
  proxiable: true,
  ttl: 1,
  comment: "Cloudflare Tunnel",
  tags: [],
  modified_on: "2024-03-03T00:00:00Z",
}
export const SHAPED_OWN_CNAME = {
  id: OWN_CNAME.id,
  type: "CNAME",
  name: HOSTNAME,
  content: TARGET,
  proxied: true,
  read_only: false,
}
export const A_RECORD = { ...OWN_CNAME, id: "8".repeat(32), type: "A", content: "192.0.2.10" }

/** A reply that changes with each call: the first one for the first call, the second for every call after. */
export function changing(first: FakeReply, second: FakeReply): () => FakeReply {
  let calls = 0
  return () => (calls++ === 0 ? first : second)
}

export function dropped(): never {
  throw new Error("connection reset")
}

export function tunnelRoute(reply: FakeReply = ok(TUNNEL_ENTRY)): FakeRoute {
  return { method: "GET", path: TUNNEL_PATH, reply }
}

export function configRoute(
  reply: FakeReply | (() => FakeReply) = ok({ version: VERSION, config: CONFIG }),
): FakeRoute {
  return { method: "GET", path: TUNNEL_CONFIG_PATH, reply }
}

export function putRoute(reply: FakeReply | (() => FakeReply) = ok({ version: VERSION + 1 })): FakeRoute {
  return { method: "PUT", path: TUNNEL_CONFIG_PATH, reply }
}

/** The zone listing: the zones whose name the query asks for. */
export function zonesRoute(zones: unknown[] = [SAMPLE_ZONE]): FakeRoute {
  const named = (name: string | null) => zones.filter((zone) => (zone as { name: string }).name === name)
  return { method: "GET", path: ZONES_PATH, reply: (request) => ok(named(request.query.get("name"))) }
}

export const ZONE_ROUTE: FakeRoute = { method: "GET", path: ZONE_PATH, reply: ok(SAMPLE_ZONE) }

export function recordsRoute(reply: FakeReply | (() => FakeReply) = ok([])): FakeRoute {
  return { method: "GET", path: RECORDS_PATH, reply }
}

export function batchRoute(
  reply: FakeReply | (() => FakeReply) = ok({ posts: [OWN_CNAME], deletes: [OWN_CNAME] }),
): FakeRoute {
  return { method: "POST", path: BATCH_PATH, reply }
}

/** The rule the edit and remove tools work on: it has keys of its own, which an edit must keep. */
export const PUBLISHED_RULE = {
  hostname: HOSTNAME,
  service: SERVICE,
  originRequest: { connectTimeout: 5, noTLSVerify: true },
  futureKey: "kept",
}
export const PUBLISHED_CONFIG = { ...CONFIG, ingress: [API_RULE, PUBLISHED_RULE, CATCH_ALL] }

/** The configuration that publishes `PUBLISHED_RULE` (or the `ingress` given). */
export function publishedRoute(ingress: unknown[] = PUBLISHED_CONFIG.ingress): FakeRoute {
  return configRoute(ok({ version: VERSION, config: { ...CONFIG, ingress } }))
}

export function accessRoute(apps: unknown[] = []): FakeRoute {
  return { method: "GET", path: ACCESS_PATH, reply: ok(apps) }
}

/** A fake Cloudflare: the `routes` given first, then a tunnel, a zone, a configuration, no records, no Access application and the writes. */
function fakeRoutes(routes: FakeRoute[]) {
  const { fetch, requests } = fakeCloudflare([
    ...routes,
    tunnelRoute(),
    zonesRoute(),
    ZONE_ROUTE,
    configRoute(),
    recordsRoute(),
    accessRoute(),
    putRoute(),
    batchRoute(),
  ])
  return { deps: { fetch, env: envFor() }, requests }
}

/** The add tool wired to a fake Cloudflare (see `fakeRoutes`). */
export function routeFor(...routes: FakeRoute[]) {
  const { deps, requests } = fakeRoutes(routes)
  return { tool: defineTunnelRouteAdd(deps), requests }
}

/** The edit tool wired to a fake Cloudflare whose tunnel publishes `PUBLISHED_RULE` behind its own CNAME. */
export function editFor(...routes: FakeRoute[]) {
  const { deps, requests } = fakeRoutes([...routes, publishedRoute(), recordsRoute(ok([OWN_CNAME]))])
  return { tool: defineTunnelRouteEdit(deps), requests }
}

/** The remove tool wired to the same fake Cloudflare as `editFor`. */
export function removeFor(...routes: FakeRoute[]) {
  const { deps, requests } = fakeRoutes([...routes, publishedRoute(), recordsRoute(ok([OWN_CNAME]))])
  return { tool: defineTunnelRouteRemove(deps), requests }
}

export function sent(requests: FakeRequest[], method: "GET" | "PUT" | "POST"): FakeRequest[] {
  return requests.filter((request) => request.method === method)
}

/** Every write the fake received: the configuration's PUT and the DNS batch. */
export function writes(requests: FakeRequest[]): FakeRequest[] {
  return requests.filter((request) => request.method !== "GET")
}
