import { cloudflareClient, type CloudflareClient, type CloudflareDeps } from "../cloudflare/client"
import { ROUTES } from "../cloudflare/routes"
import { isAbortError, isToolError, ToolError } from "../errors"
import { ANY_TARGET } from "../targets"
import type { ToolContext } from "../tool"
import { resolveZone, type Zone } from "../zone/lookup"
import { NOTHING_CHANGED, type Action } from "./rule"
import { RULES_READ_HINT, shapedRule, withHint } from "./rule.checks"
import type { Rule } from "./shape"

/** A rule these tools change: one address and one plain action, not the catch-all, not managed by Wrangler. */
export type ChangeableRule = Rule & { to: string; action: Action }

/** What a `targets` resolver knows once it has found the rule: the account, the zone and the rule. */
type Found = { accountId: string; zone: Zone; rule: ChangeableRule }

/** An `invalid_argument` that says nothing was changed. */
export function refusal(message: string): ToolError {
  return new ToolError("invalid_argument", `${message} ${NOTHING_CHANGED}`)
}

async function requestRule(client: CloudflareClient, zone: Pick<Zone, "id" | "name">, id: string): Promise<unknown> {
  try {
    const { result } = await client.request<unknown>(ROUTES.emailRoutingRule, {
      path: { zone_id: zone.id, rule_id: id },
    })
    return result
  } catch (error) {
    if (!isToolError(error)) throw error
    if (error.code === "not_found") {
      throw new ToolError(
        "not_found",
        `${id} is not a routing rule of ${zone.name}; cloudflare_email_read rules lists them. ${NOTHING_CHANGED}`,
        { cause: error },
      )
    }
    throw withHint(error, RULES_READ_HINT)
  }
}

/**
 * Reads one rule of the zone and refuses what these tools do not change, with nothing sent: the catch-all, a rule a
 * Worker's Wrangler configuration manages, and a rule of a shape that is not one address with one plain action.
 */
export async function readRule(
  client: CloudflareClient,
  zone: Pick<Zone, "id" | "name">,
  id: string,
): Promise<ChangeableRule> {
  const rule = shapedRule(await requestRule(client, zone, id))
  if (rule.to === null && rule.action !== null) {
    throw refusal(`${id} is the zone's catch-all; cloudflare_email_catchall_edit changes it.`)
  }
  if (rule.managed_by === "wrangler") {
    throw refusal(
      `Rule ${id} is managed by a Worker's Wrangler configuration, and its next deploy would undo the change; change it there.`,
    )
  }
  if (rule.to === null || rule.action === null) {
    throw refusal(`Rule ${id} has a shape these tools do not change; change it in the dashboard.`)
  }
  return { ...rule, to: rule.to, action: rule.action }
}

/**
 * Finds the zone and the rule a call is about, as its `targets` resolver does: the targets `targetsFor` names for
 * them, or `*` when anything fails. A cancellation is passed on.
 */
export async function ruleTargetsOf(
  args: { account?: string; zone: string; id: string },
  ctx: ToolContext,
  deps: CloudflareDeps | undefined,
  targetsFor: (found: Found) => string[],
): Promise<string[]> {
  try {
    const client = cloudflareClient(args.account, { ...deps, signal: ctx.signal })
    const zone = await resolveZone(client, args.zone)
    const rule = await readRule(client, zone, args.id)
    return targetsFor({ accountId: client.accountId, zone, rule })
  } catch (error) {
    if (isAbortError(error) || ctx.signal?.aborted) throw error
    return [ANY_TARGET]
  }
}
