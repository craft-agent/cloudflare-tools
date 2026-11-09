import type { CloudflareClient } from "../cloudflare/client"
import { ROUTES } from "../cloudflare/routes"
import { isToolError } from "../errors"
import type { Zone } from "../zone/lookup"
import { describeAction, sameAction, type Action } from "./rule"
import { RULES_READ_HINT, shapedRule, withHint } from "./rule.checks"
import { refusal } from "./rule.current"
import type { Rule } from "./shape"

/** What a catch-all does with the mail no rule matches: the action it takes while it is on, or `"disabled"` while it is off. */
export type CatchAllState = Action | "disabled"

/**
 * The zone's catch-all as these tools change it: its rule, or `null` when Cloudflare has none, which is the same as one
 * that is off with no action. A catch-all that is on always has a plain action.
 */
export type CatchAll = Rule | null

/** The state of a catch-all: its action while it is on, else `"disabled"`. */
export function stateOf(catchAll: CatchAll): CatchAllState {
  return catchAll === null || !catchAll.enabled || catchAll.action === null ? "disabled" : catchAll.action
}

/** Whether two states are the same: both off, or both on with the same action. */
export function sameState(a: CatchAllState, b: CatchAllState): boolean {
  if (a === "disabled" || b === "disabled") return a === b
  return sameAction(a, b)
}

/** The clause that follows "mail to an address no rule matches": what happens to it in `state`. */
export function mailClause(state: CatchAllState): string {
  return state === "disabled" ? "is rejected, since the catch-all is off" : describeAction(state)
}

/** The catch-all in `state`, as a stale refusal names it. */
export function describeState(state: CatchAllState): string {
  return state === "disabled"
    ? "off (mail no rule matches is rejected)"
    : `on (mail no rule matches ${describeAction(state)})`
}

/**
 * Reads the zone's catch-all and refuses, with nothing sent, one a Worker's Wrangler configuration manages and one that
 * is on with a shape these tools do not change. A zone without one (`not_found`) reads as `null`.
 */
export async function readCatchAll(client: CloudflareClient, zone: Pick<Zone, "id" | "name">): Promise<CatchAll> {
  try {
    const { result } = await client.request<unknown>(ROUTES.emailRoutingCatchAll, { path: { zone_id: zone.id } })
    return refusingUnchangeable(shapedRule(result), zone.name)
  } catch (error) {
    if (!isToolError(error)) throw error
    if (error.code === "not_found") return null
    throw withHint(error, RULES_READ_HINT)
  }
}

function refusingUnchangeable(catchAll: Rule, zoneName: string): Rule {
  if (catchAll.managed_by === "wrangler") {
    throw refusal(
      `The catch-all of ${zoneName} is managed by a Worker's Wrangler configuration, and its next deploy would undo the change; change it there.`,
    )
  }
  if (catchAll.enabled && catchAll.action === null) {
    throw refusal(`The catch-all of ${zoneName} has a shape these tools do not change; change it in the dashboard.`)
  }
  return catchAll
}
