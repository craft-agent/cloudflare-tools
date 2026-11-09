import { describe, expect, test } from "bun:test"
import { rejection, toolError } from "../cloudflare/client.fixtures"
import { fail, ok } from "../cloudflare/testing"
import { isAbortError, isToolError } from "../errors"
import { invoke } from "../tool"
import {
  ARGS,
  CTX,
  NEW_RULE_ID,
  NO_ENTRYPOINT,
  PHASE,
  addFor,
  calls,
  createRoute,
  dropped,
  entrypointRoute,
  ruleCreateRoute,
  writes,
} from "./add.fixtures"

const DENIED = fail(403, [{ code: 10000, message: "Authentication error" }])
const REFUSED = { code: 9005, message: "Content is invalid" }
const MAYBE = "Cloudflare may or may not have added the rule; read cloudflare_rules_read rules before sending it again."
const EDIT_HINT = "The token needs Zone → Dynamic URL Redirects → Edit."

describe("cloudflareRulesAdd: a read fails", () => {
  test("names the Read permission when the entry point is forbidden, and sends no write", async () => {
    const { tool, requests } = addFor(entrypointRoute(PHASE, DENIED))

    const error = await toolError(invoke(tool, ARGS, CTX))

    expect(error.code).toBe("forbidden")
    expect(error.message).toBe("10000: Authentication error. The token needs Zone → Dynamic URL Redirects → Read.")
    expect(writes(requests)).toEqual([])
  })

  test("names the permission of the phase asked for", async () => {
    const { tool } = addFor(entrypointRoute("http_request_origin", DENIED))

    const error = await toolError(invoke(tool, { ...ARGS, phase: "http_request_origin", action: "route" }, CTX))

    expect(error.message).toBe("10000: Authentication error. The token needs Zone → Origin → Read.")
  })

  test("keeps the code of a failed entry point read that is not a refusal, and sends no write", async () => {
    const { tool, requests } = addFor(entrypointRoute(PHASE, fail(500, [{ code: 1000, message: "Down" }])))

    const error = await toolError(invoke(tool, ARGS, CTX))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe("Cloudflare answered HTTP 500: 1000: Down")
    expect(writes(requests)).toEqual([])
  })

  test.each([ok(null), ok("none"), ok([]), ok({ rules: [] })])(
    "refuses an entry point reply that is not a ruleset with an id, and sends no write",
    async (reply) => {
      const { tool, requests } = addFor(entrypointRoute(PHASE, reply))

      const error = await toolError(invoke(tool, ARGS, CTX))

      expect(error.code).toBe("upstream_error")
      expect(error.message).toBe("Cloudflare returned an unexpected ruleset response.")
      expect(writes(requests)).toEqual([])
    },
  )

  test("a zone the account does not have is not_found, and nothing else is read", async () => {
    const { tool, requests } = addFor()

    const error = await toolError(invoke(tool, { ...ARGS, zone: "other.net" }, CTX))

    expect(error.code).toBe("not_found")
    expect(calls(requests)).toEqual(["GET /zones"])
  })
})

describe("cloudflareRulesAdd: the write fails", () => {
  const WRITES = [
    ["adding to an entry point", []],
    ["creating the entry point", [NO_ENTRYPOINT]],
  ] as const

  const REFUSALS = WRITES.flatMap(([what, before]) =>
    (
      [
        [400, "invalid_argument"],
        [404, "not_found"],
        [429, "rate_limited"],
        [409, "upstream_error"],
      ] as const
    ).map(([status, code]) => [what, before, status, code] as const),
  )

  test.each(REFUSALS)("%s: a %p keeps its code and says nothing was changed", async (_what, before, status, code) => {
    const refused = fail(status, [REFUSED])
    const { tool, requests } = addFor(...before, ruleCreateRoute(refused), createRoute(refused))

    const error = await toolError(invoke(tool, ARGS, CTX))

    expect(error.code).toBe(code)
    expect(error.message).toStartWith(
      status === 409 ? "Cloudflare answered HTTP 409: 9005: Content is invalid" : "9005",
    )
    expect(error.message).toEndWith(" Nothing was changed.")
    expect(writes(requests)).toHaveLength(1)
  })

  test("a 400 reads as Cloudflare's message, a sentence, then the note", async () => {
    const { tool } = addFor(ruleCreateRoute(fail(400, [REFUSED])))

    const error = await toolError(invoke(tool, ARGS, CTX))

    expect(error.message).toBe("9005: Content is invalid. Nothing was changed.")
  })

  test.each(WRITES)("%s: names the Edit permission when forbidden, before the note", async (_what, before) => {
    const { tool } = addFor(...before, ruleCreateRoute(DENIED), createRoute(DENIED))

    const error = await toolError(invoke(tool, ARGS, CTX))

    expect(error.code).toBe("forbidden")
    expect(error.message).toBe(`10000: Authentication error. ${EDIT_HINT} Nothing was changed.`)
  })

  test.each(WRITES)("%s: says Cloudflare may or may not have added the rule after a 500", async (_what, before) => {
    const down = fail(500, [{ code: 1000, message: "Down" }])
    const { tool } = addFor(...before, ruleCreateRoute(down), createRoute(down))

    const error = await toolError(invoke(tool, ARGS, CTX))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe(`Cloudflare answered HTTP 500: 1000: Down. ${MAYBE}`)
  })

  test.each(WRITES)("%s: says so too when the connection drops", async (_what, before) => {
    const { tool, requests } = addFor(...before, ruleCreateRoute(dropped), createRoute(dropped))

    const error = await toolError(invoke(tool, ARGS, CTX))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe(`Cloudflare could not be reached: connection reset. ${MAYBE}`)
    expect(writes(requests)).toHaveLength(1)
  })

  test.each([
    ["no result", ok(undefined)],
    ["a result that is not an object", ok("done")],
  ])("treats %s as an unexpected response that may have added the rule", async (_what, reply) => {
    const { tool } = addFor(ruleCreateRoute(reply))

    const error = await toolError(invoke(tool, ARGS, CTX))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe(`Cloudflare returned an unexpected ruleset response. ${MAYBE}`)
  })
})

describe("cloudflareRulesAdd: cancellation", () => {
  async function cancelledAt(route: Parameters<typeof addFor>[number]) {
    const controller = new AbortController()
    const { tool, requests } = addFor({ ...route, reply: () => (controller.abort(), ok({})) })
    const error = await rejection(invoke(tool, ARGS, { ...CTX, signal: controller.signal }))
    return { error, requests }
  }

  test.each([
    ["the zone lookup", { method: "GET", path: "/zones" }, 0],
    ["the entry point read", entrypointRoute(PHASE, ok({})), 0],
    ["the write", ruleCreateRoute(), 1],
  ] as const)("passes a cancellation during %s on untouched", async (_what, route, sentWrites) => {
    const { error, requests } = await cancelledAt(route as Parameters<typeof addFor>[number])

    expect(isAbortError(error)).toBe(true)
    expect(isToolError(error)).toBe(false)
    expect(writes(requests)).toHaveLength(sentWrites)
  })
})

test("cloudflareRulesAdd reads the zone and the phase once each, then writes", async () => {
  const { tool, requests } = addFor()

  const result = await invoke(tool, ARGS, CTX)

  expect(result.rule.after?.id).toBe(NEW_RULE_ID)
  expect(calls(requests).filter((call) => call.startsWith("GET"))).toHaveLength(2)
})
