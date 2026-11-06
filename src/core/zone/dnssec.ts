import { z } from "zod"
import { accountArg } from "../cloudflare/args"
import { cloudflareClient, type CloudflareDeps } from "../cloudflare/client"
import { ROUTES } from "../cloudflare/routes"
import { confirmWrite, defineTool, type ToolSpec } from "../tool"
import { resolveZone, zoneArg, zoneTargets } from "./lookup"
import { dnssecSchema, shapeDnssec, type Dnssec } from "./ssl"

export const DNSSEC_ENABLE_ID = "cloudflare_zone_dnssec_enable"
export const DNSSEC_DISABLE_ID = "cloudflare_zone_dnssec_disable"

const input = z.object({
  account: accountArg,
  zone: zoneArg,
})

const output = z.object({
  label: z.string().describe("The account label."),
  zone: z.object({ id: z.string(), name: z.string() }).describe("The zone."),
  changed: z.boolean().describe("Whether DNSSEC settings were changed."),
  dnssec: dnssecSchema,
  next_step: z.string().nullable().describe("Instructions for registrar action, or null if unchanged."),
})

export type ZoneDnssecEnableSpec = ToolSpec<typeof input, typeof output>
export type ZoneDnssecDisableSpec = ToolSpec<typeof input, typeof output>

function enableNextStep(dnssec: Dnssec): string {
  return dnssec.ds
    ? `Add the DS record (${dnssec.ds}) at the domain's registrar. DNSSEC stays pending until it is published there.`
    : "Add the DS record at the domain's registrar. DNSSEC stays pending until it is published there."
}

const DISABLE_NEXT_STEP =
  "Remove the DS record at the domain's registrar and wait for its TTL: while the registrar still publishes it, validating resolvers fail the whole zone."

/** What a DNSSEC call writes to: `<account_id>/zones/<zone_id>`; `*` when that cannot be told. */
export const dnssecTargets = zoneTargets

/** Defines the `cloudflare_zone_dnssec_enable` tool spec with injected dependencies. */
export function defineZoneDnssecEnable(deps?: CloudflareDeps): ZoneDnssecEnableSpec {
  return defineTool({
    id: DNSSEC_ENABLE_ID,
    title: "Enable DNSSEC for a Cloudflare zone",
    description: "Turn DNSSEC on for a zone; harmless until the registrar publishes the DS record it returns.",
    toolset: "zones",
    class: "idempotent",
    input,
    output,
    targets: (args, ctx) => zoneTargets(args, ctx, deps),
    async execute(args, ctx) {
      const client = cloudflareClient(args.account, { ...deps, signal: ctx.signal })
      const zone = await resolveZone(client, args.zone)

      const currentReply = await client.request<unknown>(ROUTES.dnssec, { path: { zone_id: zone.id } })
      const currentDnssec = shapeDnssec(currentReply.result)

      if (currentDnssec.status === "active" || currentDnssec.status === "pending") {
        return {
          label: client.label,
          zone: { id: zone.id, name: zone.name },
          changed: false,
          dnssec: currentDnssec,
          next_step: null,
        }
      }

      const patchReply = await client.request<unknown>(ROUTES.dnssecEdit, {
        path: { zone_id: zone.id },
        body: { status: "active" },
      })
      const newDnssec = shapeDnssec(patchReply.result)

      return {
        label: client.label,
        zone: { id: zone.id, name: zone.name },
        changed: true,
        dnssec: newDnssec,
        next_step: enableNextStep(newDnssec),
      }
    },
  })
}

export const cloudflareZoneDnssecEnable = defineZoneDnssecEnable()

/** Defines the `cloudflare_zone_dnssec_disable` tool spec with injected dependencies. */
export function defineZoneDnssecDisable(deps?: CloudflareDeps): ZoneDnssecDisableSpec {
  const spec: ZoneDnssecDisableSpec = defineTool({
    id: DNSSEC_DISABLE_ID,
    title: "Disable DNSSEC for a Cloudflare zone",
    description:
      "Turn DNSSEC off for a zone. Remove the DS record at the domain's registrar first and wait for its TTL: while the registrar still publishes it, validating resolvers fail the whole zone. Nothing here can check the registrar.",
    toolset: "zones",
    class: "administrative",
    input,
    output,
    targets: (args, ctx) => zoneTargets(args, ctx, deps),
    async execute(args, ctx) {
      const client = cloudflareClient(args.account, { ...deps, signal: ctx.signal })
      const zone = await resolveZone(client, args.zone)

      const currentReply = await client.request<unknown>(ROUTES.dnssec, { path: { zone_id: zone.id } })
      const currentDnssec = shapeDnssec(currentReply.result)

      if (currentDnssec.status === "disabled" || currentDnssec.status === "pending-disabled") {
        return {
          label: client.label,
          zone: { id: zone.id, name: zone.name },
          changed: false,
          dnssec: currentDnssec,
          next_step: null,
        }
      }

      await confirmWrite(
        spec,
        ctx,
        `Turn DNSSEC off for zone ${zone.name} (${zone.id}) in the Cloudflare account ${client.label}. Remove the DS record at the domain's registrar first and wait for its TTL: while the registrar still publishes it, validating resolvers fail the whole zone.`,
      )

      const patchReply = await client.request<unknown>(ROUTES.dnssecEdit, {
        path: { zone_id: zone.id },
        body: { status: "disabled" },
      })
      const newDnssec = shapeDnssec(patchReply.result)

      return {
        label: client.label,
        zone: { id: zone.id, name: zone.name },
        changed: true,
        dnssec: newDnssec,
        next_step: DISABLE_NEXT_STEP,
      }
    },
  })
  return spec
}

export const cloudflareZoneDnssecDisable = defineZoneDnssecDisable()
