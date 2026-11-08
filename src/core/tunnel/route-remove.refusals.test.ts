import { describe, expect, test } from "bun:test"
import { toolError } from "../cloudflare/client.fixtures"
import { fail, ok } from "../cloudflare/testing"
import { invoke } from "../tool"
import {
  CTX,
  HOSTNAME,
  SERVICE,
  TUNNEL_ENTRY,
  TUNNEL_ID,
  TUNNEL_NAME,
  refusalOf,
  removeFor,
  tunnelRoute,
  writes,
} from "./route.fixtures"

const ARGS = { tunnel: TUNNEL_ID, hostname: HOSTNAME }

/** Calls the tool and returns the error it ends with, having sent no write. */
async function refusal(args: object, ...routes: Parameters<typeof removeFor>) {
  const { tool, requests } = removeFor(...routes)
  const error = await toolError(invoke(tool, args, CTX))
  expect(writes(requests)).toEqual([])
  return error
}

describe("route remove refusals", () => {
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

  test.each([
    ["a locally managed", { ...TUNNEL_ENTRY, config_src: "local" }],
    ["a tunnel that does not say how it is managed", { id: TUNNEL_ID, name: TUNNEL_NAME }],
  ])("refuses %s tunnel", async (_what, entry) => {
    const error = await refusal(ARGS, tunnelRoute(ok(entry)))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toStartWith(`Tunnel ${TUNNEL_NAME} is managed in a config file on the machine that runs it;`)
  })

  test("refuses a deleted tunnel as not found, and passes on a tunnel that does not exist", async () => {
    const deleted = await refusal(ARGS, tunnelRoute(ok({ ...TUNNEL_ENTRY, deleted_at: "2024-05-01T00:00:00Z" })))
    const missing = await refusal(ARGS, tunnelRoute(fail(404, [{ code: 1003, message: "Tunnel not found" }])))

    expect(deleted.code).toBe("not_found")
    expect(deleted.message).toBe(`Tunnel ${TUNNEL_ID} is deleted.`)
    expect(missing.code).toBe("not_found")
  })

  test("refuses a hostname in no zone of the account", async () => {
    const error = await refusal({ ...ARGS, hostname: "app.other.net" })

    expect(error.code).toBe("not_found")
  })

  test("refuses invalid arguments before any request", async () => {
    const { tool, requests } = removeFor()

    expect(await refusalOf(invoke(tool, { ...ARGS, hostname: "*.example.com" }, CTX))).toContain("wildcard")
    expect(await refusalOf(invoke(tool, { ...ARGS, tunnel: "nope" }, CTX))).toContain("tunnel")
    expect(await refusalOf(invoke(tool, { ...ARGS, path: "a\nb" }, CTX))).toContain("path")
    expect(await refusalOf(invoke(tool, { ...ARGS, service: SERVICE }, CTX))).toContain("service: unknown argument")
    expect(requests).toEqual([])
  })
})
