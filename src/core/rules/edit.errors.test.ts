import { describe, expect, test } from "bun:test"
import { rejection, toolError } from "../cloudflare/client.fixtures"
import { fail, ok } from "../cloudflare/testing"
import { isAbortError, isToolError } from "../errors"
import { invoke } from "../tool"
import {
  ARGS,
  CTX,
  FIRST_ID,
  PHASE,
  calls,
  dropped,
  editFor,
  editPath,
  entrypointRoute,
  ruleEditRoute,
  writes,
} from "./edit.fixtures"

const DENIED = fail(403, [{ code: 10000, message: "Authentication error" }])
const REFUSED = { code: 9005, message: "Content is invalid" }
const MAYBE =
  "Cloudflare may or may not have changed the rule; read cloudflare_rules_read rules before sending it again."
const EDIT_HINT = "The token needs Zone → Dynamic URL Redirects → Edit."

describe("cloudflareRulesEdit: a read fails", () => {
  test("names the Read permission when the entry point is forbidden, and sends no write", async () => {
    const { tool, requests } = editFor(entrypointRoute(PHASE, DENIED))

    const error = await toolError(invoke(tool, ARGS, CTX))

    expect(error.code).toBe("forbidden")
    expect(error.message).toBe("10000: Authentication error. The token needs Zone → Dynamic URL Redirects → Read.")
    expect(writes(requests)).toEqual([])
  })

  test("keeps the code of an entry point read that fails otherwise, and sends no write", async () => {
    const { tool, requests } = editFor(entrypointRoute(PHASE, fail(500, [{ code: 1000, message: "Down" }])))

    const error = await toolError(invoke(tool, ARGS, CTX))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe("Cloudflare answered HTTP 500: 1000: Down")
    expect(writes(requests)).toEqual([])
  })

  test.each([ok(null), ok("none"), ok([]), ok({ rules: [] })])(
    "refuses an entry point reply that is not a ruleset with an id, and sends no write",
    async (reply) => {
      const { tool, requests } = editFor(entrypointRoute(PHASE, reply))

      const error = await toolError(invoke(tool, ARGS, CTX))

      expect(error.code).toBe("upstream_error")
      expect(error.message).toBe("Cloudflare returned an unexpected ruleset response.")
      expect(writes(requests)).toEqual([])
    },
  )

  test("a zone the account does not have is not_found, and nothing else is read", async () => {
    const { tool, requests } = editFor()

    const error = await toolError(invoke(tool, { ...ARGS, zone: "other.net" }, CTX))

    expect(error.code).toBe("not_found")
    expect(calls(requests)).toEqual(["GET /zones"])
  })
})

describe("cloudflareRulesEdit: the write fails", () => {
  test.each([
    [400, "invalid_argument"],
    [404, "not_found"],
    [429, "rate_limited"],
    [409, "upstream_error"],
  ] as const)("a %p keeps its code and says nothing was changed", async (status, code) => {
    const { tool, requests } = editFor(ruleEditRoute(fail(status, [REFUSED])))

    const error = await toolError(invoke(tool, ARGS, CTX))

    expect(error.code).toBe(code)
    expect(error.message).toStartWith(
      status === 409 ? "Cloudflare answered HTTP 409: 9005: Content is invalid" : "9005",
    )
    expect(error.message).toEndWith(" Nothing was changed.")
    expect(writes(requests)).toHaveLength(1)
  })

  test("a 400 reads as Cloudflare's message, a sentence, then the note", async () => {
    const { tool } = editFor(ruleEditRoute(fail(400, [REFUSED])))

    const error = await toolError(invoke(tool, ARGS, CTX))

    expect(error.message).toBe("9005: Content is invalid. Nothing was changed.")
  })

  test("names the Edit permission when forbidden, before the note", async () => {
    const { tool } = editFor(ruleEditRoute(DENIED))

    const error = await toolError(invoke(tool, ARGS, CTX))

    expect(error.code).toBe("forbidden")
    expect(error.message).toBe(`10000: Authentication error. ${EDIT_HINT} Nothing was changed.`)
  })

  test("says Cloudflare may or may not have changed the rule after a 500", async () => {
    const { tool } = editFor(ruleEditRoute(fail(500, [{ code: 1000, message: "Down" }])))

    const error = await toolError(invoke(tool, ARGS, CTX))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe(`Cloudflare answered HTTP 500: 1000: Down. ${MAYBE}`)
  })

  test("says so too when the connection drops", async () => {
    const { tool, requests } = editFor(ruleEditRoute(dropped))

    const error = await toolError(invoke(tool, ARGS, CTX))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe(`Cloudflare could not be reached: connection reset. ${MAYBE}`)
    expect(writes(requests)).toHaveLength(1)
  })

  test.each([
    ["no result", ok(undefined)],
    ["a result that is not an object", ok("done")],
  ])("treats %s as an unexpected response that may have changed the rule", async (_what, reply) => {
    const { tool } = editFor(ruleEditRoute(reply))

    const error = await toolError(invoke(tool, ARGS, CTX))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe(`Cloudflare returned an unexpected ruleset response. ${MAYBE}`)
  })
})

describe("cloudflareRulesEdit: cancellation", () => {
  test.each([
    ["the zone lookup", { method: "GET", path: "/zones" }, 0],
    ["the entry point read", entrypointRoute(PHASE, ok({})), 0],
    ["the write", ruleEditRoute(), 1],
  ] as const)("passes a cancellation during %s on untouched", async (_what, route, sentWrites) => {
    const controller = new AbortController()
    const { tool, requests } = editFor({ ...route, reply: () => (controller.abort(), ok({})) })

    const error = await rejection(invoke(tool, ARGS, { ...CTX, signal: controller.signal }))

    expect(isAbortError(error)).toBe(true)
    expect(isToolError(error)).toBe(false)
    expect(writes(requests)).toHaveLength(sentWrites)
  })
})

test("cloudflareRulesEdit reads the zone and the phase once each, then patches the rule", async () => {
  const { tool, requests } = editFor()

  await invoke(tool, ARGS, CTX)

  expect(calls(requests).filter((call) => call.startsWith("GET"))).toHaveLength(2)
  expect(calls(requests).at(-1)).toBe(`PATCH ${editPath(FIRST_ID)}`)
})
