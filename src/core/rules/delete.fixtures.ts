import { envFor } from "../cloudflare/client.fixtures"
import { fakeCloudflare, type FakeReply, type FakeRequest, type FakeRoute } from "../cloudflare/testing"
import { ZONE_ROUTE } from "../zone/fixtures"
import { ZONES_ROUTE } from "./add.fixtures"
import { defineRulesDelete } from "./delete"
import { FIRST_ID, PHASE, RULES, editPath, entrypointPath, entrypointRoute, rulesetOf } from "./edit.fixtures"

export {
  ACCOUNT_ID,
  CTX,
  FIRST_ID,
  NO_ENTRYPOINT,
  PHASE,
  RULE,
  RULES,
  RULESET_ID,
  SECOND_ID,
  TARGET,
  THIRD_ID,
  ZONE_ID,
  ZONE_NAME,
  calls,
  dropped,
  editPath,
  entrypointPath,
  entrypointRoute,
  rulesetOf,
  shaped,
  writes,
} from "./edit.fixtures"

/** The arguments of a call that deletes the first rule of the phase. */
export const ARGS = { zone: "example.com", phase: PHASE, rule: FIRST_ID }

/** The ruleset Cloudflare answers to a delete of the rule at the request's path: the other rules, in their order. */
function withoutRule(request: FakeRequest): FakeReply {
  const id = request.path.split("/").pop()
  return rulesetOf(RULES.filter((rule) => rule.id !== id))
}

/** The rule-delete call of the rule `id`; by default it answers with the ruleset without it. */
export function ruleDeleteRoute(
  reply: FakeReply | ((request: FakeRequest) => FakeReply) = withoutRule,
  id: string = FIRST_ID,
): FakeRoute {
  return { method: "DELETE", path: editPath(id), reply }
}

/** An entry point route that answers its first read with the phase as it is and every later one with `later`. */
export function changingEntrypoint(later: FakeReply): FakeRoute {
  let reads = 0
  return { method: "GET", path: entrypointPath(PHASE), reply: () => (reads++ === 0 ? rulesetOf(RULES) : later) }
}

/** The tool wired to a fake Cloudflare: the `routes` given first, then a zone, a phase holding `RULES` and the delete calls. */
export function deleteFor(...routes: FakeRoute[]) {
  const { fetch, requests } = fakeCloudflare([
    ...routes,
    ZONES_ROUTE,
    ZONE_ROUTE,
    entrypointRoute(PHASE, rulesetOf(RULES)),
    ...RULES.map((rule) => ruleDeleteRoute(withoutRule, rule.id)),
  ])
  return { tool: defineRulesDelete({ fetch, env: envFor() }), requests }
}
