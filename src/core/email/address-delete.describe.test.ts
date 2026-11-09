import { describe, expect, test } from "bun:test"
import { ok, type FakeRoute } from "../cloudflare/testing"
import { callDescription } from "../describe"
import type { ErrorCode } from "../errors"
import {
  ADDRESS_PATH,
  ADDRESSES_PATH,
  DESTINATION,
  ZONE_A,
  addressDeleteFor,
  forwardingRule,
  zoneCatchAllRoute,
  zoneRulesRoute,
  zonesRoute,
} from "./address.fixtures"
import { describing, readsOf, refusing, writes } from "./describe.fixtures"
import { CATCH_ALL_RULE } from "./fixtures"
import { CTX, addressRow, addressesRoute, paged } from "./rule.fixtures"

const ARGS = { email: DESTINATION }
const HEADLINE = { text: "About to delete the destination address {email}", values: { email: DESTINATION } }
const MANY = { text: "none in {count} zones", values: { count: 2 } }

describe("cloudflareEmailAddressDelete: describe", () => {
  test("states its intent", () => {
    expect(addressDeleteFor().tool.intent).toBe("About to delete a destination address")
  })

  test("names the address, whether it is verified and the zones that were checked, with no pins", async () => {
    const { tool, requests } = addressDeleteFor()

    const { description, asked } = await describing(tool, ARGS)

    expect(description).toEqual({
      headline: HEADLINE,
      facts: [
        { label: "State", value: { text: "verified" } },
        { label: "Uses", value: MANY },
      ],
    })
    expect(asked).toEqual([])
    expect(writes(requests)).toEqual([])
  })

  test("names the address as Cloudflare reports it, found without regard to case", async () => {
    const { tool } = addressDeleteFor(addressesRoute(paged([[addressRow("Owner@Example.NET")]])))

    const { description } = await describing(tool, ARGS)

    expect(description.headline!.values).toEqual({ email: "Owner@Example.NET" })
  })

  test("says that an address is pending when its owner has not confirmed", async () => {
    const { tool } = addressDeleteFor(addressesRoute(paged([[addressRow(DESTINATION, null)]])))

    const { description } = await describing(tool, ARGS)

    expect(description.facts[0]).toEqual({ label: "State", value: { text: "pending" } })
  })

  test.each([
    ["one zone", [ZONE_A], "none in {count} zone", 1],
    ["no zone", [], "none in {count} zones", 0],
  ])("counts %s with the form that fits", async (_what, zones, text, count) => {
    const { tool } = addressDeleteFor(zonesRoute(ok(zones)))

    const { description } = await describing(tool, ARGS)

    expect(description.facts[1]).toEqual({ label: "Uses", value: { text, values: { count } } })
  })

  test("reads the address and the zones once, and never again as an answer would make it", async () => {
    const { tool, requests } = addressDeleteFor()

    await describing(tool, ARGS)

    expect(readsOf(requests, ADDRESSES_PATH)).toBe(1)
    expect(readsOf(requests, "/zones")).toBe(1)
  })

  test("gives the same description twice for the same state", async () => {
    const { tool } = addressDeleteFor()

    const first = await describing(tool, ARGS)
    const second = await describing(tool, ARGS)

    expect(second.description).toEqual(first.description)
  })

  test("is accepted by the description check", async () => {
    const { tool } = addressDeleteFor()

    const answer = await callDescription(tool, ARGS, CTX)

    expect(answer?.headline).toEqual(HEADLINE)
    expect(answer?.facts).toHaveLength(2)
    expect(answer?.pins).toBeUndefined()
  })
})

describe("cloudflareEmailAddressDelete: describe refuses where execute would", () => {
  const FORWARDS = ok({ ...CATCH_ALL_RULE, actions: [{ type: "forward", value: [DESTINATION] }] })

  test.each<[string, FakeRoute, ErrorCode, string]>([
    [
      "an address the account does not have",
      addressesRoute(paged([[]])),
      "not_found",
      `${DESTINATION} is not a destination address of this account`,
    ],
    [
      "an address a rule forwards to",
      zoneRulesRoute(ZONE_A, paged([[forwardingRule([DESTINATION])]])),
      "invalid_argument",
      `${DESTINATION} is still where example.com's rule`,
    ],
    [
      "an address a catch-all forwards to",
      zoneCatchAllRoute(ZONE_A, FORWARDS),
      "invalid_argument",
      `${DESTINATION} is still where example.com's catch-all forwards`,
    ],
  ])("throws for %s, and deletes and asks nothing", async (_what, route, code, message) => {
    const { tool, requests } = addressDeleteFor(route)

    const { error, asked } = await refusing(tool, ARGS)

    expect(error.code).toBe(code)
    expect(error.message).toContain(message)
    expect(asked).toEqual([])
    expect(writes(requests)).toEqual([])
    expect(requests.some((request) => request.path === ADDRESS_PATH)).toBe(false)
  })

  test("gives nothing to the description check for a call execute would refuse", async () => {
    const { tool } = addressDeleteFor(addressesRoute(paged([[]])))

    expect(await callDescription(tool, ARGS, CTX)).toBeUndefined()
  })
})
