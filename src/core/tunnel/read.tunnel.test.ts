import { expect, test } from "bun:test"
import { ACCOUNT_ID, rejection } from "../cloudflare/client.fixtures"
import { fail, ok } from "../cloudflare/testing"
import { invoke } from "../tool"
import {
  CTX,
  TUNNEL_CONFIG_PATH,
  TUNNEL_CONNECTIONS_PATH,
  TUNNEL_ID,
  TUNNEL_ID_LOCAL,
  TUNNEL_LOCAL_CONNECTIONS_PATH,
  TUNNEL_LOCAL_PATH,
  TUNNEL_PATH,
  errorOf,
  toolFor,
} from "./fixtures"

const CF_TUNNEL_REPLY = ok({ id: TUNNEL_ID, name: "cf-tunnel", config_src: "cloudflare" })
const EMPTY_CONNECTIONS_REPLY = ok([])

test("tunnel: reads Cloudflare-managed tunnel, connectors and ingress rules", async () => {
  const { tool, requests } = toolFor(
    { method: "GET", path: `/accounts/${ACCOUNT_ID}/access/apps`, reply: ok([]) },
    {
      method: "GET",
      path: TUNNEL_PATH,
      reply: ok({
        id: TUNNEL_ID,
        name: "production-tunnel",
        status: "healthy",
        config_src: "cloudflare",
        created_at: "2024-01-01T00:00:00Z",
        conns_active_at: "2024-01-02T00:00:00Z",
        conns_inactive_at: null,
      }),
    },
    {
      method: "GET",
      path: TUNNEL_CONNECTIONS_PATH,
      reply: ok([
        {
          id: "connector-secret-id",
          uuid: "uuid-secret",
          client_id: "client-secret-id",
          version: "2024.1.0",
          arch: "linux_amd64",
          run_at: "2024-01-02T00:00:00Z",
          origin_ip: "203.0.113.5",
          features: ["serialized_headers"],
          conns: [
            { id: "conn-1", colo_name: "SJC", origin_ip: "203.0.113.5" },
            { id: "conn-2", colo_name: "IAD", origin_ip: "203.0.113.5" },
            { id: "conn-3", colo_name: "SJC" },
            { id: "conn-4", colo_name: "" },
          ],
        },
      ]),
    },
    {
      method: "GET",
      path: TUNNEL_CONFIG_PATH,
      reply: ok({
        version: 3,
        config: {
          ingress: [
            {
              hostname: "app.example.com",
              path: "/api",
              service: "http://localhost:8080",
              originRequest: { connectTimeout: 30 },
            },
            {
              service: "http_status:404",
            },
            "dropped-non-object",
          ],
        },
      }),
    },
  )

  const result = await invoke(tool, { method: "tunnel", tunnel: TUNNEL_ID }, CTX)

  expect(result).toEqual({
    label: "default",
    tunnel: {
      id: TUNNEL_ID,
      name: "production-tunnel",
      status: "healthy",
      managed: "cloudflare",
      created: "2024-01-01T00:00:00Z",
      active_at: "2024-01-02T00:00:00Z",
      inactive_at: null,
    },
    connectors: [
      {
        version: "2024.1.0",
        arch: "linux_amd64",
        run_at: "2024-01-02T00:00:00Z",
        connections: 4,
        colos: ["IAD", "SJC"],
      },
    ],
    config_version: 3,
    ingress: [
      {
        hostname: "app.example.com",
        path: "/api",
        service: "http://localhost:8080",
        origin_request: { connectTimeout: 30 },
        access: { status: "none", apps: [] },
      },
      {
        hostname: null,
        path: null,
        service: "http_status:404",
        origin_request: null,
        access: null,
      },
    ],
  })

  expect(requests).toHaveLength(4)

  // Verify sensitive fields are never in serialized result
  const rawJson = JSON.stringify(result)
  expect(rawJson).not.toContain("203.0.113.5")
  expect(rawJson).not.toContain("connector-secret-id")
  expect(rawJson).not.toContain("client-secret-id")
  expect(rawJson).not.toContain("uuid-secret")
  expect(rawJson).not.toContain("serialized_headers")
  expect(rawJson).not.toContain("conn-1")
})

test("tunnel: clips ingress service and path longer than 300 characters", async () => {
  const longPath = `/api/${"x".repeat(310)}`
  const longService = `http://localhost:8080/${"s".repeat(310)}`
  const { tool } = toolFor(
    { method: "GET", path: TUNNEL_PATH, reply: ok({ id: TUNNEL_ID, name: "test", config_src: "cloudflare" }) },
    { method: "GET", path: TUNNEL_CONNECTIONS_PATH, reply: EMPTY_CONNECTIONS_REPLY },
    {
      method: "GET",
      path: TUNNEL_CONFIG_PATH,
      reply: ok({
        version: 1,
        config: { ingress: [{ hostname: "app.example.com", path: longPath, service: longService }] },
      }),
    },
  )

  const result = await invoke(tool, { method: "tunnel", tunnel: TUNNEL_ID }, CTX)
  expect(result.ingress?.[0]?.path).toBe(`${longPath.slice(0, 300)}…`)
  expect(result.ingress?.[0]?.service).toBe(`${longService.slice(0, 300)}…`)
})

test("tunnel: locally managed tunnel returns note and sends no configuration request", async () => {
  const { tool, requests } = toolFor(
    {
      method: "GET",
      path: TUNNEL_LOCAL_PATH,
      reply: ok({
        id: TUNNEL_ID_LOCAL,
        name: "local-tunnel",
        status: "healthy",
        config_src: "local",
      }),
    },
    {
      method: "GET",
      path: TUNNEL_LOCAL_CONNECTIONS_PATH,
      reply: ok([
        {
          version: "2024.1.0",
          arch: "arm64",
          run_at: "2024-01-01T00:00:00Z",
          conns: [{ colo_name: "NRT" }],
        },
      ]),
    },
  )

  const result = await invoke(tool, { method: "tunnel", tunnel: TUNNEL_ID_LOCAL }, CTX)

  expect(result).toEqual({
    label: "default",
    tunnel: {
      id: TUNNEL_ID_LOCAL,
      name: "local-tunnel",
      status: "healthy",
      managed: "local",
      created: null,
      active_at: null,
      inactive_at: null,
    },
    connectors: [
      {
        version: "2024.1.0",
        arch: "arm64",
        run_at: "2024-01-01T00:00:00Z",
        connections: 1,
        colos: ["NRT"],
      },
    ],
    note: "This tunnel is managed in a config file on the machine that runs it; its hostnames are not readable here.",
  })

  expect(result.config_version).toBeUndefined()
  expect(result.ingress).toBeUndefined()
  expect(requests).toHaveLength(2)
})

test("tunnel: configuration 404 yields empty ingress and null config_version", async () => {
  const { tool } = toolFor(
    { method: "GET", path: TUNNEL_PATH, reply: CF_TUNNEL_REPLY },
    { method: "GET", path: TUNNEL_CONNECTIONS_PATH, reply: EMPTY_CONNECTIONS_REPLY },
    {
      method: "GET",
      path: TUNNEL_CONFIG_PATH,
      reply: fail(404, [{ code: 10001, message: "Configuration not found" }]),
    },
  )

  const result = await invoke(tool, { method: "tunnel", tunnel: TUNNEL_ID }, CTX)
  expect(result.config_version).toBeNull()
  expect(result.ingress).toEqual([])
  expect(result.note).toBeUndefined()
})

test("tunnel: not_found on initial tunnel request passes through without subsequent requests", async () => {
  const { tool, requests } = toolFor({
    method: "GET",
    path: TUNNEL_PATH,
    reply: fail(404, [{ code: 10001, message: "Tunnel not found" }]),
  })

  const err = errorOf(await rejection(invoke(tool, { method: "tunnel", tunnel: TUNNEL_ID }, CTX)))
  expect(err.code).toBe("not_found")
  expect(requests).toHaveLength(1)
})

test("tunnel: failing connections read fails the call with no partial result", async () => {
  const { tool } = toolFor(
    { method: "GET", path: TUNNEL_PATH, reply: CF_TUNNEL_REPLY },
    {
      method: "GET",
      path: TUNNEL_CONNECTIONS_PATH,
      reply: fail(500, [{ code: 10000, message: "Internal server error" }]),
    },
    {
      method: "GET",
      path: TUNNEL_CONFIG_PATH,
      reply: ok({ version: 1, config: { ingress: [] } }),
    },
  )

  const err = errorOf(await rejection(invoke(tool, { method: "tunnel", tunnel: TUNNEL_ID }, CTX)))
  expect(err.code).toBe("upstream_error")
})

test("tunnel: non-404 failure on configuration read fails the call", async () => {
  const { tool } = toolFor(
    { method: "GET", path: TUNNEL_PATH, reply: CF_TUNNEL_REPLY },
    { method: "GET", path: TUNNEL_CONNECTIONS_PATH, reply: EMPTY_CONNECTIONS_REPLY },
    {
      method: "GET",
      path: TUNNEL_CONFIG_PATH,
      reply: fail(403, [{ code: 10000, message: "Authentication error" }]),
    },
  )

  const err = errorOf(await rejection(invoke(tool, { method: "tunnel", tunnel: TUNNEL_ID }, CTX)))
  expect(err.code).toBe("forbidden")
  expect(err.message).toContain("The token needs Account → Cloudflare One Connector: cloudflared → Read.")
})
