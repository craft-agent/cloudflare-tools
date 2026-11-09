import { describe, expect, test } from "bun:test"
import { envFor, toolError, ZONE_ID } from "../cloudflare/client.fixtures"
import { fakeCloudflare, ok, type FakeRoute } from "../cloudflare/testing"
import { callDescription } from "../describe"
import type { ConfirmRequest } from "../tool"
import { defineZoneDnssecDisable, defineZoneDnssecEnable } from "./dnssec"
import { CTX, ZONE_ROUTE } from "./fixtures"

const DNSSEC_PATH = `/zones/${ZONE_ID}/dnssec`

/** Both tools wired to a fake Cloudflare whose DNSSEC reads `status`. */
function setup(status: string, extra: FakeRoute[] = []) {
  const { fetch, requests } = fakeCloudflare([
    ZONE_ROUTE,
    { method: "GET", path: DNSSEC_PATH, reply: ok({ status }) },
    { method: "PATCH", path: DNSSEC_PATH, reply: ok({ status: "pending" }) },
    ...extra,
  ])
  const deps = { fetch, env: envFor() }
  return { enable: defineZoneDnssecEnable(deps), disable: defineZoneDnssecDisable(deps), requests }
}

const writes = (requests: { method: string }[]) => requests.filter((request) => request.method === "PATCH")

describe("cloudflareZoneDnssecEnable: describe", () => {
  test("states its intent", () => {
    expect(setup("disabled").enable.intent).toBe("About to turn on DNSSEC")
  })

  test("names the zone, the status and the registrar step when it will change", async () => {
    const { enable, requests } = setup("disabled")

    const description = await enable.describe!(enable.input.parse({ zone: ZONE_ID }), CTX)

    expect(description).toEqual({
      headline: { text: "About to turn on DNSSEC for {zone}", values: { zone: "example.com" } },
      facts: [
        { label: "Status", value: "disabled" },
        { label: "Next step", value: { text: "add the DS record at the domain's registrar" } },
      ],
    })
    expect(writes(requests)).toEqual([])
  })

  test("shows only the status when DNSSEC is already on", async () => {
    for (const status of ["active", "pending"]) {
      const { enable } = setup(status)

      const description = await enable.describe!(enable.input.parse({ zone: ZONE_ID }), CTX)

      expect(description.facts).toEqual([{ label: "Status", value: status }])
    }
  })

  test("is accepted by the description check and gives the same answer twice", async () => {
    const { enable } = setup("disabled")

    const first = await callDescription(enable, { zone: ZONE_ID }, CTX)

    expect(first).toBeDefined()
    expect(await callDescription(enable, { zone: ZONE_ID }, CTX)).toEqual(first)
  })

  test("throws when the status cannot be read", async () => {
    const { fetch } = fakeCloudflare([ZONE_ROUTE])
    const enable = defineZoneDnssecEnable({ fetch, env: envFor() })

    const error = await toolError(Promise.resolve(enable.describe!(enable.input.parse({ zone: ZONE_ID }), CTX)))

    expect(error.code).toBeDefined()
  })
})

describe("cloudflareZoneDnssecDisable: describe", () => {
  test("states its intent", () => {
    expect(setup("active").disable.intent).toBe("About to turn off DNSSEC")
  })

  test("names the zone, the status and the registrar warning when it will change, and never asks", async () => {
    for (const status of ["active", "pending"]) {
      const { disable, requests } = setup(status)
      const asked: ConfirmRequest[] = []
      const ctx = {
        ...CTX,
        confirm: async (request: ConfirmRequest) => {
          asked.push(request)
          return true
        },
      }

      const description = await disable.describe!(disable.input.parse({ zone: ZONE_ID }), ctx)

      expect(description).toEqual({
        headline: { text: "About to turn off DNSSEC for {zone}", values: { zone: "example.com" } },
        facts: [
          { label: "Status", value: status },
          { label: "Registrar", value: { text: "remove the DS record there first and wait for its TTL" } },
        ],
      })
      expect(asked).toEqual([])
      expect(writes(requests)).toEqual([])
    }
  })

  test("shows only the status when DNSSEC is already off", async () => {
    for (const status of ["disabled", "pending-disabled"]) {
      const { disable } = setup(status)

      const description = await disable.describe!(disable.input.parse({ zone: ZONE_ID }), CTX)

      expect(description.facts).toEqual([{ label: "Status", value: status }])
    }
  })

  test("is accepted by the description check and gives the same answer twice", async () => {
    const { disable } = setup("active")

    const first = await callDescription(disable, { zone: ZONE_ID }, CTX)

    expect(first).toBeDefined()
    expect(await callDescription(disable, { zone: ZONE_ID }, CTX)).toEqual(first)
  })
})
