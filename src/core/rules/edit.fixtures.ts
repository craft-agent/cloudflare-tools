import { ZONE_ID, envFor } from "../cloudflare/client.fixtures"
import { fakeCloudflare, type FakeReply, type FakeRequest, type FakeRoute } from "../cloudflare/testing"
import { ZONE_ROUTE } from "../zone/fixtures"
import { FIRST_ID, FIRST_RULE, PHASE, SECOND_RULE, ZONES_ROUTE, placed } from "./add.fixtures"
import { defineRulesEdit } from "./edit"
import { RULESET_ID, entrypointRoute, rulesetOf } from "./fixtures"

export {
  ACCOUNT_ID,
  CTX,
  FIRST_ID,
  NO_ENTRYPOINT,
  PARAMETERS,
  PHASE,
  RULESET_ID,
  SECOND_ID,
  SECOND_RULE,
  TARGET,
  ZONE_ID,
  ZONE_NAME,
  calls,
  dropped,
  entrypointPath,
  entrypointRoute,
  errorOf,
  refusalOf,
  rulesetOf,
  writes,
} from "./add.fixtures"

export const THIRD_ID = "c3".repeat(16)

/** The rule the calls change by default: the first one, with a reference and a logging setting to carry over. */
export const RULE = { ...FIRST_RULE, logging: { enabled: true } }

/** `RULE` as the tool shapes it at `position`, with `extra` changed. */
export const shaped = (position: number, extra: object = {}) => ({
  position,
  id: RULE.id,
  ref: RULE.ref,
  description: RULE.description,
  expression: RULE.expression,
  action: RULE.action,
  action_parameters: RULE.action_parameters,
  enabled: RULE.enabled,
  version: RULE.version,
  last_updated: RULE.last_updated,
  logging: RULE.logging,
  ...extra,
})

export const THIRD_RULE = {
  id: THIRD_ID,
  version: "5",
  expression: '(http.request.uri.path eq "/oldest")',
  action: "redirect",
  enabled: true,
}

/** The rules the phase holds, in order. */
export const RULES = [RULE, SECOND_RULE, THIRD_RULE]

export const NEW_DESCRIPTION = "Send /old to /next"

/** The arguments of a call that changes the description of the first rule, which is at version 1. */
export const ARGS = {
  zone: "example.com",
  phase: PHASE,
  rule: FIRST_ID,
  replaces: RULE.version,
  description: NEW_DESCRIPTION,
}

/** The path of the rule `id` of the phase's entry point. */
export function editPath(id: string): string {
  return `/zones/${ZONE_ID}/rulesets/${RULESET_ID}/rules/${id}`
}

/** What Cloudflare answers to a change of a rule: the whole ruleset, the rule as sent, and moved where `position` says. */
function editedRuleset(request: FakeRequest): FakeReply {
  const id = request.path.split("/").pop()
  const { position, ...definition } = request.body as { position?: Parameters<typeof placed>[2] }
  const old = RULES.find((rule) => rule.id === id)!
  const edited = { ...old, ...definition, version: "9", last_updated: "2025-03-01T00:00:00Z" }
  return rulesetOf(
    position === undefined
      ? RULES.map((rule) => (rule.id === id ? edited : rule))
      : placed(
          RULES.filter((rule) => rule.id !== id),
          edited,
          position,
        ),
  )
}

/** The rule-change call of the rule `id`; by default it answers with the ruleset holding the rule as sent. */
export function ruleEditRoute(
  reply: FakeReply | ((request: FakeRequest) => FakeReply) = editedRuleset,
  id: string = FIRST_ID,
): FakeRoute {
  return { method: "PATCH", path: editPath(id), reply }
}

/** The tool wired to a fake Cloudflare: the `routes` given first, then a zone, a phase holding `RULES` and the rule-change calls. */
export function editFor(...routes: FakeRoute[]) {
  const { fetch, requests } = fakeCloudflare([
    ...routes,
    ZONES_ROUTE,
    ZONE_ROUTE,
    entrypointRoute(PHASE, rulesetOf(RULES)),
    ...RULES.map((rule) => ruleEditRoute(editedRuleset, rule.id)),
  ])
  return { tool: defineRulesEdit({ fetch, env: envFor() }), requests }
}
