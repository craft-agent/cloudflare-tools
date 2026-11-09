import { describe, expect, test } from "bun:test"
import { rejection, toolError } from "../cloudflare/client.fixtures"
import { fail, ok } from "../cloudflare/testing"
import { isAbortError, isToolError } from "../errors"
import { invoke, type ToolContext } from "../tool"
import { ADDRESSES_PATH, DESTINATION, addressAddFor, createAddressRoute } from "./address.fixtures"
import { CTX, addressRow, addressesRoute, dropped, paged, refusalOf, sent } from "./rule.fixtures"

const ARGS = { email: DESTINATION }
const DENIED = fail(403, [{ code: 10000, message: "Authentication error" }])
const REFUSED = { code: 9005, message: "Content is invalid" }
const NOTHING_CHANGED = " Nothing was changed."
const MAYBE =
  "Cloudflare may or may not have added the address and mailed its owner; read cloudflare_email_read addresses before sending it again."
const CONFIRMED: ToolContext = { ...CTX, confirm: async () => true }

describe("cloudflareEmailAddressAdd: an address the account has", () => {
  test.each([
    ["verified", addressRow(DESTINATION), "verified"],
    ["pending", addressRow(DESTINATION, null), "still waiting for its owner to confirm Cloudflare's mail"],
  ])("refuses it when it is %s, and sends no write", async (_what, row, state) => {
    const { tool, requests } = addressAddFor(addressesRoute(paged([[row]])))

    const message = await refusalOf(invoke(tool, ARGS, CTX))

    expect(message).toBe(`${DESTINATION} is already a destination address of this account, ${state}.${NOTHING_CHANGED}`)
    expect(sent(requests, "POST")).toHaveLength(0)
  })

  test("finds it on the second page, without regard to case", async () => {
    const { tool, requests } = addressAddFor(
      addressesRoute(paged([[addressRow("someone@example.net")], [addressRow("OWNER@Example.NET")]])),
    )

    const message = await refusalOf(invoke(tool, ARGS, CTX))

    expect(message).toContain("is already a destination address of this account, verified.")
    const pages = requests.filter((request) => request.path === ADDRESSES_PATH)
    expect(pages.map((request) => request.query.get("page"))).toEqual(["1", "2"])
    expect(sent(requests, "POST")).toHaveLength(0)
  })

  test("reads exactly five pages and adds when none holds it", async () => {
    const pages = Array.from({ length: 5 }, () => [addressRow("someone@example.net")])
    const { tool, requests } = addressAddFor(addressesRoute(paged(pages)))

    await invoke(tool, ARGS, CTX)

    expect(requests.filter((request) => request.method === "GET")).toHaveLength(5)
    expect(sent(requests, "POST")).toHaveLength(1)
  })

  test("refuses an account with more than five pages of addresses that lacks it, and sends no write", async () => {
    const pages = Array.from({ length: 6 }, () => [addressRow("someone@example.net")])
    const { tool, requests } = addressAddFor(addressesRoute(paged(pages)))

    const error = await toolError(invoke(tool, ARGS, CTX))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe("The account has more destination addresses than this tool reads.")
    expect(sent(requests, "POST")).toHaveLength(0)
  })

  test("refuses a reply that is not a list", async () => {
    const { tool } = addressAddFor(addressesRoute(ok({})))

    const error = await toolError(invoke(tool, ARGS, CTX))

    expect(error.message).toBe("Cloudflare returned an unexpected destination addresses response.")
  })

  test("names the Addresses Read permission when the addresses cannot be read", async () => {
    const { tool, requests } = addressAddFor(addressesRoute(DENIED))

    const error = await toolError(invoke(tool, ARGS, CTX))

    expect(error.code).toBe("forbidden")
    expect(error.message).toBe("10000: Authentication error. The token needs Account → Email Routing Addresses → Read.")
    expect(sent(requests, "POST")).toHaveLength(0)
  })
})

describe("cloudflareEmailAddressAdd: arguments", () => {
  test.each([
    ["no @", "owner"],
    ["a second @", "a@b@example.net"],
    ["a space", "ow ner@example.net"],
    ["no dot in the domain", "owner@localhost"],
    ["an empty local part", "@example.net"],
    ["a name with a bracket address", "Owner <owner@example.net>"],
    ["more than 90 characters", `${"a".repeat(64)}@${"b".repeat(14)}.example.net`],
  ])("refuses an address with %s, and reads nothing", async (_what, email) => {
    const { tool, requests } = addressAddFor()

    const message = await refusalOf(invoke(tool, { email }, CTX))

    expect(message).toContain("email:")
    expect(requests).toHaveLength(0)
  })

  test("refuses unknown arguments", async () => {
    const { tool, requests } = addressAddFor()

    expect(await refusalOf(invoke(tool, { ...ARGS, name: "x" }, CTX))).toContain("name: unknown argument")
    expect(requests).toHaveLength(0)
  })
})

describe("cloudflareEmailAddressAdd: the address appears while the person answers", () => {
  function appearing() {
    let reads = 0
    return addressesRoute(() => ok(reads++ === 0 ? [] : [addressRow(DESTINATION)]))
  }

  test("is refused as stale, and nothing is sent", async () => {
    const { tool, requests } = addressAddFor(appearing())

    const error = await toolError(invoke(tool, ARGS, CONFIRMED))

    expect(error.code).toBe("stale")
    expect(error.message).toBe(
      `${DESTINATION} became a destination address of this account while waiting for the answer. Nothing was changed; read the addresses again.`,
    )
    expect(sent(requests, "POST")).toHaveLength(0)
  })

  test("is not read for when the harness's approval stands in for the question", async () => {
    const { tool, requests } = addressAddFor(appearing())

    await invoke(tool, ARGS, CTX)

    expect(sent(requests, "POST")).toHaveLength(1)
  })

  test("is declined when the person says no, and nothing more is sent", async () => {
    const { tool, requests } = addressAddFor()

    const error = await toolError(invoke(tool, ARGS, { ...CTX, confirm: async () => false }))

    expect(error.code).toBe("declined")
    expect(error.message).toStartWith("cloudflare_email_address_add was declined: Add owner@example.net")
    expect(requests.map((request) => request.method)).toEqual(["GET"])
  })
})

describe("cloudflareEmailAddressAdd: the write fails", () => {
  test.each([
    [400, "invalid_argument"],
    [404, "not_found"],
    [429, "rate_limited"],
    [409, "upstream_error"],
  ] as const)("keeps the code of a %p and says nothing was changed", async (status, code) => {
    const { tool, requests } = addressAddFor(createAddressRoute(fail(status, [REFUSED])))

    const error = await toolError(invoke(tool, ARGS, CTX))

    expect(error.code).toBe(code)
    expect(error.message).toStartWith(
      status === 409 ? "Cloudflare answered HTTP 409: 9005: Content is invalid" : "9005",
    )
    expect(error.message).toEndWith(NOTHING_CHANGED)
    expect(sent(requests, "POST")).toHaveLength(1)
  })

  test("names the Edit permission when forbidden, before the note", async () => {
    const { tool } = addressAddFor(createAddressRoute(DENIED))

    const error = await toolError(invoke(tool, ARGS, CTX))

    expect(error.code).toBe("forbidden")
    expect(error.message).toBe(
      `10000: Authentication error. The token needs Account → Email Routing Addresses → Edit.${NOTHING_CHANGED}`,
    )
  })

  test("says Cloudflare may or may not have added the address after a 500", async () => {
    const { tool } = addressAddFor(createAddressRoute(fail(500, [{ code: 1000, message: "Down" }])))

    const error = await toolError(invoke(tool, ARGS, CTX))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe(`Cloudflare answered HTTP 500: 1000: Down ${MAYBE}`)
  })

  test("says so too when the connection drops", async () => {
    const { tool, requests } = addressAddFor(createAddressRoute(dropped))

    const error = await toolError(invoke(tool, ARGS, CTX))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe(`Cloudflare could not be reached: connection reset ${MAYBE}`)
    expect(sent(requests, "POST")).toHaveLength(1)
  })

  test.each([
    ["no result", ok(undefined)],
    ["a result that is not an object", ok("done")],
    ["an address without an email", ok({ id: "x" })],
  ])("treats %s as an unexpected response that may have added the address", async (_what, reply) => {
    const { tool } = addressAddFor(createAddressRoute(reply))

    const error = await toolError(invoke(tool, ARGS, CTX))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe(`Cloudflare returned an unexpected destination address response. ${MAYBE}`)
  })
})

describe("cloudflareEmailAddressAdd: cancellation", () => {
  async function cancelledAt(route: Parameters<typeof addressAddFor>[number]) {
    const controller = new AbortController()
    const { tool, requests } = addressAddFor({ ...route, reply: () => (controller.abort(), ok({})) })
    const error = await rejection(invoke(tool, ARGS, { ...CONFIRMED, signal: controller.signal }))
    return { error, requests }
  }

  test.each([
    ["the address read", addressesRoute(paged([[]]))],
    ["the write", createAddressRoute()],
  ])("passes a cancellation during %s on untouched, and adds nothing more", async (_what, route) => {
    const { error, requests } = await cancelledAt(route)

    expect(isAbortError(error)).toBe(true)
    expect(isToolError(error)).toBe(false)
    expect(sent(requests, "POST")).toHaveLength(route.method === "POST" ? 1 : 0)
  })

  test("passes a cancellation during the second read on", async () => {
    const controller = new AbortController()
    let reads = 0
    const route = addressesRoute(() => (reads++ === 0 ? ok([]) : (controller.abort(), ok([]))))
    const { tool, requests } = addressAddFor(route)

    const error = await rejection(invoke(tool, ARGS, { ...CONFIRMED, signal: controller.signal }))

    expect(isAbortError(error)).toBe(true)
    expect(sent(requests, "POST")).toHaveLength(0)
  })
})
