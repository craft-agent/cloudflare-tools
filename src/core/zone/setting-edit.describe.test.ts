import { describe, expect, test } from "bun:test"
import { toolError, ZONE_ID } from "../cloudflare/client.fixtures"
import { callDescription } from "../describe"
import type { ConfirmRequest } from "../tool"
import { CTX, currentRoute, patchRoute, patches, setup, ZONE_ROUTE } from "./setting-edit.fixtures"

const routes = [
  ZONE_ROUTE,
  currentRoute("ssl", "full"),
  currentRoute("tls_1_3", "on"),
  currentRoute("http3", "on"),
  currentRoute("always_use_https", "off"),
  patchRoute("ssl"),
  patchRoute("tls_1_3"),
  patchRoute("http3"),
  patchRoute("always_use_https"),
]

const LOWER_SSL = { zone: ZONE_ID, changes: [{ setting: "ssl", value: "flexible" }] }
const RAISE_HTTPS = { zone: ZONE_ID, changes: [{ setting: "always_use_https", value: "on" }] }
const SEVERAL = {
  zone: ZONE_ID,
  changes: [
    { setting: "http3", value: "off" },
    { setting: "ssl", value: "flexible" },
    { setting: "always_use_https", value: "on" },
    { setting: "tls_1_3", value: "off" },
  ],
}
const BODY = "http3: on → off\nssl: full → flexible\nalways_use_https: off → on\ntls_1_3: on → off"
const RAISING = { zone: ZONE_ID, changes: [{ setting: "ssl", value: "strict" }, SEVERAL.changes[0]!] }

describe("cloudflareZoneSettingEdit: describe", () => {
  test("states its intent", () => {
    expect(setup([]).edit.intent).toBe("About to change zone settings")
  })

  test("names the setting and zone for one change, with the change as text and no facts", async () => {
    const { edit, requests } = setup(routes)

    const description = await edit.describe!(edit.input.parse(RAISE_HTTPS), CTX)

    expect(description).toEqual({
      headline: {
        text: "About to change the setting {setting} of {zone}",
        values: { setting: "always_use_https", zone: "example.com" },
      },
      facts: [],
      text: { label: "Changes", body: "always_use_https: off → on" },
    })
    expect(patches(requests)).toEqual([])
  })

  test("names the zone for several changes, one line each in order", async () => {
    const { edit } = setup(routes)

    const description = await edit.describe!(edit.input.parse(RAISING), CTX)

    expect(description).toEqual({
      headline: { text: "About to change settings of {zone}", values: { zone: "example.com" } },
      facts: [],
      text: { label: "Changes", body: "ssl: full → strict\nhttp3: on → off" },
    })
  })

  test("throws where execute would refuse because a change lowers protection, and sends nothing", async () => {
    const { edit, requests } = setup(routes)

    const error = await toolError(Promise.resolve(edit.describe!(edit.input.parse(LOWER_SSL), CTX)))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("ssl: full → flexible")
    expect(await callDescription(edit, LOWER_SSL, CTX)).toBeUndefined()
    expect(patches(requests)).toEqual([])
  })

  test("throws for a setting already at the value, and for one the plan does not allow", async () => {
    const { edit } = setup([ZONE_ROUTE, currentRoute("http3", "off"), currentRoute("ssl", "full", false)])

    const same = { zone: ZONE_ID, changes: [{ setting: "http3", value: "off" }] }
    const fixed = { zone: ZONE_ID, changes: [{ setting: "ssl", value: "strict" }] }

    expect((await toolError(Promise.resolve(edit.describe!(edit.input.parse(same), CTX)))).message).toContain(
      "is already off",
    )
    expect((await toolError(Promise.resolve(edit.describe!(edit.input.parse(fixed), CTX)))).message).toContain(
      "cannot be changed",
    )
  })

  test("is accepted by the description check and gives the same answer twice", async () => {
    const { edit } = setup(routes)

    const first = await callDescription(edit, RAISING, CTX)

    expect(first).toBeDefined()
    expect(await callDescription(edit, RAISING, CTX)).toEqual(first)
  })
})

describe("cloudflareZoneSettingWeaken: describe", () => {
  /** A context whose confirmation records what it was asked. */
  function confirming() {
    const asked: ConfirmRequest[] = []
    return {
      asked,
      ctx: {
        ...CTX,
        confirm: async (request: ConfirmRequest) => {
          asked.push(request)
          return true
        },
      },
    }
  }

  test("states its intent", () => {
    expect(setup([]).weaken.intent).toBe("About to lower zone protection")
  })

  test("says lower for one lowering change, and never asks or sends", async () => {
    const { weaken, requests } = setup(routes)
    const { asked, ctx } = confirming()

    const description = await weaken.describe!(weaken.input.parse(LOWER_SSL), ctx)

    expect(description).toEqual({
      headline: {
        text: "About to lower the setting {setting} of {zone}",
        values: { setting: "ssl", zone: "example.com" },
      },
      facts: [],
      text: { label: "Changes", body: "ssl: full → flexible" },
    })
    expect(asked).toEqual([])
    expect(patches(requests)).toEqual([])
  })

  test("says change for one change that does not lower", async () => {
    const { weaken } = setup(routes)

    const description = await weaken.describe!(weaken.input.parse(RAISE_HTTPS), CTX)

    expect(description.headline!.text).toBe("About to change the setting {setting} of {zone}")
  })

  test("says lower and lists the lowering settings for several changes of which some lower", async () => {
    const { weaken } = setup(routes)

    const description = await weaken.describe!(weaken.input.parse(SEVERAL), CTX)

    expect(description).toEqual({
      headline: { text: "About to lower the protection of {zone}", values: { zone: "example.com" } },
      facts: [{ label: "Lowered", value: "ssl, tls_1_3" }],
      text: { label: "Changes", body: BODY },
    })
  })

  test("says change, with no facts, for several changes of which none lower", async () => {
    const { weaken } = setup(routes)

    const description = await weaken.describe!(weaken.input.parse(RAISING), CTX)

    expect(description.headline).toEqual({
      text: "About to change settings of {zone}",
      values: { zone: "example.com" },
    })
    expect(description.facts).toEqual([])
  })

  test("throws for a setting already at the value, and sends nothing", async () => {
    const { weaken, requests } = setup([ZONE_ROUTE, currentRoute("ssl", "flexible"), patchRoute("ssl")])

    const error = await toolError(Promise.resolve(weaken.describe!(weaken.input.parse(LOWER_SSL), CTX)))

    expect(error.message).toContain("is already flexible")
    expect(patches(requests)).toEqual([])
  })

  test("is accepted by the description check and gives the same answer twice", async () => {
    const { weaken } = setup(routes)

    const first = await callDescription(weaken, SEVERAL, CTX)

    expect(first).toBeDefined()
    expect(await callDescription(weaken, SEVERAL, CTX)).toEqual(first)
  })
})
