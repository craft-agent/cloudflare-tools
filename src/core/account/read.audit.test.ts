import { describe, expect, test } from "bun:test"
import { ACCOUNT_ID, AUDIT_PATH, envFor, toolError, USER_TOKEN } from "../cloudflare/client.fixtures"
import { fakeCloudflare, ok } from "../cloudflare/testing"
import { invoke } from "../tool"
import { TWENTY_FOUR_HOURS_MS } from "./audit"
import { defineAccountRead } from "./read"

const CTX = { cwd: process.cwd() }

describe("cloudflareAccountRead: audit query mapping", () => {
  test("maps since, before, limit, cursor, direction, and repeated filters", async () => {
    const { fetch, requests } = fakeCloudflare([
      {
        method: "GET",
        path: AUDIT_PATH,
        reply: ok([{ id: "audit-1", action: { type: "create", result: "success" } }], { cursor: "next-cursor-token" }),
      },
    ])
    const tool = defineAccountRead({ fetch, env: envFor() })

    const result = await invoke(
      tool,
      {
        method: "audit",
        since: "2024-01-01T00:00:00Z",
        until: "2024-01-02T00:00:00Z",
        limit: 50,
        cursor: "cur-123",
        direction: "asc",
        action_type: ["create", "update"],
        action_result: ["success"],
        actor_type: ["user", "system"],
        actor_email: ["user@example.com"],
        resource_type: ["zone"],
        zone_name: ["example.com"],
      },
      CTX,
    )

    expect(requests).toHaveLength(1)
    const query = requests[0]!.query
    expect(query.get("since")).toBe("2024-01-01T00:00:00.000Z")
    expect(query.get("before")).toBe("2024-01-02T00:00:00.000Z")
    expect(query.get("limit")).toBe("50")
    expect(query.get("cursor")).toBe("cur-123")
    expect(query.get("direction")).toBe("asc")
    expect(query.getAll("action_type")).toEqual(["create", "update"])
    expect(query.getAll("action_result")).toEqual(["success"])
    expect(query.getAll("actor_type")).toEqual(["user", "system"])
    expect(query.getAll("actor_email")).toEqual(["user@example.com"])
    expect(query.getAll("resource_type")).toEqual(["zone"])
    expect(query.getAll("zone_name")).toEqual(["example.com"])

    expect(result.label).toBe("default")
    expect(result.since).toBe("2024-01-01T00:00:00.000Z")
    expect(result.until).toBe("2024-01-02T00:00:00.000Z")
    expect(result.cursor).toBe("next-cursor-token")
    expect(result.entries).toEqual([{ id: "audit-1", action: { type: "create", result: "success" } }])
  })
})

describe("cloudflareAccountRead: audit defaults", () => {
  test("defaults to 24h window ending now, limit 25, direction desc, cursor null", async () => {
    const { fetch, requests } = fakeCloudflare([{ method: "GET", path: AUDIT_PATH, reply: ok([]) }])
    const tool = defineAccountRead({ fetch, env: envFor() })

    const result = await invoke(tool, { method: "audit" }, CTX)

    expect(requests).toHaveLength(1)
    const query = requests[0]!.query
    expect(query.get("limit")).toBe("25")
    expect(query.get("direction")).toBe("desc")
    expect(query.get("cursor")).toBeNull()

    const sinceMs = Date.parse(result.since!)
    const untilMs = Date.parse(result.until!)
    expect(untilMs - sinceMs).toBe(TWENTY_FOUR_HOURS_MS)
    expect(result.cursor).toBeNull()
    expect(result.entries).toEqual([])
  })
})

describe("cloudflareAccountRead: audit date validation", () => {
  test("refuses invalid since date", async () => {
    const { fetch } = fakeCloudflare([])
    const tool = defineAccountRead({ fetch, env: envFor() })

    const error = await toolError(invoke(tool, { method: "audit", since: "not-a-date" }, CTX))
    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain('Invalid date for `since`: "not-a-date"')
  })

  test("refuses invalid until date", async () => {
    const { fetch } = fakeCloudflare([])
    const tool = defineAccountRead({ fetch, env: envFor() })

    const error = await toolError(invoke(tool, { method: "audit", until: "invalid" }, CTX))
    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain('Invalid date for `until`: "invalid"')
  })

  test("refuses since date after until date", async () => {
    const { fetch } = fakeCloudflare([])
    const tool = defineAccountRead({ fetch, env: envFor() })

    const error = await toolError(
      invoke(
        tool,
        {
          method: "audit",
          since: "2024-01-02T00:00:00Z",
          until: "2024-01-01T00:00:00Z",
        },
        CTX,
      ),
    )
    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("must be before `until`")
  })

  test("refuses since date equal to until date", async () => {
    const { fetch } = fakeCloudflare([])
    const tool = defineAccountRead({ fetch, env: envFor() })

    const error = await toolError(
      invoke(
        tool,
        {
          method: "audit",
          since: "2024-01-01T00:00:00Z",
          until: "2024-01-01T00:00:00Z",
        },
        CTX,
      ),
    )
    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("must be before `until`")
  })
})

describe("cloudflareAccountRead: audit upstream errors", () => {
  test("throws upstream_error if result is not an array", async () => {
    const { fetch } = fakeCloudflare([{ method: "GET", path: AUDIT_PATH, reply: ok({ not: "an array" }) }])
    const tool = defineAccountRead({ fetch, env: envFor() })

    const error = await toolError(invoke(tool, { method: "audit" }, CTX))
    expect(error.code).toBe("upstream_error")
    expect(error.message).toContain("result that is not an array")
  })
})

describe("cloudflareAccountRead: audit token masking", () => {
  test("no token value appears in audit result", async () => {
    const { fetch } = fakeCloudflare([
      {
        method: "GET",
        path: AUDIT_PATH,
        reply: ok([{ id: "entry-1", actor: { email: "admin@example.com" } }]),
      },
    ])
    const tool = defineAccountRead({ fetch, env: envFor() })

    const result = await invoke(tool, { method: "audit" }, CTX)
    const serialized = JSON.stringify(result)

    expect(serialized).not.toContain(USER_TOKEN)
  })
})
