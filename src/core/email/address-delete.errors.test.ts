import { describe, expect, test } from "bun:test"
import { rejection, toolError } from "../cloudflare/client.fixtures"
import { fail, ok, type FakeReply, type FakeRoute } from "../cloudflare/testing"
import { isAbortError, isToolError } from "../errors"
import { invoke, type ToolContext } from "../tool"
import {
  ADDRESSES_PATH,
  DESTINATION,
  ZONE_A,
  ZONE_B,
  addressDeleteFor,
  deleteAddressRoute,
  forwardingRule,
  zoneCatchAllRoute,
  zoneRulesRoute,
  zonesRoute,
} from "./address.fixtures"
import { CATCH_ALL_RULE } from "./fixtures"
import { CTX, addressRow, addressesRoute, calls, dropped, paged, sent } from "./rule.fixtures"

const ARGS = { email: DESTINATION }
const DENIED = fail(403, [{ code: 10000, message: "Authentication error" }])
const REFUSED = { code: 9005, message: "Content is invalid" }
const NOTHING_CHANGED = " Nothing was changed."
const MAYBE =
  "Cloudflare may or may not have deleted the address; read cloudflare_email_read addresses before sending it again."
const CHANGED = `${DESTINATION} or the rules that could forward to it changed while waiting for the answer. Nothing was changed; read them again before trying again.`
const CONFIRMED: ToolContext = { ...CTX, confirm: async () => true }

const FORWARDING_CATCH_ALL = { ...CATCH_ALL_RULE, actions: [{ type: "forward", value: [DESTINATION] }] }

/** The `route` with its first answer `first` and every later one `later`. */
function changing(route: FakeRoute, first: FakeReply, later: FakeReply): FakeRoute {
  let reads = 0
  return { ...route, reply: () => (reads++ === 0 ? first : later) }
}

describe("cloudflareEmailAddressDelete: an address it does not delete", () => {
  test("refuses an address the account does not have as not_found, and reads no zone", async () => {
    const { tool, requests } = addressDeleteFor(addressesRoute(paged([[addressRow("someone@example.net")]])))

    const error = await toolError(invoke(tool, ARGS, CONFIRMED))

    expect(error.code).toBe("not_found")
    expect(error.message).toBe(
      `${DESTINATION} is not a destination address of this account; cloudflare_email_read addresses lists them.${NOTHING_CHANGED}`,
    )
    expect(calls(requests)).toEqual([`GET ${ADDRESSES_PATH}`])
  })

  test("names the Addresses Read permission when the addresses cannot be read", async () => {
    const { tool, requests } = addressDeleteFor(addressesRoute(DENIED))

    const error = await toolError(invoke(tool, ARGS, CTX))

    expect(error.code).toBe("forbidden")
    expect(error.message).toBe("10000: Authentication error. The token needs Account → Email Routing Addresses → Read.")
    expect(sent(requests, "DELETE")).toHaveLength(0)
  })

  test("is declined when the person says no, and nothing more is sent", async () => {
    const { tool, requests } = addressDeleteFor()

    const error = await toolError(invoke(tool, ARGS, { ...CTX, confirm: async () => false }))

    expect(error.code).toBe("declined")
    expect(error.message).toStartWith("cloudflare_email_address_delete was declined: Delete the destination address")
    expect(sent(requests, "DELETE")).toHaveLength(0)
    expect(requests.filter((request) => request.path === ADDRESSES_PATH)).toHaveLength(1)
  })
})

describe("cloudflareEmailAddressDelete: things change while the person answers", () => {
  test.each([
    ["the address is gone", changing(addressesRoute(), ok([addressRow(DESTINATION)]), ok([]))],
    [
      "the address has another id",
      changing(addressesRoute(), ok([addressRow(DESTINATION)]), ok([{ ...addressRow(DESTINATION), id: "f6f6" }])),
    ],
    [
      "a rule now forwards to the address",
      changing(zoneRulesRoute(ZONE_A), ok([]), ok([forwardingRule([DESTINATION])])),
    ],
    [
      "a catch-all now forwards to the address",
      changing(zoneCatchAllRoute(ZONE_B), ok(CATCH_ALL_RULE), ok(FORWARDING_CATCH_ALL)),
    ],
  ])("refuses it as stale when %s, and sends no delete", async (_what, route) => {
    const { tool, requests } = addressDeleteFor(route)

    const error = await toolError(invoke(tool, ARGS, CONFIRMED))

    expect(error.code).toBe("stale")
    expect(error.message).toBe(CHANGED)
    expect(sent(requests, "DELETE")).toHaveLength(0)
  })

  test("deletes when the second reads are what was approved", async () => {
    const { tool, requests } = addressDeleteFor(zonesRoute(ok([ZONE_A, ZONE_B])))

    await invoke(tool, ARGS, CONFIRMED)

    expect(sent(requests, "DELETE")).toHaveLength(1)
  })

  test("does not read again when the harness's approval stands in for the question", async () => {
    const { tool, requests } = addressDeleteFor()

    await invoke(tool, ARGS, CTX)

    expect(requests.filter((request) => request.path === "/zones")).toHaveLength(1)
  })
})

describe("cloudflareEmailAddressDelete: the delete fails", () => {
  test.each([
    [400, "invalid_argument"],
    [404, "not_found"],
    [429, "rate_limited"],
    [409, "upstream_error"],
  ] as const)("keeps the code of a %p and says nothing was changed", async (status, code) => {
    const { tool, requests } = addressDeleteFor(deleteAddressRoute(fail(status, [REFUSED])))

    const error = await toolError(invoke(tool, ARGS, CTX))

    expect(error.code).toBe(code)
    expect(error.message).toStartWith(
      status === 409 ? "Cloudflare answered HTTP 409: 9005: Content is invalid" : "9005",
    )
    expect(error.message).toEndWith(NOTHING_CHANGED)
    expect(sent(requests, "DELETE")).toHaveLength(1)
  })

  test("names the Edit permission when forbidden, before the note", async () => {
    const { tool } = addressDeleteFor(deleteAddressRoute(DENIED))

    const error = await toolError(invoke(tool, ARGS, CTX))

    expect(error.code).toBe("forbidden")
    expect(error.message).toBe(
      `10000: Authentication error. The token needs Account → Email Routing Addresses → Edit.${NOTHING_CHANGED}`,
    )
  })

  test("says Cloudflare may or may not have deleted the address after a 500", async () => {
    const { tool } = addressDeleteFor(deleteAddressRoute(fail(500, [{ code: 1000, message: "Down" }])))

    const error = await toolError(invoke(tool, ARGS, CTX))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe(`Cloudflare answered HTTP 500: 1000: Down ${MAYBE}`)
  })

  test("says so too when the connection drops", async () => {
    const { tool, requests } = addressDeleteFor(deleteAddressRoute(dropped))

    const error = await toolError(invoke(tool, ARGS, CTX))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe(`Cloudflare could not be reached: connection reset ${MAYBE}`)
    expect(sent(requests, "DELETE")).toHaveLength(1)
  })
})

describe("cloudflareEmailAddressDelete: cancellation", () => {
  test.each([
    ["the address read", addressesRoute(paged([[addressRow(DESTINATION)]]))],
    ["the zones read", zonesRoute()],
    ["a zone's rules read", zoneRulesRoute(ZONE_B)],
    ["a zone's catch-all read", zoneCatchAllRoute(ZONE_A)],
    ["the delete", deleteAddressRoute()],
  ])("passes a cancellation during %s on untouched, and deletes nothing more", async (_what, route) => {
    const controller = new AbortController()
    const { tool, requests } = addressDeleteFor({ ...route, reply: () => (controller.abort(), ok({})) })

    const error = await rejection(invoke(tool, ARGS, { ...CONFIRMED, signal: controller.signal }))

    expect(isAbortError(error)).toBe(true)
    expect(isToolError(error)).toBe(false)
    expect(sent(requests, "DELETE")).toHaveLength(route.method === "DELETE" ? 1 : 0)
  })
})
