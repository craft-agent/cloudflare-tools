import { describe, expect, test } from "bun:test"
import { rejection, toolError } from "../cloudflare/client.fixtures"
import { fail, ok } from "../cloudflare/testing"
import { isAbortError, isToolError } from "../errors"
import { invoke } from "../tool"
import {
  A_RECORD,
  API_RULE,
  CATCH_ALL,
  CONFIG,
  CTX,
  HOSTNAME,
  PUBLISHED_RULE,
  SERVICE,
  TUNNEL_CONFIG_PATH,
  TUNNEL_ID,
  VERSION,
  changing,
  configRoute,
  dropped,
  editFor,
  putRoute,
  recordsRoute,
  sent,
  writes,
} from "./route.fixtures"

const NEW_SERVICE = "http://localhost:9090"
const ARGS = { tunnel: TUNNEL_ID, hostname: HOSTNAME, service: NEW_SERVICE, replaces: SERVICE }
const REFUSED = { code: 9005, message: "Content is invalid" }
const PUBLISHED = [API_RULE, PUBLISHED_RULE, CATCH_ALL]

describe("route edit: the write fails", () => {
  test.each([
    [400, "invalid_argument"],
    [404, "not_found"],
    [429, "rate_limited"],
  ] as const)("keeps the code of a %p and says nothing was changed", async (status, code) => {
    const { tool, requests } = editFor(putRoute(fail(status, [REFUSED])))

    const error = await toolError(invoke(tool, ARGS, CTX))

    expect(error.code).toBe(code)
    expect(error.message).toBe(`9005: Content is invalid Nothing was changed.`)
    expect(sent(requests, "PUT")).toHaveLength(1)
  })

  test("names the Edit permission when forbidden, before the note", async () => {
    const { tool } = editFor(putRoute(fail(403, [{ code: 10000, message: "Authentication error" }])))

    const error = await toolError(invoke(tool, ARGS, CTX))

    expect(error.code).toBe("forbidden")
    expect(error.message).toBe(
      "10000: Authentication error. The token needs Account → Cloudflare Tunnel → Edit. Nothing was changed.",
    )
  })

  test.each([
    ["a 500", fail(500, [{ code: 1000, message: "Down" }]), "Cloudflare answered HTTP 500: 1000: Down "],
    ["a dropped connection", dropped, "Cloudflare could not be reached: connection reset "],
  ])("says Cloudflare may or may not have changed it after %s", async (_what, reply, failure) => {
    const { tool } = editFor(putRoute(reply))

    const error = await toolError(invoke(tool, ARGS, CTX))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe(
      `${failure}Cloudflare may or may not have changed the tunnel's configuration; read cloudflare_tunnel_read tunnel before sending it again.`,
    )
  })

  test("passes a cancellation during the write on untouched", async () => {
    const controller = new AbortController()
    const { tool } = editFor(
      putRoute(() => {
        controller.abort()
        return ok({})
      }),
    )

    const error = await rejection(invoke(tool, ARGS, { ...CTX, signal: controller.signal }))

    expect(isAbortError(error)).toBe(true)
    expect(isToolError(error)).toBe(false)
  })
})

describe("route edit: waiting for the answer", () => {
  const withAnswer = { ...CTX, confirm: async () => true }
  const config = (version: number, ingress: unknown[]) => ok({ version, config: { ...CONFIG, ingress } })

  test("reads the tunnel and its configuration a second time after an answer, and writes when nothing changed", async () => {
    const { tool, requests } = editFor()

    await invoke(tool, ARGS, withAnswer)

    expect(requests.filter((r) => r.method === "GET" && r.path === TUNNEL_CONFIG_PATH)).toHaveLength(2)
    expect(sent(requests, "PUT")).toHaveLength(1)
  })

  test("reads nothing a second time without an answer to wait for", async () => {
    const { tool, requests } = editFor()

    await invoke(tool, ARGS, CTX)

    expect(requests.filter((r) => r.method === "GET" && r.path === TUNNEL_CONFIG_PATH)).toHaveLength(1)
  })

  test.each([
    ["the version", changing(config(VERSION, PUBLISHED), config(VERSION + 1, PUBLISHED))],
    ["the rules, though not the version", changing(config(VERSION, PUBLISHED), config(VERSION, [CATCH_ALL]))],
    [
      "another rule's service, though not the version",
      changing(
        config(VERSION, PUBLISHED),
        config(VERSION, [{ ...API_RULE, service: "http://localhost:1" }, PUBLISHED_RULE, CATCH_ALL]),
      ),
    ],
  ])("refuses as stale, sending no write, when %s changed", async (_what, reply) => {
    const { tool, requests } = editFor(configRoute(reply))

    const error = await toolError(invoke(tool, ARGS, withAnswer))

    expect(error.code).toBe("stale")
    expect(error.message).toBe(
      "The tunnel's configuration changed while waiting for the answer. Nothing was changed; read it again before trying again.",
    )
    expect(writes(requests)).toEqual([])
  })

  test("writes all the same when only the DNS changed, since the call reads it for the report only", async () => {
    const { tool, requests } = editFor(recordsRoute(changing(ok([]), ok([A_RECORD]))))

    const result = await invoke(tool, ARGS, withAnswer)

    expect(sent(requests, "PUT")).toHaveLength(1)
    expect(result.dns).toEqual({ missing: true })
  })

  test("sends nothing when the person declines", async () => {
    const { tool, requests } = editFor()

    const error = await toolError(invoke(tool, ARGS, { ...CTX, confirm: async () => false }))

    expect(error.code).toBe("declined")
    expect(writes(requests)).toEqual([])
  })

  test("passes a cancellation during the second read on untouched, sending no write", async () => {
    const controller = new AbortController()
    let calls = 0
    const { tool, requests } = editFor(
      configRoute(() => {
        if (++calls === 2) controller.abort()
        return config(VERSION, PUBLISHED)
      }),
    )

    const error = await rejection(invoke(tool, ARGS, { ...withAnswer, signal: controller.signal }))

    expect(isAbortError(error)).toBe(true)
    expect(writes(requests)).toEqual([])
  })
})
