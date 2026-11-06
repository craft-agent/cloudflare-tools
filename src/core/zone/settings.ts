import { z } from "zod"
import { cloudflareClient, type CloudflareDeps } from "../cloudflare/client"
import { isPlainObject } from "../cloudflare/reply"
import { ROUTES } from "../cloudflare/routes"
import { isToolError } from "../errors"
import type { ToolContext } from "../tool"
import { resolveZone } from "./lookup"

export const ZONE_SETTINGS = [
  "ssl",
  "always_use_https",
  "min_tls_version",
  "tls_1_3",
  "automatic_https_rewrites",
  "http3",
  "ipv6",
  "websockets",
  "development_mode",
  "security_level",
  "cache_level",
  "browser_cache_ttl",
  "always_online",
  "email_obfuscation",
] as const

export type ZoneSetting = (typeof ZONE_SETTINGS)[number]

export const settingItemSchema = z.object({
  value: z.unknown().nullable().describe("The setting value, or null."),
  editable: z.boolean().nullable().describe("Whether this setting can be modified, or null."),
  modified_on: z.string().nullable().describe("When the setting was last modified, or null."),
  time_remaining: z.number().nullable().describe("Time remaining for temporary settings, or null."),
})

export type SettingItem = z.infer<typeof settingItemSchema>

/** A setting as Cloudflare returns it; a field that is missing or of the wrong type reads as null. */
export function settingItem(result: unknown): SettingItem {
  const raw = isPlainObject(result) ? result : {}
  return {
    value: raw.value !== undefined ? raw.value : null,
    editable: typeof raw.editable === "boolean" ? raw.editable : null,
    modified_on: typeof raw.modified_on === "string" ? raw.modified_on : null,
    time_remaining: typeof raw.time_remaining === "number" ? raw.time_remaining : null,
  }
}

export type SettingsArgs = {
  account?: string
  zone: string
  setting?: ZoneSetting
}

export type SettingsOutput = {
  label: string
  zone: { id: string; name: string }
  settings: Record<string, SettingItem>
  unavailable: Record<string, string>
}

/** Reads one or all 14 zone settings, capturing unavailable settings into `unavailable`. */
export async function readSettings(
  args: SettingsArgs,
  ctx: ToolContext,
  deps?: CloudflareDeps,
): Promise<SettingsOutput> {
  const client = cloudflareClient(args.account, { ...deps, signal: ctx.signal })
  const zone = await resolveZone(client, args.zone)

  const targetSettings: readonly ZoneSetting[] = args.setting ? [args.setting] : ZONE_SETTINGS

  const settings: Record<string, SettingItem> = {}
  const unavailable: Record<string, string> = {}

  await Promise.all(
    targetSettings.map(async (settingId) => {
      try {
        const reply = await client.request<Record<string, unknown>>(ROUTES.zoneSetting, {
          path: { zone_id: zone.id, setting_id: settingId },
        })
        settings[settingId] = settingItem(reply.result)
      } catch (error) {
        if (
          isToolError(error) &&
          (error.code === "forbidden" || error.code === "not_found" || error.code === "invalid_argument")
        ) {
          unavailable[settingId] = `${error.code}: ${error.message}`
        } else {
          throw error
        }
      }
    }),
  )

  return {
    label: client.label,
    zone: { id: zone.id, name: zone.name },
    settings,
    unavailable,
  }
}
