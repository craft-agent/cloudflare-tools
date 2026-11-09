import { z } from "zod"
import { accountArg } from "../cloudflare/args"
import { cloudflareClient, type CloudflareDeps } from "../cloudflare/client"
import { ROUTES } from "../cloudflare/routes"
import { confirmWrite, defineTool, type CallDescription, type CallFact, type ToolContext, type ToolSpec } from "../tool"
import { resolveZone, zoneArg, zoneTargets } from "./lookup"
import { dnssecSchema, shapeDnssec, type Dnssec } from "./ssl"
import { ZONE_WORDS } from "./words"

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

const ENABLE_SETTLED: readonly Dnssec["status"][] = ["active", "pending"]
const DISABLE_SETTLED: readonly Dnssec["status"][] = ["disabled", "pending-disabled"]

/** What a DNSSEC call writes to: `<account_id>/zones/<zone_id>`; `*` when that cannot be told. */
export const dnssecTargets = zoneTargets

/** What a call will do: the client, the zone it resolved, DNSSEC as it is now, and whether the call changes it (its status is not one of `settled`). */
async function planDnssec(
  args: z.output<typeof input>,
  ctx: ToolContext,
  settled: readonly Dnssec["status"][],
  deps?: CloudflareDeps,
) {
  const client = cloudflareClient(args.account, { ...deps, signal: ctx.signal })
  const zone = await resolveZone(client, args.zone)

  const currentReply = await client.request<unknown>(ROUTES.dnssec, { path: { zone_id: zone.id } })
  const currentDnssec = shapeDnssec(currentReply.result)
  return { client, zone, currentDnssec, willChange: !settled.includes(currentDnssec.status) }
}

/** The description of a DNSSEC call: the current status and, when the call changes it, the step it leaves to the person. */
async function describeDnssec(
  headline: string,
  step: CallFact,
  args: z.output<typeof input>,
  ctx: ToolContext,
  settled: readonly Dnssec["status"][],
  deps?: CloudflareDeps,
): Promise<CallDescription> {
  const { zone, currentDnssec, willChange } = await planDnssec(args, ctx, settled, deps)
  return {
    headline: { text: headline, values: { zone: zone.name } },
    facts: [
      ...(currentDnssec.status !== null ? [{ label: ZONE_WORDS.status, value: currentDnssec.status }] : []),
      ...(willChange ? [step] : []),
    ],
  }
}

/** Defines the `cloudflare_zone_dnssec_enable` tool spec with injected dependencies. */
export function defineZoneDnssecEnable(deps?: CloudflareDeps): ZoneDnssecEnableSpec {
  return defineTool({
    id: DNSSEC_ENABLE_ID,
    title: "Enable DNSSEC for a Cloudflare zone",
    intent: "About to turn on DNSSEC",
    description: "Turn DNSSEC on for a zone; harmless until the registrar publishes the DS record it returns.",
    toolset: "zones",
    class: "idempotent",
    input,
    output,
    targets: (args, ctx) => zoneTargets(args, ctx, deps),
    describe: (args, ctx) =>
      describeDnssec(
        ZONE_WORDS.dnssecOn,
        { label: ZONE_WORDS.nextStep, value: { text: ZONE_WORDS.nextStepDs } },
        args,
        ctx,
        ENABLE_SETTLED,
        deps,
      ),
    async execute(args, ctx) {
      const { client, zone, currentDnssec, willChange } = await planDnssec(args, ctx, ENABLE_SETTLED, deps)

      if (!willChange) {
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
    intent: "About to turn off DNSSEC",
    description:
      "Turn DNSSEC off for a zone. Remove the DS record at the domain's registrar first and wait for its TTL: while the registrar still publishes it, validating resolvers fail the whole zone. Nothing here can check the registrar.",
    toolset: "zones",
    class: "administrative",
    input,
    output,
    targets: (args, ctx) => zoneTargets(args, ctx, deps),
    describe: (args, ctx) =>
      describeDnssec(
        ZONE_WORDS.dnssecOff,
        { label: ZONE_WORDS.registrar, value: { text: ZONE_WORDS.registrarDs } },
        args,
        ctx,
        DISABLE_SETTLED,
        deps,
      ),
    async execute(args, ctx) {
      const { client, zone, currentDnssec, willChange } = await planDnssec(args, ctx, DISABLE_SETTLED, deps)

      if (!willChange) {
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
