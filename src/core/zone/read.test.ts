import { describe, expect, test } from "bun:test"
import { ACCOUNT_ID, envFor, rejection, ZONE_ID } from "../cloudflare/client.fixtures"
import { fakeCloudflare, ok } from "../cloudflare/testing"
import { isToolError } from "../errors"
import { annotations, invoke } from "../tool"
import { CTX, OTHER_ACCOUNT_ID } from "./fixtures"
import { cloudflareZoneRead, defineZoneRead } from "./read"

describe("cloudflareZoneRead: annotations", () => {
  test("publishes read class annotations", () => {
    expect(annotations(cloudflareZoneRead)).toEqual({
      title: "Read Cloudflare zones",
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: true,
    })
  })
})

describe("cloudflareZoneRead: argument validation", () => {
  test("refuses unexpected arguments for list", async () => {
    const tool = defineZoneRead({ fetch: fakeCloudflare([]).fetch, env: envFor() })
    const error = await rejection(invoke(tool, { method: "list", zone: ZONE_ID } as any, CTX))
    expect(isToolError(error) && error.code === "invalid_argument").toBe(true)
    if (isToolError(error)) {
      expect(error.message).toContain('Method "list" takes no `zone`.')
    }
  })

  test("refuses missing zone for view", async () => {
    const tool = defineZoneRead({ fetch: fakeCloudflare([]).fetch, env: envFor() })
    const error = await rejection(invoke(tool, { method: "view" }, CTX))
    expect(isToolError(error) && error.code === "invalid_argument").toBe(true)
    if (isToolError(error)) {
      expect(error.message).toContain('Method "view" requires `zone`.')
    }
  })

  test("refuses missing zone for settings, ssl, dnssec", async () => {
    const tool = defineZoneRead({ fetch: fakeCloudflare([]).fetch, env: envFor() })
    for (const method of ["settings", "ssl", "dnssec"] as const) {
      const error = await rejection(invoke(tool, { method }, CTX))
      expect(isToolError(error) && error.code === "invalid_argument").toBe(true)
      if (isToolError(error)) {
        expect(error.message).toContain(`Method "${method}" requires \`zone\`.`)
      }
    }
  })

  test("refuses extra argument for view", async () => {
    const tool = defineZoneRead({ fetch: fakeCloudflare([]).fetch, env: envFor() })
    const error = await rejection(invoke(tool, { method: "view", zone: ZONE_ID, page: 2 } as any, CTX))
    expect(isToolError(error) && error.code === "invalid_argument").toBe(true)
    if (isToolError(error)) {
      expect(error.message).toContain('Method "view" takes no `page`.')
    }
  })
})

describe("cloudflareZoneRead: list", () => {
  test("lists zones with query parameters and pagination", async () => {
    const { fetch, requests } = fakeCloudflare([
      {
        method: "GET",
        path: "/zones",
        reply: ok(
          [
            {
              id: ZONE_ID,
              name: "example.com",
              status: "active",
              paused: false,
              type: "full",
              plan: { name: "Pro Plan" },
              name_servers: ["ns1.cloudflare.com", "ns2.cloudflare.com"],
              activated_on: "2024-01-01T00:00:00Z",
              account: { id: ACCOUNT_ID },
            },
          ],
          { page: 1, per_page: 20, total_count: 1, total_pages: 1 },
        ),
      },
    ])
    const tool = defineZoneRead({ fetch, env: envFor() })

    const result = await invoke(tool, { method: "list", name: "EXAMPLE.COM.", status: "active", page: 1 }, CTX)

    expect(requests).toHaveLength(1)
    expect(requests[0]!.query.get("account.id")).toBe(ACCOUNT_ID)
    expect(requests[0]!.query.get("name")).toBe("example.com")
    expect(requests[0]!.query.get("status")).toBe("active")
    expect(requests[0]!.query.get("page")).toBe("1")
    expect(requests[0]!.query.get("per_page")).toBe("20")

    expect(result).toEqual({
      label: "default",
      zones: [
        {
          id: ZONE_ID,
          name: "example.com",
          status: "active",
          paused: false,
          type: "full",
          plan: "Pro Plan",
          name_servers: ["ns1.cloudflare.com", "ns2.cloudflare.com"],
          activated_on: "2024-01-01T00:00:00Z",
        },
      ],
      page: 1,
      per_page: 20,
      total_count: 1,
      total_pages: 1,
    })
  })
})

describe("cloudflareZoneRead: view", () => {
  test("reads full zone details by id", async () => {
    const rawZone = {
      id: ZONE_ID,
      name: "example.com",
      status: "active",
      paused: false,
      account: { id: ACCOUNT_ID, name: "Test" },
      custom_field: "custom_value",
    }
    const { fetch, requests } = fakeCloudflare([
      {
        method: "GET",
        path: `/zones/${ZONE_ID}`,
        reply: ok(rawZone),
      },
    ])
    const tool = defineZoneRead({ fetch, env: envFor() })

    const result = await invoke(tool, { method: "view", zone: ZONE_ID }, CTX)

    expect(requests).toHaveLength(1)
    expect(result).toEqual({
      label: "default",
      zone: rawZone,
    })
  })

  test("refuses zone in another account", async () => {
    const rawZone = {
      id: ZONE_ID,
      name: "example.com",
      account: { id: OTHER_ACCOUNT_ID },
    }
    const { fetch } = fakeCloudflare([
      {
        method: "GET",
        path: `/zones/${ZONE_ID}`,
        reply: ok(rawZone),
      },
    ])
    const tool = defineZoneRead({ fetch, env: envFor() })

    const error = await rejection(invoke(tool, { method: "view", zone: ZONE_ID }, CTX))
    expect(isToolError(error) && error.code === "not_found").toBe(true)
    if (isToolError(error)) {
      expect(error.message).toBe(`Zone ${ZONE_ID} is not in the Cloudflare account default.`)
    }
  })
})
