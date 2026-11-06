import { describe, expect, test } from "bun:test"
import { ACCOUNT_ID, clientFor, envFor, rejection, ZONE_ID } from "../cloudflare/client.fixtures"
import { fail, fakeCloudflare, ok } from "../cloudflare/testing"
import { isAbortError, isToolError } from "../errors"
import { CTX, OTHER_ACCOUNT_ID } from "./fixtures"
import { resolveZone, resolveZoneTarget, zoneName, zoneTargets } from "./lookup"

describe("zoneName", () => {
  test("lowercases and preserves plain domain", () => {
    expect(zoneName("EXAMPLE.COM")).toBe("example.com")
  })

  test("trims trailing dot", () => {
    expect(zoneName("example.com.")).toBe("example.com")
    expect(zoneName("SUB.EXAMPLE.COM.")).toBe("sub.example.com")
  })

  test("converts IDN to punycode", () => {
    expect(zoneName("münchen.de")).toBe("xn--mnchen-3ya.de")
    expect(zoneName("MÜNCHEN.DE.")).toBe("xn--mnchen-3ya.de")
  })

  test("refuses names without dot", async () => {
    for (const invalid of ["localhost", "example", "", ".", "example."]) {
      expect(() => zoneName(invalid)).toThrow()
      try {
        zoneName(invalid)
      } catch (error) {
        expect(isToolError(error) && error.code === "invalid_argument").toBe(true)
      }
    }
  })
})

describe("resolveZone: by 32-hex id", () => {
  test("resolves zone when account id matches", async () => {
    const { client, requests } = clientFor([
      {
        method: "GET",
        path: `/zones/${ZONE_ID}`,
        reply: ok({ id: ZONE_ID, name: "example.com", account: { id: ACCOUNT_ID, name: "Test" } }),
      },
    ])

    const zone = await resolveZone(client, ZONE_ID.toUpperCase())

    expect(requests).toHaveLength(1)
    expect(requests[0]!.path).toBe(`/zones/${ZONE_ID}`)
    expect(zone.id).toBe(ZONE_ID)
    expect(zone.name).toBe("example.com")
  })

  test("refuses zone if account id does not match", async () => {
    const { client } = clientFor([
      {
        method: "GET",
        path: `/zones/${ZONE_ID}`,
        reply: ok({ id: ZONE_ID, name: "example.com", account: { id: OTHER_ACCOUNT_ID } }),
      },
    ])

    const error = await rejection(resolveZone(client, ZONE_ID))

    expect(isToolError(error)).toBe(true)
    if (isToolError(error)) {
      expect(error.code).toBe("not_found")
      expect(error.message).toBe(`Zone ${ZONE_ID} is not in the Cloudflare account ${client.label}.`)
    }
  })

  test("fails with upstream_error if result is not a valid zone object", async () => {
    const { client } = clientFor([
      {
        method: "GET",
        path: `/zones/${ZONE_ID}`,
        reply: ok("not-an-object"),
      },
    ])

    const error = await rejection(resolveZone(client, ZONE_ID))

    expect(isToolError(error)).toBe(true)
    if (isToolError(error)) {
      expect(error.code).toBe("upstream_error")
    }
  })
})

describe("resolveZone: by domain name", () => {
  test("resolves zone by domain name when found in account", async () => {
    const { client, requests } = clientFor([
      {
        method: "GET",
        path: "/zones",
        reply: ok([
          { id: ZONE_ID, name: "example.com", account: { id: ACCOUNT_ID, name: "Test" } },
          { id: "other-id", name: "other.com", account: { id: ACCOUNT_ID } },
        ]),
      },
    ])

    const zone = await resolveZone(client, "EXAMPLE.COM.")

    expect(requests).toHaveLength(1)
    expect(requests[0]!.path).toBe("/zones")
    expect(requests[0]!.query.get("name")).toBe("example.com")
    expect(requests[0]!.query.get("account.id")).toBe(ACCOUNT_ID)
    expect(requests[0]!.query.get("per_page")).toBe("5")
    expect(zone.id).toBe(ZONE_ID)
    expect(zone.name).toBe("example.com")
  })

  test("throws not_found when no zone matches", async () => {
    const { client } = clientFor([
      {
        method: "GET",
        path: "/zones",
        reply: ok([]),
      },
    ])

    const error = await rejection(resolveZone(client, "missing.com"))

    expect(isToolError(error)).toBe(true)
    if (isToolError(error)) {
      expect(error.code).toBe("not_found")
      expect(error.message).toBe(
        `No zone missing.com in the Cloudflare account ${client.label}; cloudflare_zone_read list shows its zones.`,
      )
    }
  })

  test("refuses domain zone if account id on returned zone does not match", async () => {
    const { client } = clientFor([
      {
        method: "GET",
        path: "/zones",
        reply: ok([{ id: ZONE_ID, name: "example.com", account: { id: OTHER_ACCOUNT_ID } }]),
      },
    ])

    const error = await rejection(resolveZone(client, "example.com"))

    expect(isToolError(error)).toBe(true)
    if (isToolError(error)) {
      expect(error.code).toBe("not_found")
      expect(error.message).toBe(`Zone example.com is not in the Cloudflare account ${client.label}.`)
    }
  })

  test("fails with upstream_error if zones reply is not an array", async () => {
    const { client } = clientFor([
      {
        method: "GET",
        path: "/zones",
        reply: ok({ not: "an array" }),
      },
    ])

    const error = await rejection(resolveZone(client, "example.com"))

    expect(isToolError(error)).toBe(true)
    if (isToolError(error)) {
      expect(error.code).toBe("upstream_error")
    }
  })
})

describe("resolveZoneTarget and zoneTargets", () => {
  test("resolves zone target to <account_id>/zones/<zone_id>", async () => {
    const deps = {
      fetch: fakeCloudflare([
        {
          method: "GET",
          path: `/zones/${ZONE_ID}`,
          reply: ok({ id: ZONE_ID, name: "example.com", account: { id: ACCOUNT_ID } }),
        },
      ]).fetch,
      env: envFor(),
    }
    const target = await resolveZoneTarget({ zone: ZONE_ID }, CTX, deps)
    expect(target).toBe(`${ACCOUNT_ID}/zones/${ZONE_ID}`)

    const targets = await zoneTargets({ zone: ZONE_ID }, CTX, deps)
    expect(targets).toEqual([`${ACCOUNT_ID}/zones/${ZONE_ID}`])
  })

  test("zoneTargets yields * when zone resolution fails", async () => {
    const deps = {
      fetch: fakeCloudflare([
        { method: "GET", path: `/zones/${ZONE_ID}`, reply: fail(404, [{ code: 7003, message: "No" }]) },
      ]).fetch,
      env: envFor(),
    }
    const targets = await zoneTargets({ zone: ZONE_ID }, CTX, deps)
    expect(targets).toEqual(["*"])
  })

  test("zoneTargets rethrows when cancelled", async () => {
    const controller = new AbortController()
    controller.abort()
    const deps = { fetch: fakeCloudflare([]).fetch, env: envFor() }
    const error = await rejection(zoneTargets({ zone: ZONE_ID }, { ...CTX, signal: controller.signal }, deps))
    expect(isAbortError(error)).toBe(true)
  })
})
