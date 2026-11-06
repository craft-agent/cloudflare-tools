import { describe, expect, test } from "bun:test"
import { toolError, ZONE_ID } from "../cloudflare/client.fixtures"
import type { FakeRoute } from "../cloudflare/testing"
import { annotations, invoke, toolMeta, REQUIRES_USER_INTERACTION, type ConfirmRequest } from "../tool"
import { cloudflareZoneSettingEdit, cloudflareZoneSettingWeaken } from "./setting-edit"
import { CTX, currentRoute, patchRoute, patches, setup, ZONE_ROUTE } from "./setting-edit.fixtures"
import { ZONE_SETTINGS } from "./settings"
import { SETTING_VALUES } from "./values"

const LOWER_SSL = { zone: ZONE_ID, changes: [{ setting: "ssl", value: "flexible" }] }
const lowerSslRoutes: FakeRoute[] = [ZONE_ROUTE, currentRoute("ssl", "full"), patchRoute("ssl")]

describe("cloudflareZoneSettingEdit: protection", () => {
  test("refuses a change that lowers protection, names it and points to the weaken tool", async () => {
    const { edit, requests } = setup([
      ZONE_ROUTE,
      currentRoute("ssl", "full"),
      currentRoute("tls_1_3", "on"),
      currentRoute("http3", "on"),
      patchRoute("ssl"),
      patchRoute("tls_1_3"),
      patchRoute("http3"),
    ])

    const error = await toolError(
      invoke(
        edit,
        {
          zone: ZONE_ID,
          changes: [
            { setting: "http3", value: "off" },
            { setting: "ssl", value: "flexible" },
            { setting: "tls_1_3", value: "off" },
          ],
        },
        CTX,
      ),
    )

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("ssl: full → flexible; tls_1_3: on → off")
    expect(error.message).not.toContain("http3")
    expect(error.message).toContain("cloudflare_zone_setting_weaken")
    expect(patches(requests)).toEqual([])
  })

  test("refuses lowering from a value it does not know to the lowest one", async () => {
    const { edit, requests } = setup([ZONE_ROUTE, currentRoute("ssl", "origin_pull"), patchRoute("ssl")])

    const error = await toolError(invoke(edit, { zone: ZONE_ID, changes: [{ setting: "ssl", value: "off" }] }, CTX))

    expect(error.message).toContain("ssl: origin_pull → off")
    expect(patches(requests)).toEqual([])
  })

  test("applies a change that raises protection and never asks", async () => {
    const asked: ConfirmRequest[] = []
    const { edit, requests } = setup([
      ZONE_ROUTE,
      currentRoute("ssl", "flexible"),
      currentRoute("always_use_https", "off"),
      patchRoute("ssl"),
      patchRoute("always_use_https"),
    ])
    const confirm = async (request: ConfirmRequest) => (asked.push(request), false)

    const result = await invoke(
      edit,
      {
        zone: ZONE_ID,
        changes: [
          { setting: "ssl", value: "strict" },
          { setting: "always_use_https", value: "on" },
        ],
      },
      { ...CTX, confirm },
    )

    expect(result.changed.map((change) => change.setting)).toEqual(["ssl", "always_use_https"])
    expect(patches(requests)).toEqual(["ssl", "always_use_https"])
    expect(asked).toEqual([])
  })
})

describe("cloudflareZoneSettingWeaken", () => {
  test("applies a change that lowers protection", async () => {
    const { weaken, requests } = setup(lowerSslRoutes)

    const result = await invoke(weaken, LOWER_SSL, CTX)

    expect(result.changed).toEqual([expect.objectContaining({ setting: "ssl", before: "full", after: "flexible" })])
    expect(patches(requests)).toEqual(["ssl"])
  })

  test("asks first, naming the zone and each change", async () => {
    const asked: ConfirmRequest[] = []
    const { weaken, requests } = setup(lowerSslRoutes)

    await invoke(weaken, LOWER_SSL, {
      ...CTX,
      confirm: async (request) => (asked.push(request), true),
    })

    expect(asked).toHaveLength(1)
    expect(asked[0]!.tool).toBe("cloudflare_zone_setting_weaken")
    expect(asked[0]!.message).toContain("example.com")
    expect(asked[0]!.message).toContain("ssl: full → flexible")
    expect(patches(requests)).toEqual(["ssl"])
  })

  test("a declined confirmation throws `declined` and sends nothing", async () => {
    const { weaken, requests } = setup(lowerSslRoutes)

    const error = await toolError(invoke(weaken, LOWER_SSL, { ...CTX, confirm: async () => false }))

    expect(error.code).toBe("declined")
    expect(patches(requests)).toEqual([])
  })

  test("also accepts a change that raises protection", async () => {
    const asked: ConfirmRequest[] = []
    const { weaken, requests } = setup([ZONE_ROUTE, currentRoute("ssl", "flexible"), patchRoute("ssl")])

    await invoke(
      weaken,
      { zone: ZONE_ID, changes: [{ setting: "ssl", value: "strict" }] },
      { ...CTX, confirm: async (request) => (asked.push(request), true) },
    )

    expect(asked).toHaveLength(1)
    expect(patches(requests)).toEqual(["ssl"])
  })

  test("still refuses a setting that is already at the value or cannot be changed", async () => {
    const { weaken, requests } = setup([
      ZONE_ROUTE,
      currentRoute("ssl", "flexible"),
      currentRoute("http3", "on", false),
      patchRoute("ssl"),
      patchRoute("http3"),
    ])

    const error = await toolError(
      invoke(
        weaken,
        {
          zone: ZONE_ID,
          changes: [
            { setting: "ssl", value: "flexible" },
            { setting: "http3", value: "off" },
          ],
        },
        CTX,
      ),
    )

    expect(error.message).toBe(
      "change 1 (ssl): is already flexible; change 2 (http3): cannot be changed on this zone's plan",
    )
    expect(patches(requests)).toEqual([])
  })

  test("applies every setting in the order given", async () => {
    const { weaken, requests } = setup([
      ZONE_ROUTE,
      ...ZONE_SETTINGS.flatMap((setting) => [currentRoute(setting, SETTING_VALUES[setting][1]), patchRoute(setting)]),
    ])
    const order = [...ZONE_SETTINGS].reverse()

    const result = await invoke(
      weaken,
      { zone: ZONE_ID, changes: order.map((setting) => ({ setting, value: SETTING_VALUES[setting][0] })) },
      CTX,
    )

    expect(result.changed.map((change) => change.setting)).toEqual(order)
    expect(patches(requests)).toEqual(order)
  })
})

describe("zone setting tools: class", () => {
  test("the edit tool overwrites", () => {
    expect(annotations(cloudflareZoneSettingEdit)).toEqual({
      title: "Edit Cloudflare zone settings",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    })
    expect(toolMeta(cloudflareZoneSettingEdit)).toBeUndefined()
  })

  test("the weaken tool is administrative and requires user interaction", () => {
    expect(annotations(cloudflareZoneSettingWeaken)).toEqual({
      title: "Lower Cloudflare zone protection",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    })
    expect(toolMeta(cloudflareZoneSettingWeaken)).toEqual({ [REQUIRES_USER_INTERACTION]: true })
  })

  test("both belong to the zones toolset", () => {
    expect(cloudflareZoneSettingEdit.toolset).toBe("zones")
    expect(cloudflareZoneSettingWeaken.toolset).toBe("zones")
  })
})
