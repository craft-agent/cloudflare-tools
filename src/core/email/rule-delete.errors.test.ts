import { describe, expect, test } from "bun:test"
import { rejection, toolError } from "../cloudflare/client.fixtures"
import { fail, ok, type FakeReply, type FakeRoute } from "../cloudflare/testing"
import { isAbortError, isToolError, type ErrorCode } from "../errors"
import { invoke, type ToolContext } from "../tool"
import {
  CATCH_ALL_PATH,
  CATCH_ALL_RULE,
  CURRENT_RULE,
  DELETE_ARGS,
  RULE_ID,
  RULE_PATH,
  catchAllRoute,
  removeRoute,
  ruleDeleteFor,
  ruleRoute,
} from "./rule.current.fixtures"
import { CTX, calls, dropped, sent } from "./rule.fixtures"

const DENIED = fail(403, [{ code: 10000, message: "Authentication error" }])
const REFUSED = { code: 9005, message: "Content is invalid" }
const NOTHING_CHANGED = " Nothing was changed."
const MAYBE =
  "Cloudflare may or may not have deleted the rule; read cloudflare_email_read rules before sending it again."
const CHANGED = `Rule ${RULE_ID} changed while waiting for the answer. Nothing was changed; read the rules again before trying again.`

const CONFIRMED: ToolContext = { ...CTX, confirm: async () => true }

/** A rule route that answers the first read with the rule as it is, and every later one with `later`. */
function changingRoute(later: FakeReply) {
  let reads = 0
  return ruleRoute(() => (reads++ === 0 ? ok(CURRENT_RULE) : later))
}

describe("cloudflareEmailRuleDelete: a rule it does not delete", () => {
  test.each<[string, FakeRoute, ErrorCode, string]>([
    [
      "an unknown rule",
      ruleRoute(fail(404, [{ code: 1004, message: "Not found" }])),
      "not_found",
      `${RULE_ID} is not a routing rule of example.com; cloudflare_email_read rules lists them.`,
    ],
    [
      "the catch-all",
      ruleRoute(ok(CATCH_ALL_RULE)),
      "invalid_argument",
      `${RULE_ID} is the zone's catch-all; cloudflare_email_catchall_edit changes it.`,
    ],
    [
      "a Wrangler rule",
      ruleRoute(ok({ ...CURRENT_RULE, source: "wrangler" })),
      "invalid_argument",
      `Rule ${RULE_ID} is managed by a Worker's Wrangler configuration, and its next deploy would undo the change; change it there.`,
    ],
    [
      "a rule of an unusual shape",
      ruleRoute(ok({ ...CURRENT_RULE, actions: [] })),
      "invalid_argument",
      `Rule ${RULE_ID} has a shape these tools do not change; change it in the dashboard.`,
    ],
  ])("refuses %s, reading nothing more and sending no delete", async (_what, route, code, message) => {
    const { tool, requests } = ruleDeleteFor(route)

    const error = await toolError(invoke(tool, DELETE_ARGS, CONFIRMED))

    expect(error.code).toBe(code)
    expect(error.message).toBe(`${message}${NOTHING_CHANGED}`)
    expect(calls(requests)).toEqual(["GET /zones", `GET ${RULE_PATH}`])
  })

  test("names the Rules Read permission when the rule cannot be read", async () => {
    const { tool, requests } = ruleDeleteFor(ruleRoute(DENIED))

    const error = await toolError(invoke(tool, DELETE_ARGS, CTX))

    expect(error.code).toBe("forbidden")
    expect(error.message).toBe("10000: Authentication error. The token needs Zone → Email Routing Rules → Read.")
    expect(sent(requests, "DELETE")).toHaveLength(0)
  })
})

describe("cloudflareEmailRuleDelete: declined", () => {
  test("is declined when the person says no, and nothing more is sent", async () => {
    const { tool, requests } = ruleDeleteFor()

    const error = await toolError(invoke(tool, DELETE_ARGS, { ...CTX, confirm: async () => false }))

    expect(error.code).toBe("declined")
    expect(error.message).toStartWith("cloudflare_email_rule_delete was declined: Delete the routing rule")
    expect(calls(requests)).toEqual(["GET /zones", `GET ${RULE_PATH}`, `GET ${CATCH_ALL_PATH}`])
  })
})

describe("cloudflareEmailRuleDelete: the rule changes while the person answers", () => {
  test.each([
    ["has another action", ok({ ...CURRENT_RULE, actions: [{ type: "drop" }] })],
    ["has another name", ok({ ...CURRENT_RULE, name: "Renamed" })],
    ["is turned off", ok({ ...CURRENT_RULE, enabled: false })],
    ["is gone", fail(404, [{ code: 1004, message: "Not found" }])],
    ["is now managed by Wrangler", ok({ ...CURRENT_RULE, source: "wrangler" })],
    ["has become the catch-all", ok({ ...CURRENT_RULE, matchers: [{ type: "all" }] })],
  ])("refuses it as stale when it %s, and sends no delete", async (_what, later) => {
    const { tool, requests } = ruleDeleteFor(changingRoute(later))

    const error = await toolError(invoke(tool, DELETE_ARGS, CONFIRMED))

    expect(error.code).toBe("stale")
    expect(error.message).toBe(CHANGED)
    expect(sent(requests, "DELETE")).toHaveLength(0)
  })

  test("deletes when the second read is the rule as approved", async () => {
    const { tool, requests } = ruleDeleteFor(changingRoute(ok({ ...CURRENT_RULE })))

    await invoke(tool, DELETE_ARGS, CONFIRMED)

    expect(sent(requests, "DELETE")).toHaveLength(1)
  })

  test("passes a failed second read on as it is, with no delete sent", async () => {
    const { tool, requests } = ruleDeleteFor(changingRoute(DENIED))

    const error = await toolError(invoke(tool, DELETE_ARGS, CONFIRMED))

    expect(error.code).toBe("forbidden")
    expect(sent(requests, "DELETE")).toHaveLength(0)
  })

  test("reads the rule only once when the harness's approval stands in for the question", async () => {
    const { tool, requests } = ruleDeleteFor(changingRoute(ok({ ...CURRENT_RULE, name: "Renamed" })))

    await invoke(tool, DELETE_ARGS, CTX)

    expect(sent(requests, "DELETE")).toHaveLength(1)
    expect(requests.filter((request) => request.path === RULE_PATH && request.method === "GET")).toHaveLength(1)
  })
})

describe("cloudflareEmailRuleDelete: the delete fails", () => {
  test.each([
    [400, "invalid_argument"],
    [404, "not_found"],
    [429, "rate_limited"],
    [409, "upstream_error"],
  ] as const)("keeps the code of a %p and says nothing was changed", async (status, code) => {
    const { tool, requests } = ruleDeleteFor(removeRoute(fail(status, [REFUSED])))

    const error = await toolError(invoke(tool, DELETE_ARGS, CTX))

    expect(error.code).toBe(code)
    expect(error.message).toStartWith(
      status === 409 ? "Cloudflare answered HTTP 409: 9005: Content is invalid" : "9005",
    )
    expect(error.message).toEndWith(NOTHING_CHANGED)
    expect(sent(requests, "DELETE")).toHaveLength(1)
  })

  test("names the Edit permission when forbidden, before the note", async () => {
    const { tool } = ruleDeleteFor(removeRoute(DENIED))

    const error = await toolError(invoke(tool, DELETE_ARGS, CTX))

    expect(error.code).toBe("forbidden")
    expect(error.message).toBe(
      `10000: Authentication error. The token needs Zone → Email Routing Rules → Edit.${NOTHING_CHANGED}`,
    )
  })

  test("says Cloudflare may or may not have deleted the rule after a 500", async () => {
    const { tool } = ruleDeleteFor(removeRoute(fail(500, [{ code: 1000, message: "Down" }])))

    const error = await toolError(invoke(tool, DELETE_ARGS, CTX))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe(`Cloudflare answered HTTP 500: 1000: Down ${MAYBE}`)
  })

  test("says so too when the connection drops", async () => {
    const { tool, requests } = ruleDeleteFor(removeRoute(dropped))

    const error = await toolError(invoke(tool, DELETE_ARGS, CTX))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe(`Cloudflare could not be reached: connection reset ${MAYBE}`)
    expect(sent(requests, "DELETE")).toHaveLength(1)
  })
})

describe("cloudflareEmailRuleDelete: cancellation", () => {
  async function cancelledAt(route: Parameters<typeof ruleDeleteFor>[number]) {
    const controller = new AbortController()
    const { tool, requests } = ruleDeleteFor({ ...route, reply: () => (controller.abort(), ok({})) })
    const error = await rejection(invoke(tool, DELETE_ARGS, { ...CONFIRMED, signal: controller.signal }))
    return { error, requests }
  }

  test.each([
    ["the rule read", ruleRoute()],
    ["the catch-all read", catchAllRoute()],
    ["the delete", removeRoute()],
  ])("passes a cancellation during %s on untouched, and deletes nothing more", async (_what, route) => {
    const { error, requests } = await cancelledAt(route)

    expect(isAbortError(error)).toBe(true)
    expect(isToolError(error)).toBe(false)
    expect(sent(requests, "DELETE")).toHaveLength(route.method === "DELETE" ? 1 : 0)
  })

  test("passes a cancellation during the second read on", async () => {
    const controller = new AbortController()
    let reads = 0
    const route = ruleRoute(() => (reads++ === 0 ? ok(CURRENT_RULE) : (controller.abort(), ok(CURRENT_RULE))))
    const { tool, requests } = ruleDeleteFor(route)

    const error = await rejection(invoke(tool, DELETE_ARGS, { ...CONFIRMED, signal: controller.signal }))

    expect(isAbortError(error)).toBe(true)
    expect(sent(requests, "DELETE")).toHaveLength(0)
  })
})
