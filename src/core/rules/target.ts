import type { CloudflareDeps } from "../cloudflare/client"
import { isAbortError } from "../errors"
import { ANY_TARGET } from "../targets"
import type { ToolContext } from "../tool"
import { resolveZoneTarget } from "../zone/lookup"
import type { Phase } from "./phases"

/**
 * What a call about the rules of `args.phase` writes to: `<account_id>/zones/<zone_id>/rulesets/<phase>`, after
 * finding the zone and nothing else; `*` when the zone cannot be told. A cancellation is passed on.
 */
export async function phaseTargets(
  args: { account?: string; zone: string; phase: Phase },
  ctx: ToolContext,
  deps?: CloudflareDeps,
): Promise<string[]> {
  try {
    const zoneTarget = await resolveZoneTarget(args, ctx, deps)
    return [`${zoneTarget}/rulesets/${args.phase}`]
  } catch (error) {
    if (isAbortError(error) || ctx.signal?.aborted) throw error
    return [ANY_TARGET]
  }
}
