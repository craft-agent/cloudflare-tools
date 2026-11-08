import { describe, expect, test } from "bun:test"
import { toolError } from "../cloudflare/client.fixtures"
import { fail, ok } from "../cloudflare/testing"
import { invoke } from "../tool"
import {
  CATCH_ALL,
  CTX,
  HOSTNAME,
  SERVICE,
  TUNNEL_ENTRY,
  TUNNEL_ID,
  TUNNEL_NAME,
  editFor,
  publishedRoute,
  refusalOf,
  tunnelRoute,
  writes,
} from "./route.fixtures"

const NEW_SERVICE = "http://localhost:9090"
const ARGS = { tunnel: TUNNEL_ID, hostname: HOSTNAME, service: NEW_SERVICE, replaces: SERVICE }

/** Calls the tool and returns the error it ends with, having sent no write. */
async function refusal(args: object, ...routes: Parameters<typeof editFor>) {
  const { tool, requests } = editFor(...routes)
  const error = await toolError(invoke(tool, args, CTX))
  expect(writes(requests)).toEqual([])
  return error
}

describe("route edit refusals: the rule", () => {
  test.each([
    ["another hostname", { ...ARGS, hostname: "other.example.com" }, "other.example.com"],
    ["another path", { ...ARGS, path: "^/a" }, `${HOSTNAME} (path ^/a)`],
  ])("is not found when the tunnel publishes %s only", async (_what, args, shown) => {
    const error = await refusal(args)

    expect(error.code).toBe("not_found")
    expect(error.message).toBe(
      `This tunnel does not publish ${shown}; cloudflare_tunnel_read tunnel lists its rules. Nothing was changed.`,
    )
  })

  test("is not found when no path is given and the tunnel's rule for the hostname has one", async () => {
    const withPath = { hostname: HOSTNAME, path: "^/a", service: SERVICE }

    const error = await refusal(ARGS, publishedRoute([withPath, CATCH_ALL]))

    expect(error.message).toStartWith(`This tunnel does not publish ${HOSTNAME};`)
  })

  test("is stale when the rule goes elsewhere than `replaces` says", async () => {
    const error = await refusal({ ...ARGS, replaces: "http://localhost:7000" })

    expect(error.code).toBe("stale")
    expect(error.message).toBe(
      `${HOSTNAME} now goes to ${SERVICE}, not http://localhost:7000; read the tunnel again before changing it. Nothing was changed.`,
    )
  })

  test("compares `replaces` exactly, not by case or a trailing slash", async () => {
    for (const replaces of [SERVICE.toUpperCase(), `${SERVICE}/`]) {
      const error = await refusal({ ...ARGS, replaces })
      expect(error.code).toBe("stale")
    }
  })

  test("is invalid when the service is the one it goes to already", async () => {
    const error = await refusal({ ...ARGS, service: SERVICE })

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toBe(`${HOSTNAME} already goes to ${SERVICE}. Nothing was changed.`)
  })

  test("says a rule without a service goes to no service", async () => {
    const error = await refusal(ARGS, publishedRoute([{ hostname: HOSTNAME }, CATCH_ALL]))

    expect(error.code).toBe("stale")
    expect(error.message).toContain(`now goes to no service, not ${SERVICE};`)
  })
})

describe("route edit refusals: the tunnel and the zone", () => {
  test.each([
    ["a locally managed", { ...TUNNEL_ENTRY, config_src: "local" }],
    ["a tunnel that does not say how it is managed", { id: TUNNEL_ID, name: TUNNEL_NAME }],
  ])("refuses %s tunnel", async (_what, entry) => {
    const error = await refusal(ARGS, tunnelRoute(ok(entry)))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toBe(
      `Tunnel ${TUNNEL_NAME} is managed in a config file on the machine that runs it; its hostnames change there, not here. Nothing was changed.`,
    )
  })

  test("refuses a deleted tunnel as not found", async () => {
    const error = await refusal(ARGS, tunnelRoute(ok({ ...TUNNEL_ENTRY, deleted_at: "2024-05-01T00:00:00Z" })))

    expect(error.code).toBe("not_found")
    expect(error.message).toBe(`Tunnel ${TUNNEL_ID} is deleted.`)
  })

  test("passes on not_found for a tunnel that does not exist, and names the Read permission when forbidden", async () => {
    const missing = await refusal(ARGS, tunnelRoute(fail(404, [{ code: 1003, message: "Tunnel not found" }])))
    const denied = await refusal(ARGS, tunnelRoute(fail(403, [{ code: 10000, message: "Authentication error" }])))

    expect(missing.code).toBe("not_found")
    expect(denied.code).toBe("forbidden")
    expect(denied.message).toEndWith("The token needs Account → Cloudflare Tunnel → Read.")
  })

  test("refuses a hostname in no zone of the account", async () => {
    const error = await refusal({ ...ARGS, hostname: "app.other.net" })

    expect(error.code).toBe("not_found")
    expect(error.message).toStartWith("No zone of the Cloudflare account default holds app.other.net;")
  })
})

describe("route edit refusals: the arguments", () => {
  test.each([
    ["a service that is not allowed", { service: "hello_world" }, "service"],
    ["a service that is not a URL", { service: "localhost:8080" }, "service"],
    ["an empty `replaces`", { replaces: "" }, "replaces"],
    ["a `replaces` over 300 characters", { replaces: `http://${"a".repeat(300)}` }, "replaces"],
    ["a bad tunnel id", { tunnel: "nope" }, "tunnel"],
    ["a path with a control character", { path: "a\nb" }, "path"],
    ["an empty path", { path: "" }, "path"],
  ])("refuses %s before any request", async (_what, change, field) => {
    const { tool, requests } = editFor()

    expect(await refusalOf(invoke(tool, { ...ARGS, ...change }, CTX))).toContain(field)
    expect(requests).toEqual([])
  })

  test.each([
    ["a wildcard", "*.example.com", "a wildcard `*` is not allowed here"],
    ["a name without a dot", "app", "it needs at least one dot, as in mail.example.com"],
  ])("refuses %s as the hostname before any request", async (_what, hostname, problem) => {
    const { tool, requests } = editFor()

    expect(await refusalOf(invoke(tool, { ...ARGS, hostname }, CTX))).toBe(
      `\`hostname\` must be a hostname: ${problem}.`,
    )
    expect(requests).toEqual([])
  })

  test("refuses a missing `replaces` or `service` and an unknown argument before any request", async () => {
    const { tool, requests } = editFor()
    const { replaces: _replaces, ...withoutReplaces } = ARGS
    const { service: _service, ...withoutService } = ARGS

    expect(await refusalOf(invoke(tool, withoutReplaces, CTX))).toContain("replaces")
    expect(await refusalOf(invoke(tool, withoutService, CTX))).toContain("service")
    expect(await refusalOf(invoke(tool, { ...ARGS, force: true }, CTX))).toContain("force: unknown argument")
    expect(requests).toEqual([])
  })

  test("accepts a `replaces` of exactly 300 characters", () => {
    const replaces = `http://${"a".repeat(293)}`

    expect(replaces).toHaveLength(300)
    expect(editFor().tool.input.safeParse({ ...ARGS, replaces }).success).toBe(true)
  })
})
