import { describe, expect, test } from "bun:test"
import { rejection, toolError } from "../cloudflare/client.fixtures"
import { fail, ok } from "../cloudflare/testing"
import { isAbortError, isToolError } from "../errors"
import { invoke, type ToolContext } from "../tool"
import {
  ARGS,
  CTX,
  NO_ENTRYPOINT,
  PHASE,
  RULES,
  calls,
  deleteFor,
  dropped,
  entrypointPath,
  entrypointRoute,
  ruleDeleteRoute,
  rulesetOf,
  writes,
} from "./delete.fixtures"

const DENIED = fail(403, [{ code: 10000, message: "Authentication error" }])
const REFUSED = { code: 9005, message: "Content is invalid" }
const NOTHING_CHANGED = " Nothing was changed."
const MAYBE =
  "Cloudflare may or may not have deleted the rule; read cloudflare_rules_read rules before sending it again."
const EDIT_HINT = "The token needs Zone → Dynamic URL Redirects → Edit."
const CONFIRMED: ToolContext = { ...CTX, confirm: async () => true }
const UNKNOWN_ID = "9".repeat(32)

describe("cloudflareRulesDelete: a rule it does not delete", () => {
  test("a phase with no entry point has no rules, and nothing is asked or sent", async () => {
    const { tool, requests } = deleteFor(NO_ENTRYPOINT)
    let asked = 0

    const error = await toolError(invoke(tool, ARGS, { ...CTX, confirm: async () => (asked++, true) }))

    expect(error.code).toBe("not_found")
    expect(error.message).toBe(`Single Redirects of example.com has no rules.${NOTHING_CHANGED}`)
    expect(calls(requests)).toEqual(["GET /zones", expect.stringContaining("/entrypoint")])
    expect(asked).toBe(0)
  })

  test("a rule the phase does not hold is not_found, and nothing is asked or sent", async () => {
    const { tool, requests } = deleteFor()
    let asked = 0

    const error = await toolError(
      invoke(tool, { ...ARGS, rule: UNKNOWN_ID }, { ...CTX, confirm: async () => (asked++, true) }),
    )

    expect(error.code).toBe("not_found")
    expect(error.message).toBe(`No rule ${UNKNOWN_ID} in Single Redirects of example.com.${NOTHING_CHANGED}`)
    expect(writes(requests)).toEqual([])
    expect(asked).toBe(0)
  })

  test("names the Read permission when the entry point is forbidden, and sends no write", async () => {
    const { tool, requests } = deleteFor(entrypointRoute(PHASE, DENIED))

    const error = await toolError(invoke(tool, ARGS, CTX))

    expect(error.code).toBe("forbidden")
    expect(error.message).toBe("10000: Authentication error. The token needs Zone → Dynamic URL Redirects → Read.")
    expect(writes(requests)).toEqual([])
  })

  test.each([ok(null), ok("none"), ok([]), ok({ rules: [] })])(
    "refuses an entry point reply that is not a ruleset with an id, and sends no write",
    async (reply) => {
      const { tool, requests } = deleteFor(entrypointRoute(PHASE, reply))

      const error = await toolError(invoke(tool, ARGS, CTX))

      expect(error.code).toBe("upstream_error")
      expect(error.message).toBe("Cloudflare returned an unexpected ruleset response.")
      expect(writes(requests)).toEqual([])
    },
  )

  test("a zone the account does not have is not_found, and nothing else is read", async () => {
    const { tool, requests } = deleteFor()

    const error = await toolError(invoke(tool, { ...ARGS, zone: "other.net" }, CTX))

    expect(error.code).toBe("not_found")
    expect(calls(requests)).toEqual(["GET /zones"])
  })
})

describe("cloudflareRulesDelete: the delete fails", () => {
  test.each([
    [400, "invalid_argument"],
    [404, "not_found"],
    [429, "rate_limited"],
    [409, "upstream_error"],
  ] as const)("keeps the code of a %p and says nothing was changed", async (status, code) => {
    const { tool, requests } = deleteFor(ruleDeleteRoute(fail(status, [REFUSED])))

    const error = await toolError(invoke(tool, ARGS, CTX))

    expect(error.code).toBe(code)
    expect(error.message).toStartWith(
      status === 409 ? "Cloudflare answered HTTP 409: 9005: Content is invalid" : "9005",
    )
    expect(error.message).toEndWith(NOTHING_CHANGED)
    expect(writes(requests)).toHaveLength(1)
  })

  test("a 400 reads as Cloudflare's message, a sentence, then the note", async () => {
    const { tool } = deleteFor(ruleDeleteRoute(fail(400, [REFUSED])))

    const error = await toolError(invoke(tool, ARGS, CTX))

    expect(error.message).toBe(`9005: Content is invalid.${NOTHING_CHANGED}`)
  })

  test("names the Edit permission when forbidden, before the note", async () => {
    const { tool } = deleteFor(ruleDeleteRoute(DENIED))

    const error = await toolError(invoke(tool, ARGS, CTX))

    expect(error.code).toBe("forbidden")
    expect(error.message).toBe(`10000: Authentication error. ${EDIT_HINT}${NOTHING_CHANGED}`)
  })

  test("says Cloudflare may or may not have deleted the rule after a 500", async () => {
    const { tool } = deleteFor(ruleDeleteRoute(fail(500, [{ code: 1000, message: "Down" }])))

    const error = await toolError(invoke(tool, ARGS, CTX))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe(`Cloudflare answered HTTP 500: 1000: Down. ${MAYBE}`)
  })

  test("says so too when the connection drops", async () => {
    const { tool, requests } = deleteFor(ruleDeleteRoute(dropped))

    const error = await toolError(invoke(tool, ARGS, CTX))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe(`Cloudflare could not be reached: connection reset. ${MAYBE}`)
    expect(writes(requests)).toHaveLength(1)
  })

  test.each([
    ["no result", ok(undefined)],
    ["a result that is not an object", ok("done")],
  ])("treats %s as an unexpected response that may have deleted the rule", async (_what, reply) => {
    const { tool } = deleteFor(ruleDeleteRoute(reply))

    const error = await toolError(invoke(tool, ARGS, CTX))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe(`Cloudflare returned an unexpected ruleset response. ${MAYBE}`)
  })
})

describe("cloudflareRulesDelete: cancellation", () => {
  test.each([
    ["the zone lookup", { method: "GET", path: "/zones" }, 0],
    ["the entry point read", entrypointRoute(PHASE, ok({})), 0],
    ["the delete", ruleDeleteRoute(), 1],
  ] as const)("passes a cancellation during %s on untouched, and deletes nothing more", async (_what, route, sent) => {
    const controller = new AbortController()
    const { tool, requests } = deleteFor({ ...route, reply: () => (controller.abort(), ok({})) })

    const error = await rejection(invoke(tool, ARGS, { ...CONFIRMED, signal: controller.signal }))

    expect(isAbortError(error)).toBe(true)
    expect(isToolError(error)).toBe(false)
    expect(writes(requests)).toHaveLength(sent)
  })

  test("passes a cancellation during the second read on", async () => {
    const controller = new AbortController()
    let reads = 0
    const { tool, requests } = deleteFor({
      method: "GET",
      path: entrypointPath(PHASE),
      reply: () => (reads++ === 0 ? rulesetOf(RULES) : (controller.abort(), rulesetOf(RULES))),
    })

    const error = await rejection(invoke(tool, ARGS, { ...CONFIRMED, signal: controller.signal }))

    expect(isAbortError(error)).toBe(true)
    expect(writes(requests)).toHaveLength(0)
  })
})
