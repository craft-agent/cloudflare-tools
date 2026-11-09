import type { CloudflareDeps } from "../cloudflare/client"
import { defineSettingChangeTool, SETTING_EDIT_ID, SETTING_WEAKEN_ID, type SettingChangeSpec } from "./setting-change"

/** Defines the `cloudflare_zone_setting_edit` tool spec with injected dependencies. */
export function defineZoneSettingEdit(deps?: CloudflareDeps): SettingChangeSpec {
  return defineSettingChangeTool(
    {
      id: SETTING_EDIT_ID,
      title: "Edit Cloudflare zone settings",
      intent: "About to change zone settings",
      description: [
        "Change 1 to 20 settings of a Cloudflare zone, in order.",
        "Every setting is read first, and nothing is sent if any change is refused:",
        "a value the setting does not accept, a setting that is already at the value,",
        "a setting the zone's plan does not let you change,",
        "or a change that lowers protection (a lower step of ssl, min_tls_version or security_level,",
        `or turning off always_use_https, automatic_https_rewrites, tls_1_3 or email_obfuscation); use ${SETTING_WEAKEN_ID} for those.`,
        "If a later change fails, the result lists what was changed, the failure and the settings not sent.",
        "Zones are looked up only in the account's own zones.",
      ].join(" "),
      weakens: false,
    },
    deps,
  )
}

/** Defines the `cloudflare_zone_setting_weaken` tool spec with injected dependencies. */
export function defineZoneSettingWeaken(deps?: CloudflareDeps): SettingChangeSpec {
  return defineSettingChangeTool(
    {
      id: SETTING_WEAKEN_ID,
      title: "Lower Cloudflare zone protection",
      intent: "About to lower zone protection",
      description: [
        "Change 1 to 20 settings of a Cloudflare zone, in order, where a change lowers a visitor's protection:",
        "a lower step of ssl, min_tls_version or security_level,",
        "or turning off always_use_https, automatic_https_rewrites, tls_1_3 or email_obfuscation.",
        "Always confirmed. Every setting is read first, and nothing is sent if a value is not accepted,",
        "a setting is already at the value, or the zone's plan does not let you change it.",
        "If a later change fails, the result lists what was changed, the failure and the settings not sent.",
        "Zones are looked up only in the account's own zones.",
      ].join(" "),
      weakens: true,
    },
    deps,
  )
}

export const cloudflareZoneSettingEdit = defineZoneSettingEdit()

export const cloudflareZoneSettingWeaken = defineZoneSettingWeaken()
