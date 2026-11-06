import { describe, expect, test } from "bun:test"
import { rejection, ZONE_ID } from "../cloudflare/client.fixtures"
import { isToolError } from "../errors"
import { invoke } from "../tool"
import { CTX, setup } from "./setting-edit.fixtures"

/** Both tools refuse `args` as `invalid_argument` before sending anything; returns the edit tool's message. */
async function refusal(args: unknown): Promise<string> {
  const { edit, weaken, requests } = setup([])
  const messages = await Promise.all(
    [edit, weaken].map(async (tool) => {
      const error = await rejection(invoke(tool, args, CTX))
      if (!isToolError(error) || error.code !== "invalid_argument") throw error
      return error.message
    }),
  )
  expect(requests).toEqual([])
  return messages[0]!
}

describe("zone setting tools: argument validation", () => {
  test("refuses a value the setting does not list, naming the change", async () => {
    const message = await refusal({ zone: ZONE_ID, changes: [{ setting: "ssl", value: "none" }] })
    expect(message).toBe('change 1 (ssl): "none" is not accepted; use one of off, flexible, full, strict')
  })

  test("numbers every change and reports all that are wrong", async () => {
    const message = await refusal({
      zone: ZONE_ID,
      changes: [
        { setting: "http3", value: "on" },
        { setting: "min_tls_version", value: 1.2 },
        { setting: "browser_cache_ttl", value: 45 },
      ],
    })
    expect(message).toContain("change 2 (min_tls_version):")
    expect(message).toContain("change 3 (browser_cache_ttl):")
    expect(message).not.toContain("change 1")
  })

  test("refuses a boolean value", async () => {
    await refusal({ zone: ZONE_ID, changes: [{ setting: "http3", value: true }] })
  })

  test("refuses an unknown setting and an unknown key of a change", async () => {
    await refusal({ zone: ZONE_ID, changes: [{ setting: "waf", value: "on" }] })
    await refusal({ zone: ZONE_ID, changes: [{ setting: "http3", value: "on", extra: 1 }] })
  })

  test("refuses a setting listed twice", async () => {
    const message = await refusal({
      zone: ZONE_ID,
      changes: [
        { setting: "ssl", value: "full" },
        { setting: "ssl", value: "strict" },
      ],
    })
    expect(message).toBe("change 2 (ssl): the setting is listed more than once")
  })

  test("takes at least one and at most 20 changes", async () => {
    await refusal({ zone: ZONE_ID, changes: [] })
    await refusal({ zone: ZONE_ID, changes: Array.from({ length: 21 }, () => ({ setting: "ipv6", value: "on" })) })
  })

  test("needs a zone and refuses an unknown argument", async () => {
    await refusal({ changes: [{ setting: "ipv6", value: "on" }] })
    await refusal({ zone: ZONE_ID, changes: [{ setting: "ipv6", value: "on" }], dry_run: true })
  })
})
