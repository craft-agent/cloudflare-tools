import { describe, expect, test } from "bun:test"
import { ZONE_SETTINGS } from "./settings"
import { lowersProtection, parseSettingValue, PROTECTION_SCALES, PROTECTION_SWITCHES, SETTING_VALUES } from "./values"

describe("parseSettingValue", () => {
  test("accepts every listed value of every setting", () => {
    for (const setting of ZONE_SETTINGS) {
      for (const value of SETTING_VALUES[setting]) {
        expect(parseSettingValue(setting, value)).toEqual({ value })
      }
    }
  })

  test("refuses a string a setting does not list, naming the allowed ones", () => {
    expect(parseSettingValue("ssl", "none")).toEqual({
      problem: '"none" is not accepted; use one of off, flexible, full, strict',
    })
    expect(parseSettingValue("tls_1_3", "true")).toHaveProperty("problem")
    expect(parseSettingValue("http3", "ON")).toHaveProperty("problem")
  })

  test("refuses a number for a setting that takes strings", () => {
    expect(parseSettingValue("min_tls_version", 1.2)).toHaveProperty("problem")
    expect(parseSettingValue("ipv6", 1)).toHaveProperty("problem")
  })

  test("browser_cache_ttl takes a listed number or numeric string and yields a number", () => {
    expect(parseSettingValue("browser_cache_ttl", 3600)).toEqual({ value: 3600 })
    expect(parseSettingValue("browser_cache_ttl", "3600")).toEqual({ value: 3600 })
    expect(parseSettingValue("browser_cache_ttl", "0")).toEqual({ value: 0 })
  })

  test("browser_cache_ttl refuses an unlisted number and a non-numeric string", () => {
    expect(parseSettingValue("browser_cache_ttl", 45)).toHaveProperty("problem")
    expect(parseSettingValue("browser_cache_ttl", "45")).toHaveProperty("problem")
    expect(parseSettingValue("browser_cache_ttl", "1h")).toHaveProperty("problem")
    expect(parseSettingValue("browser_cache_ttl", "-30")).toHaveProperty("problem")
    expect(parseSettingValue("browser_cache_ttl", "")).toHaveProperty("problem")
  })
})

describe("lowersProtection", () => {
  test("a step down a scale lowers protection, a step up or no step does not", () => {
    for (const [setting, scale] of Object.entries(PROTECTION_SCALES)) {
      for (const [from, current] of scale.entries()) {
        for (const [to, next] of scale.entries()) {
          expect(lowersProtection(setting as keyof typeof PROTECTION_SCALES, current, next)).toBe(to < from)
        }
      }
    }
  })

  test("a current value off the scale counts as lowering only when the next is the lowest", () => {
    expect(lowersProtection("ssl", "origin_pull", "off")).toBe(true)
    expect(lowersProtection("ssl", "origin_pull", "strict")).toBe(false)
    expect(lowersProtection("min_tls_version", null, "1.0")).toBe(true)
    expect(lowersProtection("min_tls_version", undefined, "1.3")).toBe(false)
    expect(lowersProtection("security_level", 3, "off")).toBe(true)
    expect(lowersProtection("security_level", "unknown", "essentially_off")).toBe(false)
  })

  test("turning a protective switch off lowers protection", () => {
    for (const setting of PROTECTION_SWITCHES) {
      expect(lowersProtection(setting, "on", "off")).toBe(true)
      expect(lowersProtection(setting, "off", "off")).toBe(false)
      expect(lowersProtection(setting, "off", "on")).toBe(false)
      expect(lowersProtection(setting, "unknown", "off")).toBe(true)
    }
    expect(lowersProtection("tls_1_3", "zrt", "off")).toBe(true)
    expect(lowersProtection("tls_1_3", "on", "zrt")).toBe(false)
  })

  test("a setting with neither a scale nor a switch never lowers protection", () => {
    expect(lowersProtection("http3", "on", "off")).toBe(false)
    expect(lowersProtection("development_mode", "off", "on")).toBe(false)
    expect(lowersProtection("cache_level", "aggressive", "basic")).toBe(false)
    expect(lowersProtection("browser_cache_ttl", 31536000, 0)).toBe(false)
  })
})
