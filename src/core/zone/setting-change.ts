import { z } from "zod"
import { accountArg } from "../cloudflare/args"
import { cloudflareClient, type CloudflareClient, type CloudflareDeps } from "../cloudflare/client"
import { ROUTES } from "../cloudflare/routes"
import { ToolError, isAbortError } from "../errors"
import { ANY_TARGET } from "../targets"
import { confirmWrite, defineTool, StepErrors, type ToolContext, type ToolSpec } from "../tool"
import { resolveZone, resolveZoneTarget, zoneArg, type Zone } from "./lookup"
import { settingItem, settingItemSchema, ZONE_SETTINGS, type ZoneSetting } from "./settings"
import { lowersProtection, parseSettingValue, SETTING_VALUES } from "./values"

export const SETTING_EDIT_ID = "cloudflare_zone_setting_edit"
export const SETTING_WEAKEN_ID = "cloudflare_zone_setting_weaken"

const MAX_CHANGES = 20

const allowedValues = Object.entries(SETTING_VALUES)
  .map(([setting, values]) => `${setting}: ${values.join("|")}`)
  .join("; ")

const input = z.object({
  account: accountArg,
  zone: zoneArg,
  changes: z
    .array(
      z
        .object({
          setting: z.enum(ZONE_SETTINGS).describe("The setting to change."),
          value: z
            .union([z.string(), z.number()])
            .describe("The new value; browser_cache_ttl takes seconds (0 respects the origin's headers)."),
        })
        .strict(),
    )
    .min(1)
    .max(MAX_CHANGES)
    .describe(
      `1 to ${MAX_CHANGES} changes, each setting at most once, applied in order. Allowed values: ${allowedValues}.`,
    ),
})

const output = z.object({
  label: z.string().describe("The account label."),
  zone: z.object({ id: z.string(), name: z.string() }).describe("The zone the settings belong to."),
  changed: z
    .array(
      z.object({
        setting: z.enum(ZONE_SETTINGS).describe("The setting that was changed."),
        before: settingItemSchema.shape.value.describe("The value before the change."),
        after: settingItemSchema.shape.value.describe("The value Cloudflare reports after the change, or null."),
        modified_on: settingItemSchema.shape.modified_on,
        time_remaining: settingItemSchema.shape.time_remaining,
      }),
    )
    .describe("The changes that were applied, in order."),
  failed: z
    .object({
      setting: z.enum(ZONE_SETTINGS).describe("The setting whose change failed."),
      error: z.string().describe("The error code and message."),
    })
    .optional()
    .describe("The change that failed after earlier ones were applied; the rest were not sent."),
  not_sent: z
    .array(z.enum(ZONE_SETTINGS))
    .optional()
    .describe("The settings after the failed one, which were not sent."),
})

/** The spec of both setting tools: they share their arguments and result. */
export type SettingChangeSpec = ToolSpec<typeof input, typeof output>

/** What distinguishes the two tools that change settings. */
export type SettingChangeVariant = {
  id: string
  title: string
  description: string
  /** Whether the tool may lower protection, and then always asks first; otherwise it refuses such a change. */
  weakens: boolean
}

type RequestedChange = { setting: ZoneSetting; value: string | number }
type PlannedChange = RequestedChange & { before: unknown }

function writeClass(variant: SettingChangeVariant): "overwrite" | "administrative" {
  return variant.weakens ? "administrative" : "overwrite"
}

function changeLabel(index: number, setting: ZoneSetting): string {
  return `change ${index + 1} (${setting})`
}

function describeChange(change: PlannedChange): string {
  return `${change.setting}: ${String(change.before)} → ${String(change.value)}`
}

function parseChanges(changes: z.output<typeof input>["changes"]): RequestedChange[] {
  const problems: string[] = []
  const requested: RequestedChange[] = []
  const seen = new Set<ZoneSetting>()
  for (const [index, change] of changes.entries()) {
    const label = changeLabel(index, change.setting)
    if (seen.has(change.setting)) problems.push(`${label}: the setting is listed more than once`)
    seen.add(change.setting)
    const parsed = parseSettingValue(change.setting, change.value)
    if ("problem" in parsed) problems.push(`${label}: ${parsed.problem}`)
    else requested.push({ setting: change.setting, value: parsed.value })
  }
  if (problems.length > 0) throw new ToolError("invalid_argument", problems.join("; "))
  return requested
}

/** Reads every setting before anything is sent, and refuses a change that cannot be made or changes nothing. */
async function planChanges(
  client: CloudflareClient,
  zone: Zone,
  requested: RequestedChange[],
): Promise<PlannedChange[]> {
  const items = await Promise.all(
    requested.map(async ({ setting }) => {
      const reply = await client.request<unknown>(ROUTES.zoneSetting, {
        path: { zone_id: zone.id, setting_id: setting },
      })
      return settingItem(reply.result)
    }),
  )

  const problems: string[] = []
  const plan = requested.map((change, index): PlannedChange => {
    const item = items[index]!
    const label = changeLabel(index, change.setting)
    if (item.editable === false) problems.push(`${label}: cannot be changed on this zone's plan`)
    else if (String(item.value) === String(change.value)) problems.push(`${label}: is already ${String(change.value)}`)
    return { ...change, before: item.value }
  })
  if (problems.length > 0) throw new ToolError("invalid_argument", problems.join("; "))
  return plan
}

async function applyChange(client: CloudflareClient, zone: Zone, change: PlannedChange) {
  const reply = await client.request<unknown>(ROUTES.zoneSettingEdit, {
    path: { zone_id: zone.id, setting_id: change.setting },
    body: { value: change.value },
  })
  const item = settingItem(reply.result)
  return {
    setting: change.setting,
    before: change.before,
    after: item.value,
    modified_on: item.modified_on,
    time_remaining: item.time_remaining,
  }
}

async function changeSettings(
  variant: SettingChangeVariant,
  args: z.output<typeof input>,
  ctx: ToolContext,
  deps?: CloudflareDeps,
): Promise<z.input<typeof output>> {
  const requested = parseChanges(args.changes)
  const client = cloudflareClient(args.account, { ...deps, signal: ctx.signal })
  const zone = await resolveZone(client, args.zone)
  const plan = await planChanges(client, zone, requested)

  if (variant.weakens) {
    const message = `Change settings of zone ${zone.name} (${zone.id}) in the Cloudflare account ${client.label}: ${plan.map(describeChange).join("; ")}`
    await confirmWrite({ id: variant.id, class: writeClass(variant) }, ctx, message)
  } else {
    const lowering = plan.filter((change) => lowersProtection(change.setting, change.before, change.value))
    if (lowering.length > 0) {
      throw new ToolError(
        "invalid_argument",
        `These changes lower protection: ${lowering.map(describeChange).join("; ")}. Nothing was sent; use ${SETTING_WEAKEN_ID} for them.`,
      )
    }
  }

  const steps = new StepErrors()
  const changed: Awaited<ReturnType<typeof applyChange>>[] = []
  for (const [index, change] of plan.entries()) {
    // The first change failing changed nothing, so it throws; later ones are reported with what was applied.
    const applied =
      index === 0
        ? await applyChange(client, zone, change)
        : await steps.record(change.setting, () => applyChange(client, zone, change))
    if (applied === undefined) {
      return {
        label: client.label,
        zone: { id: zone.id, name: zone.name },
        changed,
        failed: { setting: change.setting, error: steps.errors[change.setting]! },
        not_sent: plan.slice(index + 1).map((rest) => rest.setting),
      }
    }
    changed.push(applied)
  }
  return { label: client.label, zone: { id: zone.id, name: zone.name }, changed }
}

/** What a call writes to: each setting of the zone, in the account the credential names; `*` when that cannot be told. */
async function settingTargets(args: z.output<typeof input>, ctx: ToolContext, deps?: CloudflareDeps) {
  try {
    const base = await resolveZoneTarget(args, ctx, deps)
    return args.changes.map((change) => `${base}/settings/${change.setting}`)
  } catch (error) {
    if (isAbortError(error) || ctx.signal?.aborted) throw error
    return [ANY_TARGET]
  }
}

/** Defines a tool that changes zone settings; `variant` says whether it may lower protection. */
export function defineSettingChangeTool(variant: SettingChangeVariant, deps?: CloudflareDeps): SettingChangeSpec {
  return defineTool({
    id: variant.id,
    title: variant.title,
    description: variant.description,
    toolset: "zones",
    class: writeClass(variant),
    input,
    output,
    targets: (args, ctx) => settingTargets(args, ctx, deps),
    execute: (args, ctx) => changeSettings(variant, args, ctx, deps),
  })
}
