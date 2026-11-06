import { describe, expect, test } from "bun:test"
import { ACCOUNT_ID, envFor, rejection, verifyRoute, VERIFY_USER_PATH, ZONE_ID } from "../cloudflare/client.fixtures"
import { fail, fakeCloudflare, ok } from "../cloudflare/testing"
import { isToolError } from "../errors"
import { invoke } from "../tool"
import { CTX, OTHER_ACCOUNT_ID, ZONE_ROUTE } from "./fixtures"
import { defineZoneRead } from "./read"
import { ZONE_SETTINGS } from "./settings"

describe("cloudflareZoneRead: settings", () => {
  test("reads single setting for zone", async () => {
    const { fetch, requests } = fakeCloudflare([
      ZONE_ROUTE,
      {
        method: "GET",
        path: `/zones/${ZONE_ID}/settings/ssl`,
        reply: ok({
          id: "ssl",
          value: "strict",
          editable: true,
          modified_on: "2024-01-01T00:00:00Z",
        }),
      },
    ])
    const tool = defineZoneRead({ fetch, env: envFor() })

    const result = await invoke(tool, { method: "settings", zone: ZONE_ID, setting: "ssl" }, CTX)

    expect(requests).toHaveLength(2)
    expect(requests[0]!.path).toBe(`/zones/${ZONE_ID}`)
    expect(requests[1]!.path).toBe(`/zones/${ZONE_ID}/settings/ssl`)
    expect(result).toEqual({
      label: "default",
      zone: { id: ZONE_ID, name: "example.com" },
      settings: {
        ssl: {
          value: "strict",
          editable: true,
          modified_on: "2024-01-01T00:00:00Z",
          time_remaining: null,
        },
      },
      unavailable: {},
    })
  })

  test("reads all 14 settings and captures forbidden/not_found in unavailable", async () => {
    const settingRoutes = ZONE_SETTINGS.map((setting) => {
      if (setting === "development_mode") {
        return {
          method: "GET" as const,
          path: `/zones/${ZONE_ID}/settings/${setting}`,
          reply: ok({
            id: setting,
            value: "on",
            editable: true,
            modified_on: "2024-01-01T00:00:00Z",
            time_remaining: 10800,
          }),
        }
      }
      if (setting === "always_online") {
        return {
          method: "GET" as const,
          path: `/zones/${ZONE_ID}/settings/${setting}`,
          reply: fail(403, [{ code: 10000, message: "Not permitted" }]),
        }
      }
      if (setting === "email_obfuscation") {
        return {
          method: "GET" as const,
          path: `/zones/${ZONE_ID}/settings/${setting}`,
          reply: fail(404, [{ code: 7003, message: "Setting not found" }]),
        }
      }
      if (setting === "cache_level") {
        return {
          method: "GET" as const,
          path: `/zones/${ZONE_ID}/settings/${setting}`,
          reply: fail(400, [{ code: 1004, message: "Invalid setting parameter" }]),
        }
      }
      return {
        method: "GET" as const,
        path: `/zones/${ZONE_ID}/settings/${setting}`,
        reply: ok({
          id: setting,
          value: "on",
          editable: true,
          modified_on: null,
        }),
      }
    })

    const { fetch, requests } = fakeCloudflare([verifyRoute(VERIFY_USER_PATH, "active"), ZONE_ROUTE, ...settingRoutes])
    const tool = defineZoneRead({ fetch, env: envFor() })

    const result = await invoke(tool, { method: "settings", zone: ZONE_ID }, CTX)

    expect(requests).toHaveLength(16) // 1 zone lookup + 14 settings + 1 token verify triggered by 403
    expect(result.label).toBe("default")
    expect(result.zone).toEqual({ id: ZONE_ID, name: "example.com" })
    expect(result.settings).toBeDefined()
    expect(result.settings!.development_mode).toEqual({
      value: "on",
      editable: true,
      modified_on: "2024-01-01T00:00:00Z",
      time_remaining: 10800,
    })
    expect(result.settings!.always_online).toBeUndefined()
    expect(result.settings!.email_obfuscation).toBeUndefined()
    expect(result.settings!.cache_level).toBeUndefined()
    expect(result.unavailable).toEqual({
      always_online: "forbidden: 10000: Not permitted (the token is active but lacks a permission this call needs)",
      email_obfuscation: "not_found: 7003: Setting not found",
      cache_level: "invalid_argument: 1004: Invalid setting parameter",
    })
    expect(Object.keys(result.settings!)).toHaveLength(11)
  })

  test("propagates unexpected errors (e.g. 500) during settings fetch", async () => {
    const { fetch } = fakeCloudflare([
      ZONE_ROUTE,
      {
        method: "GET",
        path: `/zones/${ZONE_ID}/settings/ssl`,
        reply: fail(500, [{ code: 9999, message: "Internal server error" }]),
      },
    ])
    const tool = defineZoneRead({ fetch, env: envFor() })

    const error = await rejection(invoke(tool, { method: "settings", zone: ZONE_ID, setting: "ssl" }, CTX))
    expect(isToolError(error) && error.code === "upstream_error").toBe(true)
  })

  test("refuses zone in another account", async () => {
    const { fetch } = fakeCloudflare([
      {
        method: "GET",
        path: `/zones/${ZONE_ID}`,
        reply: ok({ id: ZONE_ID, name: "example.com", account: { id: OTHER_ACCOUNT_ID } }),
      },
    ])
    const tool = defineZoneRead({ fetch, env: envFor() })

    const error = await rejection(invoke(tool, { method: "settings", zone: ZONE_ID }, CTX))
    expect(isToolError(error) && error.code === "not_found").toBe(true)
    if (isToolError(error)) {
      expect(error.message).toBe(`Zone ${ZONE_ID} is not in the Cloudflare account default.`)
    }
  })
})
