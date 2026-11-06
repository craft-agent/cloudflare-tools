import { describe, expect, test } from "bun:test"
import { ACCOUNT_ID, envFor, toolError, ZONE_ID } from "../cloudflare/client.fixtures"
import { fakeCloudflare, fail, ok, type FakeRoute } from "../cloudflare/testing"
import { annotations, invoke, REQUIRES_USER_INTERACTION, toolMeta, type ConfirmRequest } from "../tool"
import {
  cloudflareZoneDnssecDisable,
  cloudflareZoneDnssecEnable,
  defineZoneDnssecDisable,
  defineZoneDnssecEnable,
  DNSSEC_DISABLE_ID,
  DNSSEC_ENABLE_ID,
} from "./dnssec"
import { CTX, ZONE_PATH, ZONE_ROUTE } from "./fixtures"

const DNSSEC_PATH = `/zones/${ZONE_ID}/dnssec`
const SAMPLE_DS = "example.com. 3600 IN DS 2371 13 2 abcdef1234567890"

function setup(routes: FakeRoute[]) {
  const { fetch, requests } = fakeCloudflare(routes)
  const deps = { fetch, env: envFor() }
  return {
    enable: defineZoneDnssecEnable(deps),
    disable: defineZoneDnssecDisable(deps),
    requests,
  }
}

describe("cloudflareZoneDnssecEnable", () => {
  test("enables DNSSEC from disabled, sends PATCH body, returns ds and next_step", async () => {
    const { enable, requests } = setup([
      ZONE_ROUTE,
      { method: "GET", path: DNSSEC_PATH, reply: ok({ status: "disabled" }) },
      {
        method: "PATCH",
        path: DNSSEC_PATH,
        reply: ok({
          status: "pending",
          ds: SAMPLE_DS,
          digest: "abcdef",
          digest_type: "2",
          algorithm: "13",
          key_tag: 2371,
          flags: 257,
          public_key: "pubkey",
          modified_on: "2026-11-01T00:00:00Z",
        }),
      },
    ])

    const result = await invoke(enable, { zone: ZONE_ID }, CTX)
    expect(result).toEqual({
      label: "default",
      zone: { id: ZONE_ID, name: "example.com" },
      changed: true,
      dnssec: {
        status: "pending",
        ds: SAMPLE_DS,
        digest: "abcdef",
        digest_type: "2",
        algorithm: "13",
        key_tag: 2371,
        flags: 257,
        public_key: "pubkey",
        modified_on: "2026-11-01T00:00:00Z",
      },
      next_step: `Add the DS record (${SAMPLE_DS}) at the domain's registrar. DNSSEC stays pending until it is published there.`,
    })

    const patchReq = requests.find((r) => r.method === "PATCH" && r.path === DNSSEC_PATH)
    expect(patchReq?.body).toEqual({ status: "active" })
  })

  test("does not send PATCH when already active or pending", async () => {
    for (const status of ["active", "pending"]) {
      const { enable, requests } = setup([
        ZONE_ROUTE,
        { method: "GET", path: DNSSEC_PATH, reply: ok({ status, ds: SAMPLE_DS }) },
      ])
      const result = await invoke(enable, { zone: ZONE_ID }, CTX)
      expect(result.changed).toBe(false)
      expect(result.next_step).toBeNull()
      expect(result.dnssec.status).toBe(status)
      expect(requests.filter((r) => r.method === "PATCH")).toHaveLength(0)
    }
  })
})

describe("cloudflareZoneDnssecDisable", () => {
  test("disables DNSSEC with confirm accepted, sends PATCH body, returns next_step", async () => {
    const asked: ConfirmRequest[] = []
    const { disable, requests } = setup([
      ZONE_ROUTE,
      { method: "GET", path: DNSSEC_PATH, reply: ok({ status: "active", ds: SAMPLE_DS }) },
      {
        method: "PATCH",
        path: DNSSEC_PATH,
        reply: ok({ status: "disabled", ds: null, modified_on: "2026-11-02T00:00:00Z" }),
      },
    ])

    const result = await invoke(disable, { zone: ZONE_ID }, { ...CTX, confirm: async (req) => (asked.push(req), true) })

    expect(result).toEqual({
      label: "default",
      zone: { id: ZONE_ID, name: "example.com" },
      changed: true,
      dnssec: {
        status: "disabled",
        ds: null,
        digest: null,
        digest_type: null,
        algorithm: null,
        key_tag: null,
        flags: null,
        public_key: null,
        modified_on: "2026-11-02T00:00:00Z",
      },
      next_step:
        "Remove the DS record at the domain's registrar and wait for its TTL: while the registrar still publishes it, validating resolvers fail the whole zone.",
    })
    expect(asked).toHaveLength(1)
    expect(asked[0]!.tool).toBe(DNSSEC_DISABLE_ID)
    expect(asked[0]!.message).toBe(
      `Turn DNSSEC off for zone example.com (${ZONE_ID}) in the Cloudflare account default. Remove the DS record at the domain's registrar first and wait for its TTL: while the registrar still publishes it, validating resolvers fail the whole zone.`,
    )
    const patchReq = requests.find((r) => r.method === "PATCH" && r.path === DNSSEC_PATH)
    expect(patchReq?.body).toEqual({ status: "disabled" })
  })

  test("declined confirm throws declined and sends no PATCH", async () => {
    const { disable, requests } = setup([
      ZONE_ROUTE,
      { method: "GET", path: DNSSEC_PATH, reply: ok({ status: "active" }) },
    ])
    const error = await toolError(invoke(disable, { zone: ZONE_ID }, { ...CTX, confirm: async () => false }))
    expect(error.code).toBe("declined")
    expect(requests.filter((r) => r.method === "PATCH")).toHaveLength(0)
  })

  test("does not send PATCH or ask confirm when already disabled or pending-disabled", async () => {
    for (const status of ["disabled", "pending-disabled"]) {
      let confirmCalled = false
      const { disable, requests } = setup([ZONE_ROUTE, { method: "GET", path: DNSSEC_PATH, reply: ok({ status }) }])
      const result = await invoke(
        disable,
        { zone: ZONE_ID },
        { ...CTX, confirm: async () => ((confirmCalled = true), true) },
      )
      expect(result.changed).toBe(false)
      expect(result.next_step).toBeNull()
      expect(result.dnssec.status).toBe(status)
      expect(confirmCalled).toBe(false)
      expect(requests.filter((r) => r.method === "PATCH")).toHaveLength(0)
    }
  })
})

describe("DNSSEC tools: account boundary, targets, and annotations", () => {
  test("zone of another account throws not_found and sends nothing", async () => {
    const otherZone: FakeRoute = {
      method: "GET",
      path: ZONE_PATH,
      reply: ok({ id: ZONE_ID, name: "example.com", account: { id: "0".repeat(32) } }),
    }
    const { enable, disable, requests } = setup([otherZone])

    const enableErr = await toolError(invoke(enable, { zone: ZONE_ID }, CTX))
    expect(enableErr.code).toBe("not_found")
    const disableErr = await toolError(invoke(disable, { zone: ZONE_ID }, { ...CTX, confirm: async () => true }))
    expect(disableErr.code).toBe("not_found")
    expect(requests.filter((r) => r.path === DNSSEC_PATH)).toHaveLength(0)
  })

  test("resolves target to <account_id>/zones/<zone_id>, and * when not found", async () => {
    const { enable, disable } = setup([ZONE_ROUTE])
    expect(await enable.targets!({ zone: ZONE_ID }, CTX)).toEqual([`${ACCOUNT_ID}/zones/${ZONE_ID}`])
    expect(await disable.targets!({ zone: ZONE_ID }, CTX)).toEqual([`${ACCOUNT_ID}/zones/${ZONE_ID}`])

    const { enable: e404, disable: d404 } = setup([
      { method: "GET", path: ZONE_PATH, reply: fail(404, [{ code: 7003, message: "No" }]) },
    ])
    expect(await e404.targets!({ zone: ZONE_ID }, CTX)).toEqual(["*"])
    expect(await d404.targets!({ zone: ZONE_ID }, CTX)).toEqual(["*"])
  })

  test("annotations and toolMeta", () => {
    expect(annotations(cloudflareZoneDnssecEnable)).toEqual({
      title: "Enable DNSSEC for a Cloudflare zone",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    })
    expect(toolMeta(cloudflareZoneDnssecEnable)).toBeUndefined()
    expect(cloudflareZoneDnssecEnable.toolset).toBe("zones")

    expect(annotations(cloudflareZoneDnssecDisable)).toEqual({
      title: "Disable DNSSEC for a Cloudflare zone",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    })
    expect(toolMeta(cloudflareZoneDnssecDisable)).toEqual({ [REQUIRES_USER_INTERACTION]: true })
    expect(cloudflareZoneDnssecDisable.toolset).toBe("zones")
  })
})
