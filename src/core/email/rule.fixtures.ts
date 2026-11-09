import { ACCOUNT_ID, ZONE_ID, envFor } from "../cloudflare/client.fixtures"
import { fakeCloudflare, ok, type FakeReply, type FakeRequest, type FakeRoute } from "../cloudflare/testing"
import { SAMPLE_ZONE, ZONE_ROUTE } from "../zone/fixtures"
import { ADDRESSES_PATH, ROUTING_PATH, RULES_PATH } from "./fixtures"
import { defineEmailRuleAdd } from "./rule-add"

export { ACCOUNT_ID, ZONE_ID }
export { ADDRESSES_PATH, CTX, RULES_PATH, ROUTING_PATH, ZONE_NAME, errorOf, refusalOf } from "./fixtures"

export const NEW_RULE_ID = "d4".repeat(16)
export const DESTINATION = "owner@example.net"
export const TO = "sales@example.com"
export const TARGET = `${ACCOUNT_ID}/zones/${ZONE_ID}/email/rules/${TO}`

export const ARGS = { zone: "example.com", to: "sales", action: { type: "forward", to: DESTINATION } }

/** Email Routing settings of a zone that has it on. */
export const ROUTING_ON = { enabled: true, status: "ready", support_subaddress: true }

/** A destination address of the account, as Cloudflare lists it. */
export function addressRow(email: string, verified: string | null = "2024-01-01T00:00:00Z") {
  return { id: "e5".repeat(16), email, verified, created: "2023-12-01T00:00:00Z" }
}

/** A rule that already matches `to`, in the shape of Cloudflare's list. */
export function ruleRow(to: string, extra: Record<string, unknown> = {}) {
  return {
    id: "a1".repeat(16),
    name: "Existing",
    enabled: true,
    priority: 10,
    matchers: [{ type: "literal", field: "to", value: to }],
    actions: [{ type: "drop" }],
    ...extra,
  }
}

/** A throwing reply: the connection drops before Cloudflare answers. */
export function dropped(): never {
  throw new Error("connection reset")
}

type Reply = FakeReply | ((request: FakeRequest) => FakeReply)

/** A listing reply that serves `pages[page - 1]` with Cloudflare's paging, 50 rows a page. */
export function paged(pages: unknown[][]): (request: FakeRequest) => FakeReply {
  return (request) => {
    const page = Number(request.query.get("page"))
    const total = pages.reduce((sum, rows) => sum + rows.length, 0)
    return ok(pages[page - 1] ?? [], { page, per_page: 50, total_count: total, total_pages: pages.length })
  }
}

export function routingRoute(reply: Reply = ok(ROUTING_ON)): FakeRoute {
  return { method: "GET", path: ROUTING_PATH, reply }
}

export function rulesRoute(reply: Reply = paged([[]])): FakeRoute {
  return { method: "GET", path: RULES_PATH, reply }
}

export function addressesRoute(reply: Reply = paged([[addressRow(DESTINATION)]])): FakeRoute {
  return { method: "GET", path: ADDRESSES_PATH, reply }
}

/** The create call; by default it answers with the rule it was sent, as Cloudflare does. */
export function createRoute(
  reply: Reply = (request) => ok({ id: NEW_RULE_ID, tag: NEW_RULE_ID, priority: 0, ...(request.body as object) }),
): FakeRoute {
  return { method: "POST", path: RULES_PATH, reply }
}

/** The zone listing: the zone whose name the query asks for. */
export const ZONES_ROUTE: FakeRoute = {
  method: "GET",
  path: "/zones",
  reply: (request) => ok(request.query.get("name") === SAMPLE_ZONE.name ? [SAMPLE_ZONE] : []),
}

/** The tool wired to a fake Cloudflare: the `routes` given first, then a zone, Email Routing on, no rules, one verified destination and the create call. */
export function ruleAddFor(...routes: FakeRoute[]) {
  const { fetch, requests } = fakeCloudflare([
    ...routes,
    ZONES_ROUTE,
    ZONE_ROUTE,
    routingRoute(),
    rulesRoute(),
    addressesRoute(),
    createRoute(),
  ])
  return { tool: defineEmailRuleAdd({ fetch, env: envFor() }), requests }
}

export function sent(requests: FakeRequest[], method: "GET" | "POST" | "PUT" | "DELETE"): FakeRequest[] {
  return requests.filter((request) => request.method === method)
}

/** The calls the fake received, as `METHOD path`. */
export function calls(requests: FakeRequest[]): string[] {
  return requests.map((request) => `${request.method} ${request.path}`)
}
