import { cloudflareClient, type CloudflareClient, type CloudflareDeps } from "../cloudflare/client"
import { isAbortError } from "../errors"
import { ANY_TARGET } from "../targets"
import type { ToolContext } from "../tool"
import { resolveZone, type Zone } from "../zone/lookup"

/** Connects a Cloudflare client with the call's abort signal and dependencies, and resolves the target zone. */
export async function resolveDnsZone(
  args: { account?: string; zone: string },
  ctx: ToolContext,
  deps?: CloudflareDeps,
): Promise<{ client: CloudflareClient; zone: Zone }> {
  const client = cloudflareClient(args.account, { ...deps, signal: ctx.signal })
  const zone = await resolveZone(client, args.zone)
  return { client, zone }
}

/** The target string `<account_id>/zones/<zone_id>/dns_records/<name>` for a record in a zone. */
export function dnsRecordTarget(accountId: string, zoneId: string, name: string): string {
  return `${accountId}/zones/${zoneId}/dns_records/${name}`
}

/**
 * Resolves the targets of a DNS record write tool: `<account_id>/zones/<zone_id>/dns_records/<name>` for each
 * unique name `collectNames` returns, or `*` when the zone or any record name cannot be resolved.
 */
export async function resolveDnsTargets(
  args: { account?: string; zone: string },
  ctx: ToolContext,
  collectNames: (client: CloudflareClient, zone: Zone) => Promise<Iterable<string>> | Iterable<string>,
  deps?: CloudflareDeps,
): Promise<string[]> {
  try {
    const { client, zone } = await resolveDnsZone(args, ctx, deps)
    const names = new Set(await collectNames(client, zone))
    return [...names].map((name) => dnsRecordTarget(client.accountId, zone.id, name))
  } catch (error) {
    if (isAbortError(error) || ctx.signal?.aborted) throw error
    return [ANY_TARGET]
  }
}
