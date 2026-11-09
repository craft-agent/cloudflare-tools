import { ACCOUNT_ID, ZONE_ID, envFor } from "../cloudflare/client.fixtures"
import { fail, fakeCloudflare, ok, type FakeReply, type FakeRequest, type FakeRoute } from "../cloudflare/testing"
import { SAMPLE_ZONE, ZONE_ROUTE } from "../zone/fixtures"
import { defineRulesAdd } from "./add"
import { RULESET_ID, entrypointRoute, rulesetOf } from "./fixtures"
import type { WritablePhase } from "./phases"

export { ACCOUNT_ID, ZONE_ID }
export { CTX, RULESET_ID, ZONE_NAME, entrypointPath, entrypointRoute, errorOf, refusalOf, rulesetOf } from "./fixtures"

export const PHASE: WritablePhase = "http_request_dynamic_redirect"
export const TARGET = `${ACCOUNT_ID}/zones/${ZONE_ID}/rulesets/${PHASE}`
export const NEW_RULE_ID = "d4".repeat(16)
export const FIRST_ID = "a1".repeat(16)
export const SECOND_ID = "b2".repeat(16)
export const CREATE_PATH = `/zones/${ZONE_ID}/rulesets`
export const RULE_CREATE_PATH = `/zones/${ZONE_ID}/rulesets/${RULESET_ID}/rules`

export const EXPRESSION = '(http.host eq "old.example.com")'
export const PARAMETERS = { from_value: { status_code: 301, target_url: { value: "https://new.example.com" } } }

export const ARGS = { zone: "example.com", phase: PHASE, expression: EXPRESSION, action: "redirect" }

/** The rule `ARGS` makes the call send, as the body of a rule create. */
export const RULE_BODY = { expression: EXPRESSION, action: "redirect", enabled: true }

/** The entry point of `PHASE` as Cloudflare answers for a zone that has none. */
export const NO_ENTRYPOINT = entrypointRoute(PHASE, fail(404, [{ code: 10003, message: "Could not find entrypoint" }]))

/** A rule the phase already holds: a redirect with a description. */
export const FIRST_RULE = {
  id: FIRST_ID,
  version: "1",
  ref: "ref-first",
  description: "Send /old to /new",
  expression: '(http.request.uri.path eq "/old")',
  action: "redirect",
  action_parameters: { from_value: { status_code: 301, target_url: { value: "/new" } } },
  enabled: true,
  last_updated: "2025-01-01T00:00:00Z",
}

/** A rule the phase already holds: a redirect without a description. */
export const SECOND_RULE = {
  id: SECOND_ID,
  version: "2",
  expression: '(http.request.uri.path eq "/older")',
  action: "redirect",
  action_parameters: { from_value: { status_code: 302, target_url: { value: "/newer" } } },
  enabled: false,
}

export const EXISTING = [FIRST_RULE, SECOND_RULE]

/** A throwing reply: the connection drops before Cloudflare answers. */
export function dropped(): never {
  throw new Error("connection reset")
}

type Position = { before?: string; after?: string; index?: number }

/** `rules` with `added` put at the place a rule create's `position` names; last when there is none. */
export function placed(rules: Array<{ id: string }>, added: unknown, position: Position = {}): unknown[] {
  const indexOf = (id: string) => rules.findIndex((rule) => rule.id === id)
  const at =
    position.index !== undefined
      ? position.index - 1
      : position.before !== undefined
        ? indexOf(position.before)
        : position.after !== undefined
          ? indexOf(position.after) + 1
          : rules.length
  return [...rules.slice(0, at), added, ...rules.slice(at)]
}

/** The rule-create call; by default it answers with the whole ruleset, the rule it was sent at the place it asked for. */
export function ruleCreateRoute(
  reply: FakeReply | ((request: FakeRequest) => FakeReply) = (request) => {
    const { position, ...rule } = request.body as { position?: Position }
    const added = { id: NEW_RULE_ID, version: "1", last_updated: "2025-03-01T00:00:00Z", ...rule }
    return rulesetOf(placed(EXISTING, added, position))
  },
): FakeRoute {
  return { method: "POST", path: RULE_CREATE_PATH, reply }
}

/** The ruleset-create call; by default it answers with the ruleset it was sent, its only rule given an id. */
export function createRoute(
  reply: FakeReply | ((request: FakeRequest) => FakeReply) = (request) => {
    const body = request.body as { rules: object[] }
    return rulesetOf([{ id: NEW_RULE_ID, version: "1", last_updated: "2025-03-01T00:00:00Z", ...body.rules[0] }])
  },
): FakeRoute {
  return { method: "POST", path: CREATE_PATH, reply }
}

/** The zone listing: the zone whose name the query asks for. */
const ZONES_ROUTE: FakeRoute = {
  method: "GET",
  path: "/zones",
  reply: (request) => ok(request.query.get("name") === SAMPLE_ZONE.name ? [SAMPLE_ZONE] : []),
}

/** The tool wired to a fake Cloudflare: the `routes` given first, then a zone, a phase holding `EXISTING` and both create calls. */
export function addFor(...routes: FakeRoute[]) {
  const { fetch, requests } = fakeCloudflare([
    ...routes,
    ZONES_ROUTE,
    ZONE_ROUTE,
    entrypointRoute(PHASE, rulesetOf(EXISTING)),
    ruleCreateRoute(),
    createRoute(),
  ])
  return { tool: defineRulesAdd({ fetch, env: envFor() }), requests }
}

/** The calls the fake received, as `METHOD path`. */
export function calls(requests: FakeRequest[]): string[] {
  return requests.map((request) => `${request.method} ${request.path}`)
}

/** The requests that are not reads. */
export function writes(requests: FakeRequest[]): FakeRequest[] {
  return requests.filter((request) => request.method !== "GET")
}
