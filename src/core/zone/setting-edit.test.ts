import { describe, expect, test } from "bun:test"
import { fail, ok } from "../cloudflare/testing"
import { rejection, toolError, ZONE_ID } from "../cloudflare/client.fixtures"
import { isAbortError } from "../errors"
import { invoke } from "../tool"
import {
  CTX,
  currentRoute,
  MODIFIED_ON,
  patchRoute,
  patches,
  setup,
  settingPath,
  ZONE_PATH,
  ZONE_ROUTE,
} from "./setting-edit.fixtures"

const OTHER_ACCOUNT_ID = "1".repeat(32)

describe("cloudflareZoneSettingEdit: applying", () => {
  test("reads every setting before it sends the first change, then sends them in order", async () => {
    const { edit, requests } = setup([
      ZONE_ROUTE,
      currentRoute("ssl", "flexible"),
      currentRoute("http3", "off"),
      patchRoute("ssl"),
      patchRoute("http3"),
    ])

    await invoke(
      edit,
      {
        zone: ZONE_ID,
        changes: [
          { setting: "ssl", value: "full" },
          { setting: "http3", value: "on" },
        ],
      },
      CTX,
    )

    expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      `GET ${ZONE_PATH}`,
      `GET ${settingPath("ssl")}`,
      `GET ${settingPath("http3")}`,
      `PATCH ${settingPath("ssl")}`,
      `PATCH ${settingPath("http3")}`,
    ])
    expect(requests.filter((request) => request.method === "PATCH").map((request) => request.body)).toEqual([
      { value: "full" },
      { value: "on" },
    ])
  })

  test("returns each change with the value before and what Cloudflare reports after", async () => {
    const { edit } = setup([
      ZONE_ROUTE,
      currentRoute("ssl", "flexible"),
      currentRoute("development_mode", "off"),
      patchRoute("ssl"),
      patchRoute("development_mode", (request) =>
        ok({ value: (request.body as { value: string }).value, modified_on: MODIFIED_ON, time_remaining: 10800 }),
      ),
    ])

    const result = await invoke(
      edit,
      {
        zone: ZONE_ID,
        changes: [
          { setting: "ssl", value: "full" },
          { setting: "development_mode", value: "on" },
        ],
      },
      CTX,
    )

    expect(result).toEqual({
      label: "default",
      zone: { id: ZONE_ID, name: "example.com" },
      changed: [
        { setting: "ssl", before: "flexible", after: "full", modified_on: MODIFIED_ON, time_remaining: null },
        {
          setting: "development_mode",
          before: "off",
          after: "on",
          modified_on: MODIFIED_ON,
          time_remaining: 10800,
        },
      ],
    })
  })

  test("sends browser_cache_ttl as a number, from a number or a numeric string", async () => {
    const { edit, requests } = setup([
      ZONE_ROUTE,
      currentRoute("browser_cache_ttl", 14400),
      patchRoute("browser_cache_ttl"),
    ])

    for (const value of ["3600", 7200]) {
      await invoke(edit, { zone: ZONE_ID, changes: [{ setting: "browser_cache_ttl", value }] }, CTX)
    }

    expect(requests.filter((request) => request.method === "PATCH").map((request) => request.body)).toEqual([
      { value: 3600 },
      { value: 7200 },
    ])
  })

  test("reports a missing reply value, time and date as null", async () => {
    const { edit } = setup([ZONE_ROUTE, currentRoute("ipv6", "off"), patchRoute("ipv6", ok({ id: "ipv6" }))])

    const result = await invoke(edit, { zone: ZONE_ID, changes: [{ setting: "ipv6", value: "on" }] }, CTX)

    expect(result.changed).toEqual([
      { setting: "ipv6", before: "off", after: null, modified_on: null, time_remaining: null },
    ])
  })
})

describe("cloudflareZoneSettingEdit: refusals before anything is sent", () => {
  test("refuses a setting the zone's plan does not let you change", async () => {
    const { edit, requests } = setup([
      ZONE_ROUTE,
      currentRoute("http3", "off"),
      currentRoute("always_online", "off", false),
      patchRoute("http3"),
    ])

    const error = await toolError(
      invoke(
        edit,
        {
          zone: ZONE_ID,
          changes: [
            { setting: "http3", value: "on" },
            { setting: "always_online", value: "on" },
          ],
        },
        CTX,
      ),
    )

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toBe("change 2 (always_online): cannot be changed on this zone's plan")
    expect(patches(requests)).toEqual([])
  })

  test("refuses a setting that is already at the value, comparing as text", async () => {
    const { edit, requests } = setup([
      ZONE_ROUTE,
      currentRoute("ssl", "full"),
      currentRoute("browser_cache_ttl", 3600),
      patchRoute("ssl"),
      patchRoute("browser_cache_ttl"),
    ])

    const error = await toolError(
      invoke(
        edit,
        {
          zone: ZONE_ID,
          changes: [
            { setting: "ssl", value: "full" },
            { setting: "browser_cache_ttl", value: "3600" },
          ],
        },
        CTX,
      ),
    )

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toBe("change 1 (ssl): is already full; change 2 (browser_cache_ttl): is already 3600")
    expect(patches(requests)).toEqual([])
  })

  test("refuses a zone of another account before it reads or sends anything else", async () => {
    const { edit, requests } = setup([
      {
        method: "GET",
        path: ZONE_PATH,
        reply: ok({ id: ZONE_ID, name: "example.com", account: { id: OTHER_ACCOUNT_ID } }),
      },
      currentRoute("ssl", "flexible"),
      patchRoute("ssl"),
    ])

    const error = await toolError(invoke(edit, { zone: ZONE_ID, changes: [{ setting: "ssl", value: "full" }] }, CTX))

    expect(error.code).toBe("not_found")
    expect(requests.map((request) => request.path)).toEqual([ZONE_PATH])
  })

  test("fails when a setting cannot be read, sending nothing", async () => {
    const { edit, requests } = setup([
      ZONE_ROUTE,
      currentRoute("ssl", "flexible"),
      { method: "GET", path: settingPath("http3"), reply: fail(500, [{ code: 9999, message: "boom" }]) },
      patchRoute("ssl"),
    ])

    const error = await toolError(
      invoke(
        edit,
        {
          zone: ZONE_ID,
          changes: [
            { setting: "ssl", value: "full" },
            { setting: "http3", value: "on" },
          ],
        },
        CTX,
      ),
    )

    expect(error.code).toBe("upstream_error")
    expect(patches(requests)).toEqual([])
  })
})

describe("cloudflareZoneSettingEdit: a change that fails", () => {
  const changes = [
    { setting: "ssl", value: "full" },
    { setting: "http3", value: "on" },
    { setting: "ipv6", value: "on" },
  ]
  const reads = [ZONE_ROUTE, currentRoute("ssl", "flexible"), currentRoute("http3", "off"), currentRoute("ipv6", "off")]
  const rejected = fail(400, [{ code: 1004, message: "Not allowed" }])

  test("the first one failing throws and sends nothing more", async () => {
    const { edit, requests } = setup([...reads, patchRoute("ssl", rejected), patchRoute("http3"), patchRoute("ipv6")])

    const error = await toolError(invoke(edit, { zone: ZONE_ID, changes }, CTX))

    expect(error.code).toBe("invalid_argument")
    expect(patches(requests)).toEqual(["ssl"])
  })

  test("a later one failing returns what changed, the failure and what was not sent", async () => {
    const { edit, requests } = setup([...reads, patchRoute("ssl"), patchRoute("http3", rejected), patchRoute("ipv6")])

    const result = await invoke(edit, { zone: ZONE_ID, changes }, CTX)

    expect(result.changed.map((change) => change.setting)).toEqual(["ssl"])
    expect(result.failed).toEqual({ setting: "http3", error: "invalid_argument: 1004: Not allowed" })
    expect(result.not_sent).toEqual(["ipv6"])
    expect(patches(requests)).toEqual(["ssl", "http3"])
  })

  test("the last one failing lists nothing as not sent", async () => {
    const { edit } = setup([...reads, patchRoute("ssl"), patchRoute("http3"), patchRoute("ipv6", rejected)])

    const result = await invoke(edit, { zone: ZONE_ID, changes }, CTX)

    expect(result.changed.map((change) => change.setting)).toEqual(["ssl", "http3"])
    expect(result.failed?.setting).toBe("ipv6")
    expect(result.not_sent).toEqual([])
  })

  test("a cancellation propagates instead of being reported", async () => {
    const controller = new AbortController()
    const { edit } = setup([
      ...reads,
      patchRoute("ssl"),
      patchRoute("http3", () => {
        controller.abort()
        return rejected
      }),
      patchRoute("ipv6"),
    ])

    const error = await rejection(invoke(edit, { zone: ZONE_ID, changes }, { ...CTX, signal: controller.signal }))

    expect(isAbortError(error)).toBe(true)
  })
})
