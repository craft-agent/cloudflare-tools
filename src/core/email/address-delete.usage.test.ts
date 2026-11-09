import { describe, expect, test } from "bun:test"
import { toolError } from "../cloudflare/client.fixtures"
import { fail, ok, type FakeRoute } from "../cloudflare/testing"
import { invoke } from "../tool"
import {
  DESTINATION,
  RULE_ID,
  ZONE_A,
  ZONE_B,
  addressDeleteFor,
  forwardingRule,
  zoneCatchAllRoute,
  zoneRulesRoute,
  zonesRoute,
} from "./address.fixtures"
import { CATCH_ALL_RULE } from "./fixtures"
import { CTX, paged, refusalOf, sent } from "./rule.fixtures"

const ARGS = { email: DESTINATION }
const NOTHING_CHANGED = " Nothing was changed."
const END = `; change or delete them first, since Cloudflare would turn them off.${NOTHING_CHANGED}`
const SALES_RULE = `example.com's rule ${RULE_ID} (mail to sales@example.com)`
const FORWARDING_CATCH_ALL = { ...CATCH_ALL_RULE, actions: [{ type: "forward", value: [DESTINATION] }] }
const DENIED = fail(403, [{ code: 10000, message: "Authentication error" }])
const USAGE_HINT =
  "The token needs Zone → Email Routing Rules → Read in every zone of the account to tell whether a rule forwards to the address."

/** `n` rules of zone A that forward to the address, with ids of their own. */
function manyRules(n: number) {
  return Array.from({ length: n }, (_, index) => forwardingRule([DESTINATION], { id: `r${index}`, matchers: [] }))
}

async function refused(...routes: FakeRoute[]) {
  const { tool, requests } = addressDeleteFor(...routes)
  const message = await refusalOf(invoke(tool, ARGS, CTX))
  expect(sent(requests, "DELETE")).toHaveLength(0)
  return message
}

describe("cloudflareEmailAddressDelete: where the account forwards to the address", () => {
  test("refuses while a rule forwards to it, naming the zone, the rule and its address", async () => {
    const message = await refused(zoneRulesRoute(ZONE_A, paged([[forwardingRule([DESTINATION])]])))

    expect(message).toBe(`${DESTINATION} is still where ${SALES_RULE} forwards${END}`)
  })

  test("finds it in a rule of a shape these tools do not change", async () => {
    const odd = forwardingRule(["x@example.net", DESTINATION], {
      matchers: [
        { type: "literal", field: "to", value: "Sales@Example.com" },
        { type: "literal", field: "to", value: "info@example.com" },
      ],
    })

    const message = await refused(zoneRulesRoute(ZONE_A, paged([[odd]])))

    expect(message).toBe(`${DESTINATION} is still where ${SALES_RULE} forwards${END}`)
  })

  test("names a rule without an address of its own by its id alone", async () => {
    const message = await refused(
      zoneRulesRoute(ZONE_A, paged([[forwardingRule([DESTINATION], { matchers: [{ type: "all" }] })]])),
    )

    expect(message).toBe(`${DESTINATION} is still where example.com's rule ${RULE_ID} forwards${END}`)
  })

  test("finds it in a catch-all", async () => {
    const message = await refused(zoneCatchAllRoute(ZONE_B, ok(FORWARDING_CATCH_ALL)))

    expect(message).toBe(`${DESTINATION} is still where example.org's catch-all forwards${END}`)
  })

  test("finds it in a rule that is turned off", async () => {
    const message = await refused(zoneRulesRoute(ZONE_A, paged([[forwardingRule([DESTINATION], { enabled: false })]])))

    expect(message).toContain(SALES_RULE)
  })

  test("matches the address without regard to case", async () => {
    const message = await refused(zoneRulesRoute(ZONE_A, paged([[forwardingRule(["OWNER@Example.NET"])]])))

    expect(message).toContain(SALES_RULE)
  })

  test("finds it on a later page of a zone's rules, reading every page", async () => {
    const { tool, requests } = addressDeleteFor(
      zoneRulesRoute(ZONE_A, paged([[], [], [forwardingRule([DESTINATION])]])),
    )

    const message = await refusalOf(invoke(tool, ARGS, CTX))

    expect(message).toContain(SALES_RULE)
    expect(
      requests.filter((request) => request.path.endsWith("/rules") && request.path.includes(ZONE_A.id)),
    ).toHaveLength(3)
  })

  test("names two uses with a plural verb, rules first and the catch-all of the zone after them", async () => {
    const message = await refused(
      zoneRulesRoute(ZONE_A, paged([[forwardingRule([DESTINATION])]])),
      zoneCatchAllRoute(ZONE_B, ok(FORWARDING_CATCH_ALL)),
    )

    expect(message).toBe(`${DESTINATION} is still where ${SALES_RULE}, example.org's catch-all forward${END}`)
  })

  test("lists five uses at most, and counts the rest", async () => {
    const message = await refused(zoneRulesRoute(ZONE_A, paged([manyRules(7)])))

    expect(message).toBe(
      `${DESTINATION} is still where ${[0, 1, 2, 3, 4].map((n) => `example.com's rule r${n}`).join(", ")} and 2 more forward${END}`,
    )
  })

  test.each([
    ["a rule that forwards elsewhere", forwardingRule(["someone@example.net"])],
    ["a rule that drops", { ...forwardingRule([]), actions: [{ type: "drop" }] }],
    ["a Worker rule", { ...forwardingRule([]), actions: [{ type: "worker", value: [DESTINATION] }] }],
    ["a rule that holds the address in its name", forwardingRule(["a@example.net"], { name: DESTINATION })],
  ])("does not count %s", async (_what, rule) => {
    const { tool, requests } = addressDeleteFor(zoneRulesRoute(ZONE_A, paged([[rule]])))

    await invoke(tool, ARGS, CTX)

    expect(sent(requests, "DELETE")).toHaveLength(1)
  })

  test("goes on past a zone without a catch-all", async () => {
    const { tool, requests } = addressDeleteFor(
      zoneCatchAllRoute(ZONE_A, fail(404, [{ code: 1004, message: "Not found" }])),
    )

    const result = await invoke(tool, ARGS, CTX)

    expect(result.zones_checked).toBe(2)
    expect(sent(requests, "DELETE")).toHaveLength(1)
  })
})

describe("cloudflareEmailAddressDelete: what the zones' reads can fail with", () => {
  test.each([
    ["a zone's rules", zoneRulesRoute(ZONE_B, DENIED)],
    ["a zone's catch-all", zoneCatchAllRoute(ZONE_B, DENIED)],
  ])("names the Rules Read permission in every zone when %s cannot be read", async (_what, route) => {
    const { tool, requests } = addressDeleteFor(route)

    const error = await toolError(invoke(tool, ARGS, CTX))

    expect(error.code).toBe("forbidden")
    expect(error.message).toBe(`10000: Authentication error. ${USAGE_HINT}`)
    expect(sent(requests, "DELETE")).toHaveLength(0)
  })

  test("names the Zone Read permission when the zones cannot be listed", async () => {
    const { tool } = addressDeleteFor(zonesRoute(DENIED))

    const error = await toolError(invoke(tool, ARGS, CTX))

    expect(error.code).toBe("forbidden")
    expect(error.message).toBe(
      "10000: Authentication error. The token needs Zone → Zone → Read to list the account's zones.",
    )
  })

  test("passes another failure of a catch-all read on, and deletes nothing", async () => {
    const { tool, requests } = addressDeleteFor(zoneCatchAllRoute(ZONE_B, fail(500, [{ code: 1000, message: "Down" }])))

    const error = await toolError(invoke(tool, ARGS, CTX))

    expect(error.code).toBe("upstream_error")
    expect(sent(requests, "DELETE")).toHaveLength(0)
  })

  test("refuses an account with more than five pages of zones, and deletes nothing", async () => {
    const { tool, requests } = addressDeleteFor(zonesRoute(paged(Array.from({ length: 6 }, () => [ZONE_A]))))

    const error = await toolError(invoke(tool, ARGS, CTX))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe("The account has more zones than this tool reads.")
    expect(sent(requests, "DELETE")).toHaveLength(0)
  })

  test("refuses a zone with more than five pages of rules, and deletes nothing", async () => {
    const { tool, requests } = addressDeleteFor(zoneRulesRoute(ZONE_A, paged(Array.from({ length: 6 }, () => []))))

    const error = await toolError(invoke(tool, ARGS, CTX))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe("The zone has more routing rules than this tool reads.")
    expect(sent(requests, "DELETE")).toHaveLength(0)
  })

  test("refuses a zone listing that is not a list", async () => {
    const { tool } = addressDeleteFor(zonesRoute(ok({})))

    const error = await toolError(invoke(tool, ARGS, CTX))

    expect(error.message).toBe("Cloudflare returned an unexpected zones response.")
  })
})
