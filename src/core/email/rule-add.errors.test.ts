import { describe, expect, test } from "bun:test"
import { rejection, toolError } from "../cloudflare/client.fixtures"
import { fail, ok } from "../cloudflare/testing"
import { isAbortError, isToolError } from "../errors"
import { invoke } from "../tool"
import {
  ADDRESSES_PATH,
  ARGS,
  CTX,
  NEW_RULE_ID,
  ROUTING_PATH,
  RULES_PATH,
  TO,
  addressRow,
  addressesRoute,
  calls,
  createRoute,
  dropped,
  paged,
  routingRoute,
  ruleAddFor,
  ruleRow,
  rulesRoute,
  sent,
} from "./rule.fixtures"

const DENIED = fail(403, [{ code: 10000, message: "Authentication error" }])
const REFUSED = { code: 9005, message: "Content is invalid" }
const MAYBE = "Cloudflare may or may not have added the rule; read cloudflare_email_read rules before sending it again."

describe("cloudflareEmailRuleAdd: a read fails", () => {
  test("names the Rules Read permission when the rules cannot be read, and sends no write", async () => {
    const { tool, requests } = ruleAddFor(rulesRoute(DENIED))

    const error = await toolError(invoke(tool, ARGS, CTX))

    expect(error.code).toBe("forbidden")
    expect(error.message).toBe("10000: Authentication error. The token needs Zone → Email Routing Rules → Read.")
    expect(sent(requests, "POST")).toHaveLength(0)
  })

  test("names the Addresses Read permission when a forward cannot be checked, and sends no write", async () => {
    const { tool, requests } = ruleAddFor(addressesRoute(DENIED))

    const error = await toolError(invoke(tool, ARGS, CTX))

    expect(error.code).toBe("forbidden")
    expect(error.message).toBe(
      "10000: Authentication error. The token needs Account → Email Routing Addresses → Read to check the forward.",
    )
    expect(sent(requests, "POST")).toHaveLength(0)
  })

  test("does not need the Addresses permission for a drop", async () => {
    const { tool } = ruleAddFor(addressesRoute(DENIED))

    const result = await invoke(tool, { ...ARGS, action: { type: "drop" } }, CTX)

    expect(result.rule.after.id).toBe(NEW_RULE_ID)
  })

  test.each([
    ["rules", rulesRoute(ok({})), "Cloudflare returned an unexpected routing rules response."],
    ["addresses", addressesRoute(ok("none")), "Cloudflare returned an unexpected destination addresses response."],
  ])("refuses a reply of the %s that is not a list, and sends no write", async (_what, route, message) => {
    const { tool, requests } = ruleAddFor(route)

    const error = await toolError(invoke(tool, ARGS, CTX))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe(message)
    expect(sent(requests, "POST")).toHaveLength(0)
  })

  test("a zone the account does not have is not_found, and nothing else is read", async () => {
    const { tool, requests } = ruleAddFor()

    const error = await toolError(invoke(tool, { ...ARGS, zone: "other.net" }, CTX))

    expect(error.code).toBe("not_found")
    expect(calls(requests)).toEqual(["GET /zones"])
  })
})

describe("cloudflareEmailRuleAdd: more pages than are read", () => {
  const FULL = [[ruleRow("a@example.com")]]

  test("refuses a zone with more than five pages of rules that has no rule for the address", async () => {
    const { tool, requests } = ruleAddFor(rulesRoute(paged(Array.from({ length: 6 }, () => FULL[0]!))))

    const error = await toolError(invoke(tool, ARGS, CTX))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe("The zone has more routing rules than this tool reads.")
    expect(requests.filter((request) => request.path === RULES_PATH && request.method === "GET")).toHaveLength(5)
    expect(sent(requests, "POST")).toHaveLength(0)
  })

  test("reads exactly five pages of rules and goes on when none matches", async () => {
    const { tool, requests } = ruleAddFor(rulesRoute(paged(Array.from({ length: 5 }, () => FULL[0]!))))

    const result = await invoke(tool, ARGS, CTX)

    expect(result.rule.after.id).toBe(NEW_RULE_ID)
    expect(requests.filter((request) => request.path === RULES_PATH && request.method === "GET")).toHaveLength(5)
  })

  test("finds a rule on the fifth page of six", async () => {
    const pages = [[], [], [], [], [ruleRow(TO)], []]
    const { tool } = ruleAddFor(rulesRoute(paged(pages)))

    const error = await toolError(invoke(tool, ARGS, CTX))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("already has a routing rule")
  })

  test("refuses an account with more than five pages of destination addresses that lacks the address", async () => {
    const { tool, requests } = ruleAddFor(
      addressesRoute(paged(Array.from({ length: 6 }, () => [addressRow("someone@example.net")]))),
    )

    const error = await toolError(invoke(tool, ARGS, CTX))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe("The account has more destination addresses than this tool reads.")
    expect(requests.filter((request) => request.path === ADDRESSES_PATH)).toHaveLength(5)
    expect(sent(requests, "POST")).toHaveLength(0)
  })
})

describe("cloudflareEmailRuleAdd: the write fails", () => {
  test.each([
    [400, "invalid_argument"],
    [404, "not_found"],
    [429, "rate_limited"],
    [409, "upstream_error"],
  ] as const)("keeps the code of a %p and says nothing was changed", async (status, code) => {
    const { tool, requests } = ruleAddFor(createRoute(fail(status, [REFUSED])))

    const error = await toolError(invoke(tool, ARGS, CTX))

    expect(error.code).toBe(code)
    expect(error.message).toStartWith(
      status === 409 ? "Cloudflare answered HTTP 409: 9005: Content is invalid" : "9005",
    )
    expect(error.message).toEndWith(" Nothing was changed.")
    expect(sent(requests, "POST")).toHaveLength(1)
  })

  test("names the Edit permission when forbidden, before the note", async () => {
    const { tool } = ruleAddFor(createRoute(DENIED))

    const error = await toolError(invoke(tool, ARGS, CTX))

    expect(error.code).toBe("forbidden")
    expect(error.message).toBe(
      "10000: Authentication error. The token needs Zone → Email Routing Rules → Edit. Nothing was changed.",
    )
  })

  test("says Cloudflare may or may not have added the rule after a 500", async () => {
    const { tool } = ruleAddFor(createRoute(fail(500, [{ code: 1000, message: "Down" }])))

    const error = await toolError(invoke(tool, ARGS, CTX))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe(`Cloudflare answered HTTP 500: 1000: Down ${MAYBE}`)
  })

  test("says so too when the connection drops", async () => {
    const { tool, requests } = ruleAddFor(createRoute(dropped))

    const error = await toolError(invoke(tool, ARGS, CTX))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe(`Cloudflare could not be reached: connection reset ${MAYBE}`)
    expect(sent(requests, "POST")).toHaveLength(1)
  })

  test.each([
    ["no result", ok(undefined)],
    ["a result that is not an object", ok("done")],
    ["a rule without an id", ok({ name: "x" })],
  ])("treats %s as an unexpected response that may have added the rule", async (_what, reply) => {
    const { tool } = ruleAddFor(createRoute(reply))

    const error = await toolError(invoke(tool, ARGS, CTX))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe(`Cloudflare returned an unexpected routing rule response. ${MAYBE}`)
  })
})

test("cloudflareEmailRuleAdd reads the settings, the rules and the destination once each, then writes", async () => {
  const { tool, requests } = ruleAddFor()

  await invoke(tool, ARGS, CTX)

  expect(calls(requests)).toEqual([
    "GET /zones",
    `GET ${ROUTING_PATH}`,
    `GET ${RULES_PATH}`,
    `GET ${ADDRESSES_PATH}`,
    `POST ${RULES_PATH}`,
  ])
})

describe("cloudflareEmailRuleAdd: cancellation", () => {
  async function cancelledAt(route: Parameters<typeof ruleAddFor>[number]) {
    const controller = new AbortController()
    const withAbort = { ...route, reply: () => (controller.abort(), ok({})) }
    const { tool, requests } = ruleAddFor(withAbort)
    const error = await rejection(invoke(tool, ARGS, { ...CTX, signal: controller.signal }))
    return { error, requests }
  }

  test.each([
    ["the settings read", routingRoute()],
    ["the rules read", rulesRoute()],
    ["the destination read", addressesRoute()],
    ["the write", createRoute()],
  ])("passes a cancellation during %s on untouched, and writes nothing more", async (_what, route) => {
    const { error, requests } = await cancelledAt(route)

    expect(isAbortError(error)).toBe(true)
    expect(isToolError(error)).toBe(false)
    expect(sent(requests, "POST")).toHaveLength(route.method === "POST" ? 1 : 0)
  })
})
