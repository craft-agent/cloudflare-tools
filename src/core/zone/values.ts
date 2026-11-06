import type { ZoneSetting } from "./settings"

const ON_OFF = ["on", "off"] as const
const NUMERIC_PATTERN = /^\d+$/

/** The settings whose values are ordered, each from the least to the most protective value. */
export const PROTECTION_SCALES = {
  ssl: ["off", "flexible", "full", "strict"],
  min_tls_version: ["1.0", "1.1", "1.2", "1.3"],
  security_level: ["off", "essentially_off", "low", "medium", "high", "under_attack"],
} as const

/** The on/off settings whose `off` lowers protection. */
export const PROTECTION_SWITCHES = [
  "always_use_https",
  "automatic_https_rewrites",
  "tls_1_3",
  "email_obfuscation",
] as const

/** The values each setting accepts; `browser_cache_ttl` takes seconds as a number, every other setting a string. */
export const SETTING_VALUES = {
  ssl: PROTECTION_SCALES.ssl,
  always_use_https: ON_OFF,
  min_tls_version: PROTECTION_SCALES.min_tls_version,
  tls_1_3: ["on", "off", "zrt"],
  automatic_https_rewrites: ON_OFF,
  http3: ON_OFF,
  ipv6: ON_OFF,
  websockets: ON_OFF,
  development_mode: ON_OFF,
  security_level: PROTECTION_SCALES.security_level,
  cache_level: ["basic", "simplified", "aggressive"],
  browser_cache_ttl: [
    0, 30, 60, 120, 300, 1200, 1800, 3600, 7200, 10800, 14400, 18000, 28800, 43200, 57600, 72000, 86400, 172800, 259200,
    345600, 432000, 691200, 1382400, 2073600, 2678400, 5356800, 16070400, 31536000,
  ],
  always_online: ON_OFF,
  email_obfuscation: ON_OFF,
} as const satisfies Record<ZoneSetting, readonly (string | number)[]>

/** A value as the setting takes it, or what is wrong with it. */
export type ParsedValue = { value: string | number } | { problem: string }

/**
 * Checks `value` against what the setting accepts. `browser_cache_ttl` takes a
 * number or a numeric string and yields a number; every other setting takes
 * one of its strings.
 */
export function parseSettingValue(setting: ZoneSetting, value: string | number): ParsedValue {
  const allowed: readonly (string | number)[] = SETTING_VALUES[setting]
  const candidate =
    setting === "browser_cache_ttl" && typeof value === "string" && NUMERIC_PATTERN.test(value) ? Number(value) : value
  if (!allowed.includes(candidate)) {
    return { problem: `${JSON.stringify(value)} is not accepted; use one of ${allowed.join(", ")}` }
  }
  return { value: candidate }
}

function scaleOf(setting: ZoneSetting): readonly string[] | undefined {
  return Object.hasOwn(PROTECTION_SCALES, setting)
    ? PROTECTION_SCALES[setting as keyof typeof PROTECTION_SCALES]
    : undefined
}

/**
 * Whether changing `setting` from `current` to `next` lowers a visitor's
 * protection: `next` is lower on the setting's scale, or a protective switch
 * goes off. A current value the scale does not list counts as lowered only
 * when `next` is the scale's lowest value.
 */
export function lowersProtection(setting: ZoneSetting, current: unknown, next: string | number): boolean {
  const scale = scaleOf(setting)
  if (scale) {
    const from = scale.indexOf(String(current))
    const to = scale.indexOf(String(next))
    return from === -1 ? to === 0 : to !== -1 && to < from
  }
  return (
    (PROTECTION_SWITCHES as readonly string[]).includes(setting) && String(next) === "off" && String(current) !== "off"
  )
}
