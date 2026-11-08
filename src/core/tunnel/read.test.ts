import { expect, test } from "bun:test"
import { rejection } from "../cloudflare/client.fixtures"
import { fail, ok } from "../cloudflare/testing"
import { annotations, invoke } from "../tool"
import { CTX, TUNNEL_ID, TUNNELS_PATH, errorOf, refusalOf, toolFor } from "./fixtures"
import { cloudflareTunnelRead } from "./read"

test("publishes the tunnels read contract and guidance", () => {
  expect(cloudflareTunnelRead.id).toBe("cloudflare_tunnel_read")
  expect(cloudflareTunnelRead.toolset).toBe("tunnels")
  expect(annotations(cloudflareTunnelRead)).toEqual({
    title: "Read Cloudflare Tunnels",
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: true,
  })
  for (const text of [
    "Cloudflare Tunnels",
    "never deleted ones",
    "tunnel's run token",
    "connectors' IP addresses",
    "user's data",
    "Account → Cloudflare One Connector: cloudflared → Read",
  ]) {
    expect(cloudflareTunnelRead.description).toContain(text)
  }
})

test("refuses unknown, wrong-method, missing and malformed arguments before sending anything", async () => {
  const { tool, requests } = toolFor()

  // Unknown argument
  expect(await refusalOf(invoke(tool, { method: "tunnels", extra: "val" }, CTX))).toContain("extra")

  // Wrong method arguments (assertAcceptedKeys)
  expect(await refusalOf(invoke(tool, { method: "tunnels", tunnel: TUNNEL_ID }, CTX))).toContain(
    'Method "tunnels" takes no `tunnel`.',
  )
  expect(await refusalOf(invoke(tool, { method: "tunnel", tunnel: TUNNEL_ID, page: 2 }, CTX))).toContain(
    'Method "tunnel" takes no `page`.',
  )
  expect(await refusalOf(invoke(tool, { method: "tunnel", tunnel: TUNNEL_ID, status: "healthy" }, CTX))).toContain(
    'Method "tunnel" takes no `status`.',
  )

  // Missing required argument for tunnel
  expect(await refusalOf(invoke(tool, { method: "tunnel" }, CTX))).toContain('Method "tunnel" requires `tunnel`.')

  // Malformed tunnel id (must match UUID pattern)
  for (const badId of [
    "",
    "not-a-uuid",
    "11111111",
    "11111111-2222-3333-4444-55555555555",
    "11111111-2222-3333-4444-AAAAAAAAAAAA",
  ]) {
    expect(await refusalOf(invoke(tool, { method: "tunnel", tunnel: badId }, CTX))).toContain("tunnel")
  }

  // Malformed status
  for (const badStatus of ["", "online", "active", "pending"]) {
    expect(await refusalOf(invoke(tool, { method: "tunnels", status: badStatus }, CTX))).toContain("status")
  }

  // Malformed page
  for (const badPage of [0, -1, 1.5]) {
    expect(await refusalOf(invoke(tool, { method: "tunnels", page: badPage }, CTX))).toContain("page")
  }

  expect(requests).toEqual([])
})

test("tunnels: lists tunnels with default pagination, query params and shapes rows", async () => {
  const longName = "a".repeat(125)
  const clippedName = `${"a".repeat(120)}…`
  const { tool, requests } = toolFor({
    method: "GET",
    path: TUNNELS_PATH,
    reply: ok(
      [
        {
          id: TUNNEL_ID,
          name: longName,
          status: "healthy",
          config_src: "cloudflare",
          created_at: "2024-01-01T00:00:00Z",
          conns_active_at: "2024-01-02T00:00:00Z",
          conns_inactive_at: null,
          account_tag: "secret-account-tag",
          metadata: { secret: "data" },
          connections: [{ id: "conn-1" }],
        },
        {
          id: "22222222-3333-4444-5555-666666666666",
          name: "local-tunnel",
          status: "inactive",
          config_src: "local",
          created_at: "2024-02-01T00:00:00Z",
          conns_active_at: null,
          conns_inactive_at: "2024-02-02T00:00:00Z",
        },
        {
          id: "33333333-4444-5555-6666-777777777777",
          name: "remote-config-true",
          remote_config: true,
        },
        {
          id: "44444444-5555-6666-7777-888888888888",
          name: "remote-config-false",
          remote_config: false,
        },
        {
          id: "55555555-6666-7777-8888-999999999999",
          name: "no-config-src",
        },
        // Invalid rows dropped
        null,
        "not-an-object",
        { name: "missing-id" },
        { id: 12345, name: "numeric-id" },
      ],
      { page: 1, per_page: 50, total_count: 5, total_pages: 1 },
    ),
  })

  const result = await invoke(tool, { method: "tunnels" }, CTX)
  expect(result).toEqual({
    label: "default",
    tunnels: [
      {
        id: TUNNEL_ID,
        name: clippedName,
        status: "healthy",
        managed: "cloudflare",
        created: "2024-01-01T00:00:00Z",
        active_at: "2024-01-02T00:00:00Z",
        inactive_at: null,
      },
      {
        id: "22222222-3333-4444-5555-666666666666",
        name: "local-tunnel",
        status: "inactive",
        managed: "local",
        created: "2024-02-01T00:00:00Z",
        active_at: null,
        inactive_at: "2024-02-02T00:00:00Z",
      },
      {
        id: "33333333-4444-5555-6666-777777777777",
        name: "remote-config-true",
        status: null,
        managed: "cloudflare",
        created: null,
        active_at: null,
        inactive_at: null,
      },
      {
        id: "44444444-5555-6666-7777-888888888888",
        name: "remote-config-false",
        status: null,
        managed: "local",
        created: null,
        active_at: null,
        inactive_at: null,
      },
      {
        id: "55555555-6666-7777-8888-999999999999",
        name: "no-config-src",
        status: null,
        managed: null,
        created: null,
        active_at: null,
        inactive_at: null,
      },
    ],
    page: 1,
    per_page: 50,
    total_count: 5,
    total_pages: 1,
  })

  expect(Object.fromEntries(requests[0].query)).toEqual({
    is_deleted: "false",
    page: "1",
    per_page: "50",
  })

  const rawJson = JSON.stringify(result)
  expect(rawJson).not.toContain("secret-account-tag")
  expect(rawJson).not.toContain("connections")
  expect(rawJson).not.toContain("metadata")
})

test("tunnels: sends status and page when given", async () => {
  const { tool, requests } = toolFor({
    method: "GET",
    path: TUNNELS_PATH,
    reply: ok([], { page: 3, per_page: 50, total_count: 0, total_pages: 0 }),
  })

  const result = await invoke(tool, { method: "tunnels", status: "degraded", page: 3 }, CTX)
  expect(Object.fromEntries(requests[0].query)).toEqual({
    is_deleted: "false",
    page: "3",
    per_page: "50",
    status: "degraded",
  })
  expect(result.tunnels).toEqual([])
  expect(result.page).toBe(3)
  expect(result.note).toBeUndefined()
})

test("tunnels: an empty first page says the token may lack the permission", async () => {
  const { tool } = toolFor({ method: "GET", path: TUNNELS_PATH, reply: ok([]) })

  for (const args of [{ method: "tunnels" }, { method: "tunnels", status: "healthy", page: 1 }]) {
    const result = await invoke(tool, args, CTX)
    expect(result.tunnels).toEqual([])
    expect(result.note).toBe(
      "No tunnel is listed. Cloudflare also answers an empty list when the token lacks the permission, so check it if tunnels are expected: The token needs Account → Cloudflare One Connector: cloudflared → Read.",
    )
  }
})

test("tunnels: upstream_error when response is not an array", async () => {
  for (const reply of [ok(null), ok({}), ok("bad")]) {
    const { tool } = toolFor({ method: "GET", path: TUNNELS_PATH, reply })
    const err = errorOf(await rejection(invoke(tool, { method: "tunnels" }, CTX)))
    expect(err.code).toBe("upstream_error")
    expect(err.message).toBe("Cloudflare returned an unexpected tunnels response.")
  }
})

test("forbidden error includes permission hint", async () => {
  const { tool } = toolFor({
    method: "GET",
    path: TUNNELS_PATH,
    reply: fail(403, [{ code: 10000, message: "Authentication error" }]),
  })

  const err = errorOf(await rejection(invoke(tool, { method: "tunnels" }, CTX)))
  expect(err.code).toBe("forbidden")
  expect(err.message).toContain("Authentication error.")
  expect(err.message).toContain("The token needs Account → Cloudflare One Connector: cloudflared → Read.")
})
