import { describe, expect, test } from "bun:test"
import { ACCOUNT_ID, envFor, rejection, ZONE_ID } from "../cloudflare/client.fixtures"
import { fakeCloudflare, ok } from "../cloudflare/testing"
import { isToolError } from "../errors"
import { invoke } from "../tool"
import { CTX, OTHER_ACCOUNT_ID, ZONE_ROUTE } from "./fixtures"
import { defineZoneRead } from "./read"

describe("cloudflareZoneRead: ssl", () => {
  test("reads universal ssl and certificate packs with pagination", async () => {
    const { fetch, requests } = fakeCloudflare([
      ZONE_ROUTE,
      {
        method: "GET",
        path: `/zones/${ZONE_ID}/ssl/universal/settings`,
        reply: ok({ enabled: true }),
      },
      {
        method: "GET",
        path: `/zones/${ZONE_ID}/ssl/certificate_packs`,
        reply: ok(
          [
            {
              id: "pack-1",
              type: "universal",
              hosts: ["example.com", "*.example.com"],
              status: "active",
              certificate_authority: "lets_encrypt",
              validation_method: "txt",
              certificates: [
                {
                  id: "cert-1",
                  hosts: ["example.com", "*.example.com"],
                  status: "active",
                  expires_on: "2025-01-01T00:00:00Z",
                },
              ],
            },
          ],
          { page: 1, total_count: 1, total_pages: 1 },
        ),
      },
    ])
    const tool = defineZoneRead({ fetch, env: envFor() })

    const result = await invoke(tool, { method: "ssl", zone: ZONE_ID, page: 1 }, CTX)

    expect(requests).toHaveLength(3)
    expect(requests[0]!.path).toBe(`/zones/${ZONE_ID}`)
    expect(requests[1]!.path).toBe(`/zones/${ZONE_ID}/ssl/universal/settings`)
    expect(requests[2]!.path).toBe(`/zones/${ZONE_ID}/ssl/certificate_packs`)
    expect(requests[2]!.query.get("status")).toBe("all")
    expect(requests[2]!.query.get("per_page")).toBe("50")
    expect(requests[2]!.query.get("page")).toBe("1")

    expect(result).toEqual({
      label: "default",
      zone: { id: ZONE_ID, name: "example.com" },
      universal_ssl: { enabled: true },
      certificate_packs: [
        {
          id: "pack-1",
          type: "universal",
          hosts: ["example.com", "*.example.com"],
          status: "active",
          certificate_authority: "lets_encrypt",
          validation_method: "txt",
          certificates: [
            {
              id: "cert-1",
              hosts: ["example.com", "*.example.com"],
              status: "active",
              expires_on: "2025-01-01T00:00:00Z",
            },
          ],
        },
      ],
      page: 1,
      total_count: 1,
      total_pages: 1,
    })
  })

  test("refuses zone in another account for ssl", async () => {
    const { fetch } = fakeCloudflare([
      {
        method: "GET",
        path: `/zones/${ZONE_ID}`,
        reply: ok({ id: ZONE_ID, name: "example.com", account: { id: OTHER_ACCOUNT_ID } }),
      },
    ])
    const tool = defineZoneRead({ fetch, env: envFor() })

    const error = await rejection(invoke(tool, { method: "ssl", zone: ZONE_ID }, CTX))
    expect(isToolError(error) && error.code === "not_found").toBe(true)
    if (isToolError(error)) {
      expect(error.message).toBe(`Zone ${ZONE_ID} is not in the Cloudflare account default.`)
    }
  })
})

describe("cloudflareZoneRead: dnssec", () => {
  test("reads dnssec status and records", async () => {
    const { fetch, requests } = fakeCloudflare([
      ZONE_ROUTE,
      {
        method: "GET",
        path: `/zones/${ZONE_ID}/dnssec`,
        reply: ok({
          status: "active",
          ds: "example.com. 3600 IN DS 2371 13 2 1234567890abcdef",
          digest: "1234567890abcdef",
          digest_type: "2",
          algorithm: "13",
          key_tag: 2371,
          flags: 257,
          public_key: "mdsswUyr3DPW132mOi8V9xESWE8280x5bEpW9b267HQ=",
          modified_on: "2024-01-01T00:00:00Z",
        }),
      },
    ])
    const tool = defineZoneRead({ fetch, env: envFor() })

    const result = await invoke(tool, { method: "dnssec", zone: ZONE_ID }, CTX)

    expect(requests).toHaveLength(2)
    expect(requests[0]!.path).toBe(`/zones/${ZONE_ID}`)
    expect(requests[1]!.path).toBe(`/zones/${ZONE_ID}/dnssec`)
    expect(result).toEqual({
      label: "default",
      zone: { id: ZONE_ID, name: "example.com" },
      dnssec: {
        status: "active",
        ds: "example.com. 3600 IN DS 2371 13 2 1234567890abcdef",
        digest: "1234567890abcdef",
        digest_type: "2",
        algorithm: "13",
        key_tag: 2371,
        flags: 257,
        public_key: "mdsswUyr3DPW132mOi8V9xESWE8280x5bEpW9b267HQ=",
        modified_on: "2024-01-01T00:00:00Z",
      },
    })
  })

  test("refuses zone in another account for dnssec", async () => {
    const { fetch } = fakeCloudflare([
      {
        method: "GET",
        path: `/zones/${ZONE_ID}`,
        reply: ok({ id: ZONE_ID, name: "example.com", account: { id: OTHER_ACCOUNT_ID } }),
      },
    ])
    const tool = defineZoneRead({ fetch, env: envFor() })

    const error = await rejection(invoke(tool, { method: "dnssec", zone: ZONE_ID }, CTX))
    expect(isToolError(error) && error.code === "not_found").toBe(true)
    if (isToolError(error)) {
      expect(error.message).toBe(`Zone ${ZONE_ID} is not in the Cloudflare account default.`)
    }
  })
})
