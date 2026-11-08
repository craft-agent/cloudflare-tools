import { expect, test } from "bun:test"
import { ACCOUNT_ID } from "../cloudflare/client.fixtures"
import { fail, ok, type FakeReply } from "../cloudflare/testing"
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
  toolFor,
} from "./fixtures"

const ACCESS_PATH = `/accounts/${ACCOUNT_ID}/access/apps`

function configured(ingress: unknown[], reply: FakeReply = ok([])) {
  return toolFor(
    { method: "GET", path: TUNNEL_PATH, reply: ok({ id: TUNNEL_ID, config_src: "cloudflare" }) },
    { method: "GET", path: TUNNEL_CONNECTIONS_PATH, reply: ok([]) },
    { method: "GET", path: TUNNEL_CONFIG_PATH, reply: ok({ config: { ingress } }) },
    { method: "GET", path: ACCESS_PATH, reply },
  )
}

test("ingress rules carry coverage, with one Access list and null for the catch-all", async () => {
  const { tool, requests } = configured(
    [
      { hostname: "app.example.com", service: "http://localhost:8080" },
      { hostname: "admin.example.com", service: "http://localhost:8081" },
      { hostname: "open.example.com", service: "http://localhost:8082" },
      { service: "http_status:404" },
    ],
    ok([
      { id: "app", type: "self_hosted", domain: "app.example.com" },
      { id: "admin", type: "self_hosted", domain: "admin.example.com/admin" },
    ]),
  )
  const result = await invoke(tool, { method: "tunnel", tunnel: TUNNEL_ID }, CTX)
  expect(result.ingress?.map((rule) => rule.access)).toEqual([
    { status: "covered", apps: [{ id: "app", name: null, destination: "app.example.com" }] },
    { status: "partial", apps: [{ id: "admin", name: null, destination: "admin.example.com/admin" }] },
    { status: "none", apps: [] },
    null,
  ])
  expect(requests.filter((request) => request.path === ACCESS_PATH)).toHaveLength(1)
})

test("no hostname means no Access request and every rule has null coverage", async () => {
  const { tool, requests } = configured([{ service: "http_status:404" }])
  const result = await invoke(tool, { method: "tunnel", tunnel: TUNNEL_ID }, CTX)
  expect(result.ingress?.map((rule) => rule.access)).toEqual([null])
  expect(requests.some((request) => request.path === ACCESS_PATH)).toBe(false)
})

test("locally managed tunnels do not request Access applications", async () => {
  const { tool, requests } = toolFor(
    { method: "GET", path: TUNNEL_LOCAL_PATH, reply: ok({ id: TUNNEL_ID_LOCAL, config_src: "local" }) },
    { method: "GET", path: TUNNEL_LOCAL_CONNECTIONS_PATH, reply: ok([]) },
  )
  const result = await invoke(tool, { method: "tunnel", tunnel: TUNNEL_ID_LOCAL }, CTX)
  expect(result.ingress).toBeUndefined()
  expect(requests).toHaveLength(2)
  expect(requests.some((request) => request.path === ACCESS_PATH)).toBe(false)
})

test("forbidden Access listing leaves a successful tunnel result with unknown coverage", async () => {
  const { tool } = configured(
    [{ hostname: "app.example.com", service: "http://localhost:8080" }],
    fail(403, [{ code: 10000, message: "Forbidden" }]),
  )
  const result = await invoke(tool, { method: "tunnel", tunnel: TUNNEL_ID }, CTX)
  expect(result.tunnel?.id).toBe(TUNNEL_ID)
  expect(result.ingress?.[0]?.access).toEqual({
    status: "unknown",
    apps: [],
    reason: "The token needs Account → Access: Apps and Policies → Read to tell.",
  })
})
