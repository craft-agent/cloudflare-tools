import { domainToASCII } from "node:url"
import { z } from "zod"
import { cloudflareClient, type CloudflareClient, type CloudflareDeps } from "../cloudflare/client"
import { isPlainObject } from "../cloudflare/reply"
import { ROUTES } from "../cloudflare/routes"
import { isAbortError, ToolError } from "../errors"
import { ANY_TARGET } from "../targets"
import type { ToolContext } from "../tool"

export const ZONE_DESCRIPTION = "The zone domain or 32-hex id."

export const zoneArg = z.string().describe(ZONE_DESCRIPTION)

/** A zone as Cloudflare returns it (plain object). */
export type Zone = Record<string, unknown> & { id: string; name: string }

const HEX_ID_PATTERN = /^[0-9a-fA-F]{32}$/

function assertValidZone(zone: unknown): asserts zone is Zone {
  if (!isPlainObject(zone) || typeof zone.id !== "string" || typeof zone.name !== "string") {
    throw new ToolError("upstream_error", "Cloudflare returned a zone that is not an object with string id and name.")
  }
}

function assertZoneAccount(zone: Zone, client: CloudflareClient, ref: string): void {
  const account = isPlainObject(zone.account) ? zone.account : undefined
  const accountId = typeof account?.id === "string" ? account.id : undefined
  if (accountId !== client.accountId) {
    throw new ToolError("not_found", `Zone ${ref} is not in the Cloudflare account ${client.label}.`)
  }
}

/** Lowercase, trims a trailing dot, converts an IDN to punycode (node:url domainToASCII); must contain a dot; else invalid_argument. */
export function zoneName(ref: string): string {
  const lower = ref.toLowerCase()
  const trimmed = lower.endsWith(".") ? lower.slice(0, -1) : lower
  const ascii = domainToASCII(trimmed)
  if (!ascii || !ascii.includes(".")) {
    throw new ToolError("invalid_argument", `"${ref}" is not a valid zone name; must contain a dot.`)
  }
  return ascii
}

/** The zone `ref` names (its domain or 32-hex id), refused unless it belongs to the client's account. */
export async function resolveZone(client: CloudflareClient, ref: string): Promise<Zone> {
  if (HEX_ID_PATTERN.test(ref)) {
    const zoneId = ref.toLowerCase()
    const reply = await client.request<unknown>(ROUTES.zone, { path: { zone_id: zoneId } })
    assertValidZone(reply.result)
    assertZoneAccount(reply.result, client, ref)
    return reply.result
  }

  const domain = zoneName(ref)
  const reply = await client.request<unknown>(ROUTES.zones, {
    query: {
      name: domain,
      "account.id": client.accountId,
      per_page: 5,
    },
  })
  if (!Array.isArray(reply.result)) {
    throw new ToolError("upstream_error", "Cloudflare returned an unexpected response for zones listing.")
  }
  const match = reply.result.find((z) => isPlainObject(z) && z.name === domain)
  if (!match) {
    throw new ToolError(
      "not_found",
      `No zone ${domain} in the Cloudflare account ${client.label}; cloudflare_zone_read list shows its zones.`,
    )
  }
  assertValidZone(match)
  assertZoneAccount(match, client, ref)
  return match
}

/** Resolves the target `<account_id>/zones/<zone_id>` prefix for a zone. */
export async function resolveZoneTarget(
  args: { account?: string; zone: string },
  ctx: ToolContext,
  deps?: CloudflareDeps,
): Promise<string> {
  const client = cloudflareClient(args.account, { ...deps, signal: ctx.signal })
  const zone = await resolveZone(client, args.zone)
  return `${client.accountId}/zones/${zone.id}`
}

/** What a zone-scoped call writes to: `[<account_id>/zones/<zone_id>]`; `*` when that cannot be told. */
export async function zoneTargets(
  args: { account?: string; zone: string },
  ctx: ToolContext,
  deps?: CloudflareDeps,
): Promise<string[]> {
  try {
    const target = await resolveZoneTarget(args, ctx, deps)
    return [target]
  } catch (error) {
    if (isAbortError(error) || ctx.signal?.aborted) throw error
    return [ANY_TARGET]
  }
}
