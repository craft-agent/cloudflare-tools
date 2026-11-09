import type { CloudflareClient } from "../cloudflare/client"
import { isPlainObject } from "../cloudflare/reply"
import { ROUTES } from "../cloudflare/routes"
import { isToolError } from "../errors"
import { scanListing, withHint } from "./rule.checks"
import { shapeRule } from "./shape"

/** What a forbidden read of a zone's rules gains when the call must tell whether a rule forwards to an address. */
const USAGE_READ_HINT =
  "The token needs Zone → Email Routing Rules → Read in every zone of the account to tell whether a rule forwards to the address."

/** What a forbidden listing of the account's zones gains. */
const ZONES_READ_HINT = "The token needs Zone → Zone → Read to list the account's zones."

/** The `rule` of a use that is the zone's catch-all. */
export const CATCH_ALL_USE = "catch_all"

/** One rule or catch-all that forwards to an address: its zone, its id (or `catch_all`) and the address it matches, when it has one. */
export type ForwardUse = { zone: string; rule: string; to: string | null }

/** Where the account forwards to an address: the number of zones checked and every use found. */
type ForwardUsage = { zones: number; uses: ForwardUse[] }

type ZoneRef = { id: string; name: string }

function shapeZone(raw: unknown): ZoneRef | undefined {
  if (!isPlainObject(raw) || typeof raw.id !== "string" || typeof raw.name !== "string") return undefined
  return { id: raw.id, name: raw.name }
}

/** Whether any action of the raw rule forwards to `wanted` (lowercase); a rule of any shape counts. */
function holdsForward(raw: Record<string, unknown>, wanted: string): boolean {
  if (!Array.isArray(raw.actions)) return false
  return raw.actions.some(
    (action) =>
      isPlainObject(action) &&
      action.type === "forward" &&
      Array.isArray(action.value) &&
      action.value.some((value) => typeof value === "string" && value.toLowerCase() === wanted),
  )
}

/** Whether a raw rule matches every address, as the catch-all does; Cloudflare lists the catch-all among the rules. */
function matchesAll(raw: Record<string, unknown>): boolean {
  return Array.isArray(raw.matchers) && raw.matchers.some((matcher) => isPlainObject(matcher) && matcher.type === "all")
}

/** The use a raw rule of `zone` is, when it forwards to `wanted`; a rule that matches every address is the catch-all. */
function useOf(raw: unknown, wanted: string, zone: string): ForwardUse | undefined {
  if (!isPlainObject(raw) || !holdsForward(raw, wanted)) return undefined
  if (matchesAll(raw)) return { zone, rule: CATCH_ALL_USE, to: null }
  const rule = shapeRule(raw)
  return { zone, rule: rule?.id ?? "unknown", to: rule?.to ?? null }
}

async function listZones(client: CloudflareClient): Promise<ZoneRef[]> {
  const zones: ZoneRef[] = []
  await scanListing(
    client,
    {
      route: ROUTES.zones,
      query: { "account.id": client.accountId },
      hint: ZONES_READ_HINT,
      what: "zones",
      owner: "The account",
      shape: shapeZone,
    },
    (rows) => {
      zones.push(...rows)
      return false
    },
  )
  return zones
}

async function rulesForwardingTo(client: CloudflareClient, zone: ZoneRef, wanted: string): Promise<ForwardUse[]> {
  const uses: ForwardUse[] = []
  await scanListing(
    client,
    {
      route: ROUTES.emailRoutingRules,
      path: { zone_id: zone.id },
      hint: USAGE_READ_HINT,
      what: "routing rules",
      owner: "The zone",
      shape: (raw) => useOf(raw, wanted, zone.name),
    },
    (rows) => {
      uses.push(...rows)
      return false
    },
  )
  return uses
}

/** The zone's catch-all as a use, when it forwards to `wanted`; a zone without a catch-all (`not_found`) has none. */
async function catchAllForwardingTo(
  client: CloudflareClient,
  zone: ZoneRef,
  wanted: string,
): Promise<ForwardUse | undefined> {
  try {
    const { result } = await client.request<unknown>(ROUTES.emailRoutingCatchAll, { path: { zone_id: zone.id } })
    return isPlainObject(result) && holdsForward(result, wanted)
      ? { zone: zone.name, rule: CATCH_ALL_USE, to: null }
      : undefined
  } catch (error) {
    if (!isToolError(error)) throw error
    if (error.code === "not_found") return undefined
    throw withHint(error, USAGE_READ_HINT)
  }
}

/**
 * Where the account forwards to `email`: every rule and catch-all of every zone of the account that has a forward
 * action holding it, without regard to case. The raw rules are scanned, so a rule of a shape these tools do not change
 * counts too, and so does the catch-all, once, whether the rules list it or only its own read shows it. Zones are read
 * one after another, each with at most five pages of rules.
 */
export async function forwardsTo(client: CloudflareClient, email: string): Promise<ForwardUsage> {
  const wanted = email.toLowerCase()
  const zones = await listZones(client)
  const uses: ForwardUse[] = []
  for (const zone of zones) {
    const ofRules = await rulesForwardingTo(client, zone, wanted)
    uses.push(...ofRules)
    // The rules include the catch-all, so it counts once when both reads show it.
    const catchAll = await catchAllForwardingTo(client, zone, wanted)
    if (catchAll && !ofRules.some((use) => use.rule === CATCH_ALL_USE)) uses.push(catchAll)
  }
  return { zones: zones.length, uses }
}
