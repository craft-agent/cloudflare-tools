import { describe, expect, test } from "bun:test"
import { invoke } from "../tool"
import { ARGS, CTX, HOSTNAME, TUNNEL_ID, refusalOf, routeFor, sent } from "./route.fixtures"
import { cloudflareTunnelRouteAdd } from "./route-add"

describe("route add refusals: the arguments", () => {
  test.each([
    "hello_world",
    "bastion",
    "ftp://localhost",
    "http://a b",
    "http://",
    "http_status:600",
    "http_status:99",
    "unix:",
    "localhost:8080",
    "",
  ])("refuses the service %p before any request", async (service) => {
    const { tool, requests } = routeFor()

    expect(await refusalOf(invoke(tool, { ...ARGS, service }, CTX))).toContain("service")
    expect(requests).toEqual([])
  })

  test.each([
    "http://localhost:8080",
    "https://example.net/base",
    "tcp://localhost:22",
    "ssh://localhost:22",
    "rdp://localhost:3389",
    "smb://localhost:445",
    "unix:/run/app.sock",
    "unix+tls:/run/app.sock",
    "http_status:404",
    "http_status:503",
  ])("accepts the service %p", (service) => {
    expect(cloudflareTunnelRouteAdd.input.safeParse({ ...ARGS, service }).success).toBe(true)
  })

  test.each([
    ["a wildcard", "*.example.com", "a wildcard `*` is not allowed here"],
    ["a name without a dot", "app", "it needs at least one dot, as in mail.example.com"],
    ["an empty name", "  ", "it is empty"],
    ["an invalid label", "-a.example.com", 'label "-a" starts or ends with `-`'],
  ])("refuses %s as the hostname before any request", async (_what, hostname, problem) => {
    const { tool, requests } = routeFor()

    expect(await refusalOf(invoke(tool, { ...ARGS, hostname }, CTX))).toBe(
      `\`hostname\` must be a hostname: ${problem}.`,
    )
    expect(requests).toEqual([])
  })

  test.each(["", "a\nb", "a\u0000b", "a\u007fb", "x".repeat(201)])(
    "refuses the path %p before any request",
    async (path) => {
      const { tool, requests } = routeFor()

      expect(await refusalOf(invoke(tool, { ...ARGS, path }, CTX))).toContain("path")
      expect(requests).toEqual([])
    },
  )

  test("accepts a path of 200 characters, sent unchanged", async () => {
    const path = `^/${"a.*".repeat(66)}$`.slice(0, 200)
    const { tool, requests } = routeFor()

    await invoke(tool, { ...ARGS, path }, CTX)

    expect(JSON.stringify(sent(requests, "PUT")[0]!.body)).toContain(JSON.stringify(path))
  })

  test("refuses a bad tunnel id, an unknown argument and a missing one before any request", async () => {
    const { tool, requests } = routeFor()

    expect(await refusalOf(invoke(tool, { ...ARGS, tunnel: "nope" }, CTX))).toContain("tunnel")
    expect(await refusalOf(invoke(tool, { ...ARGS, force: true }, CTX))).toContain("force: unknown argument")
    expect(await refusalOf(invoke(tool, { tunnel: TUNNEL_ID, hostname: HOSTNAME }, CTX))).toContain("service")
    expect(requests).toEqual([])
  })
})
