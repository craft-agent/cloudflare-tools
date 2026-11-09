import { envFor } from "../cloudflare/client.fixtures"
import { fail, fakeCloudflare, ok, type FakeReply, type FakeRequest, type FakeRoute } from "../cloudflare/testing"
import { ZONE_ROUTE } from "../zone/fixtures"
import { CATCH_ALL_PATH, CATCH_ALL_RULE, RULE_ID, SHAPED_FORWARD_RULE } from "./fixtures"
import { defineEmailRuleDelete } from "./rule-delete"
import { defineEmailRuleEdit } from "./rule-edit"
import {
  DESTINATION,
  RULES_PATH,
  TO,
  ZONES_ROUTE,
  addressRow,
  addressesRoute,
  paged,
  routingRoute,
  rulesRoute,
} from "./rule.fixtures"
import type { Rule } from "./shape"

export { CATCH_ALL_PATH, CATCH_ALL_RULE, RULE_ID }

export const RULE_PATH = `${RULES_PATH}/${RULE_ID}`

/** The address another destination of the account has, to which a rule can be changed. */
export const OTHER_DESTINATION = "other@example.net"

/** A rule of the zone that forwards `TO` to `DESTINATION`, as Cloudflare returns one rule. */
export const CURRENT_RULE = {
  id: RULE_ID,
  tag: RULE_ID,
  name: "Sales forward",
  enabled: true,
  priority: 10,
  matchers: [{ type: "literal", field: "to", value: TO }],
  actions: [{ type: "forward", value: [DESTINATION] }],
}

/** `CURRENT_RULE` as the tool shapes it. */
export const SHAPED_CURRENT: Rule = {
  ...SHAPED_FORWARD_RULE,
  name: "Sales forward",
  to: TO,
  action: { type: "forward", to: DESTINATION },
}

/** The arguments of an edit that names the rule and what it does now; a test adds what changes. */
export const EDIT_BASE = { zone: "example.com", id: RULE_ID, replaces: { type: "forward", to: DESTINATION } }

/** The arguments of a delete. */
export const DELETE_ARGS = { zone: "example.com", id: RULE_ID }

/** What Cloudflare answers a read of the catch-all as a rule with, by its own id. */
export const INVALID_RULE_OPERATION = fail(409, [{ code: 2020, message: "Invalid rule operation" }])

/** The error message the client makes of `INVALID_RULE_OPERATION`. */
export const INVALID_RULE_OPERATION_MESSAGE = "Cloudflare answered HTTP 409: 2020: Invalid rule operation"

type Reply = FakeReply | ((request: FakeRequest) => FakeReply)

export function ruleRoute(reply: Reply = ok(CURRENT_RULE)): FakeRoute {
  return { method: "GET", path: RULE_PATH, reply }
}

/** The replace call; by default it answers with the rule it was sent, as Cloudflare does. */
export function replaceRoute(
  reply: Reply = (request) => ok({ id: RULE_ID, tag: RULE_ID, ...(request.body as object) }),
): FakeRoute {
  return { method: "PUT", path: RULE_PATH, reply }
}

export function removeRoute(reply: Reply = ok({ id: RULE_ID, tag: RULE_ID })): FakeRoute {
  return { method: "DELETE", path: RULE_PATH, reply }
}

export function catchAllRoute(reply: Reply = ok(CATCH_ALL_RULE)): FakeRoute {
  return { method: "GET", path: CATCH_ALL_PATH, reply }
}

/** The edit tool wired to a fake Cloudflare: the `routes` given first, then a zone, Email Routing on, `CURRENT_RULE`, no other rules, the addresses of `DESTINATION` and `OTHER_DESTINATION`, and the replace call. */
export function ruleEditFor(...routes: FakeRoute[]) {
  const { fetch, requests } = fakeCloudflare([
    ...routes,
    ZONES_ROUTE,
    ZONE_ROUTE,
    routingRoute(),
    ruleRoute(),
    rulesRoute(),
    addressesRoute(paged([[addressRow(DESTINATION), addressRow(OTHER_DESTINATION)]])),
    replaceRoute(),
  ])
  return { tool: defineEmailRuleEdit({ fetch, env: envFor() }), requests }
}

/** The delete tool wired to a fake Cloudflare: the `routes` given first, then a zone, `CURRENT_RULE`, an enabled catch-all that drops and the delete call. */
export function ruleDeleteFor(...routes: FakeRoute[]) {
  const { fetch, requests } = fakeCloudflare([
    ...routes,
    ZONES_ROUTE,
    ZONE_ROUTE,
    ruleRoute(),
    catchAllRoute(),
    removeRoute(),
  ])
  return { tool: defineEmailRuleDelete({ fetch, env: envFor() }), requests }
}
