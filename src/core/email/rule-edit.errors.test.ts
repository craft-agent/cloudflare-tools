import { describe, expect, test } from "bun:test"
import { rejection, toolError } from "../cloudflare/client.fixtures"
import { fail, ok } from "../cloudflare/testing"
import { isAbortError, isToolError } from "../errors"
import { invoke } from "../tool"
import { EDIT_BASE, OTHER_DESTINATION, replaceRoute, ruleEditFor, ruleRoute } from "./rule.current.fixtures"
import { CTX, addressesRoute, dropped, routingRoute, rulesRoute, sent } from "./rule.fixtures"

const DENIED = fail(403, [{ code: 10000, message: "Authentication error" }])
const REFUSED = { code: 9005, message: "Content is invalid" }
const MAYBE =
  "Cloudflare may or may not have changed the rule; read cloudflare_email_read rules before sending it again."

describe("cloudflareEmailRuleEdit: a read fails", () => {
  test("names the Rules Read permission when the rule cannot be read, and sends no write", async () => {
    const { tool, requests } = ruleEditFor(ruleRoute(DENIED))

    const error = await toolError(invoke(tool, { ...EDIT_BASE, name: "x" }, CTX))

    expect(error.code).toBe("forbidden")
    expect(error.message).toBe("10000: Authentication error. The token needs Zone → Email Routing Rules → Read.")
    expect(sent(requests, "PUT")).toHaveLength(0)
  })

  test("names the Rules Read permission when the rules cannot be listed for a new address", async () => {
    const { tool, requests } = ruleEditFor(rulesRoute(DENIED))

    const error = await toolError(invoke(tool, { ...EDIT_BASE, to: "support" }, CTX))

    expect(error.code).toBe("forbidden")
    expect(error.message).toContain("Zone → Email Routing Rules → Read")
    expect(sent(requests, "PUT")).toHaveLength(0)
  })

  test("names the Addresses Read permission when a new forward cannot be checked", async () => {
    const { tool, requests } = ruleEditFor(addressesRoute(DENIED))

    const error = await toolError(
      invoke(tool, { ...EDIT_BASE, action: { type: "forward", to: OTHER_DESTINATION } }, CTX),
    )

    expect(error.code).toBe("forbidden")
    expect(error.message).toBe(
      "10000: Authentication error. The token needs Account → Email Routing Addresses → Read to check the forward.",
    )
    expect(sent(requests, "PUT")).toHaveLength(0)
  })

  test("does not need the Addresses permission when the forward stays", async () => {
    const { tool } = ruleEditFor(addressesRoute(DENIED))

    const result = await invoke(tool, { ...EDIT_BASE, name: "Renamed" }, CTX)

    expect(result.rule.after.name).toBe("Renamed")
  })

  test("a rule read that fails is not turned into not_found", async () => {
    const { tool } = ruleEditFor(ruleRoute(fail(500, [{ code: 1000, message: "Down" }])))

    const error = await toolError(invoke(tool, { ...EDIT_BASE, name: "x" }, CTX))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe("Cloudflare answered HTTP 500: 1000: Down")
  })
})

describe("cloudflareEmailRuleEdit: the write fails", () => {
  test.each([
    [400, "invalid_argument"],
    [404, "not_found"],
    [429, "rate_limited"],
    [409, "upstream_error"],
  ] as const)("keeps the code of a %p and says nothing was changed", async (status, code) => {
    const { tool, requests } = ruleEditFor(replaceRoute(fail(status, [REFUSED])))

    const error = await toolError(invoke(tool, { ...EDIT_BASE, name: "x" }, CTX))

    expect(error.code).toBe(code)
    expect(error.message).toStartWith(
      status === 409 ? "Cloudflare answered HTTP 409: 9005: Content is invalid" : "9005",
    )
    expect(error.message).toEndWith(" Nothing was changed.")
    expect(sent(requests, "PUT")).toHaveLength(1)
  })

  test("names the Edit permission when forbidden, before the note", async () => {
    const { tool } = ruleEditFor(replaceRoute(DENIED))

    const error = await toolError(invoke(tool, { ...EDIT_BASE, name: "x" }, CTX))

    expect(error.code).toBe("forbidden")
    expect(error.message).toBe(
      "10000: Authentication error. The token needs Zone → Email Routing Rules → Edit. Nothing was changed.",
    )
  })

  test("says Cloudflare may or may not have changed the rule after a 500", async () => {
    const { tool } = ruleEditFor(replaceRoute(fail(500, [{ code: 1000, message: "Down" }])))

    const error = await toolError(invoke(tool, { ...EDIT_BASE, name: "x" }, CTX))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe(`Cloudflare answered HTTP 500: 1000: Down ${MAYBE}`)
  })

  test("says so too when the connection drops", async () => {
    const { tool, requests } = ruleEditFor(replaceRoute(dropped))

    const error = await toolError(invoke(tool, { ...EDIT_BASE, name: "x" }, CTX))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe(`Cloudflare could not be reached: connection reset ${MAYBE}`)
    expect(sent(requests, "PUT")).toHaveLength(1)
  })

  test.each([
    ["no result", ok(undefined)],
    ["a result that is not an object", ok("done")],
    ["a rule without an id", ok({ name: "x" })],
  ])("treats %s as an unexpected response that may have changed the rule", async (_what, reply) => {
    const { tool } = ruleEditFor(replaceRoute(reply))

    const error = await toolError(invoke(tool, { ...EDIT_BASE, name: "x" }, CTX))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe(`Cloudflare returned an unexpected routing rule response. ${MAYBE}`)
  })
})

describe("cloudflareEmailRuleEdit: cancellation", () => {
  const ARGS = { ...EDIT_BASE, to: "support", action: { type: "forward", to: OTHER_DESTINATION } }

  async function cancelledAt(route: Parameters<typeof ruleEditFor>[number]) {
    const controller = new AbortController()
    const { tool, requests } = ruleEditFor({ ...route, reply: () => (controller.abort(), ok({})) })
    const error = await rejection(invoke(tool, ARGS, { ...CTX, signal: controller.signal }))
    return { error, requests }
  }

  test.each([
    ["the rule read", ruleRoute()],
    ["the rules read", rulesRoute()],
    ["the destination read", addressesRoute()],
    ["the settings read", routingRoute()],
    ["the write", replaceRoute()],
  ])("passes a cancellation during %s on untouched, and writes nothing more", async (_what, route) => {
    const { error, requests } = await cancelledAt(route)

    expect(isAbortError(error)).toBe(true)
    expect(isToolError(error)).toBe(false)
    expect(sent(requests, "PUT")).toHaveLength(route.method === "PUT" ? 1 : 0)
  })
})
