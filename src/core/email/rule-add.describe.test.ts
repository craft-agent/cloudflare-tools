import { describe, expect, test } from "bun:test"
import { ok } from "../cloudflare/testing"
import { callDescription } from "../describe"
import { describing, readsOf, refusing, writes } from "./describe.fixtures"
import {
  ADDRESSES_PATH,
  ARGS,
  CTX,
  DESTINATION,
  TO,
  addressRow,
  addressesRoute,
  paged,
  routingRoute,
  ruleAddFor,
  ruleRow,
  rulesRoute,
} from "./rule.fixtures"

const HEADLINE = { text: "About to add the routing rule for {address}", values: { address: TO } }
const ROUTING_OFF = {
  label: "Email Routing",
  value: { text: "off: no mail is routed until it is turned on in the dashboard" },
}

describe("cloudflareEmailRuleAdd: describe", () => {
  test("states its intent", () => {
    expect(ruleAddFor().tool.intent).toBe("About to add a routing rule")
  })

  test("names the address and the forward, and nothing else for an unnamed rule that is on", async () => {
    const { tool, requests } = ruleAddFor()

    const { description, asked } = await describing(tool, ARGS)

    expect(description).toEqual({
      headline: HEADLINE,
      facts: [{ label: "Action", value: `forward ${DESTINATION}` }],
    })
    expect(asked).toEqual([])
    expect(writes(requests)).toEqual([])
  })

  test("names the address as the call will send it: the zone added to a local part, lowercased", async () => {
    const { tool } = ruleAddFor()

    const { description } = await describing(tool, { ...ARGS, to: " Sales@Mail.Example.com " })

    expect(description.headline!.values).toEqual({ address: "sales@mail.example.com" })
  })

  test.each([
    ["a drop", { type: "drop" }, "drop"],
    ["a Worker", { type: "worker", worker: "inbox" }, "worker inbox"],
  ])("writes %s in the notation of the API, and reads no destination address", async (_what, action, text) => {
    const { tool, requests } = ruleAddFor()

    const { description } = await describing(tool, { ...ARGS, action })

    expect(description.facts).toEqual([{ label: "Action", value: text }])
    expect(readsOf(requests, ADDRESSES_PATH)).toBe(0)
  })

  test("adds the name as it was given, and that the rule is off, after the action", async () => {
    const { tool } = ruleAddFor()

    const { description } = await describing(tool, { ...ARGS, name: "Sales line", enabled: false })

    expect(description.facts).toEqual([
      { label: "Action", value: `forward ${DESTINATION}` },
      { label: "Name", value: "Sales line" },
      { label: "State", value: { text: "off" } },
    ])
  })

  test("says nothing of the state for a rule that is on, said or not", async () => {
    const { tool } = ruleAddFor()

    const { description } = await describing(tool, { ...ARGS, enabled: true })

    expect(description.facts).toEqual([{ label: "Action", value: `forward ${DESTINATION}` }])
  })

  test("puts a zone with Email Routing off first", async () => {
    const { tool } = ruleAddFor(routingRoute(ok({ enabled: false })))

    const { description } = await describing(tool, { ...ARGS, name: "x" })

    expect(description.facts).toEqual([
      ROUTING_OFF,
      { label: "Action", value: `forward ${DESTINATION}` },
      { label: "Name", value: "x" },
    ])
  })

  test.each([
    ["it cannot be read", routingRoute({ status: 500, body: "down" })],
    ["it is not an object", routingRoute(ok("none"))],
    ["it is on", routingRoute(ok({ enabled: true }))],
  ])("says nothing of Email Routing when %s", async (_what, route) => {
    const { tool } = ruleAddFor(route)

    const { description } = await describing(tool, ARGS)

    expect(description.facts).toEqual([{ label: "Action", value: `forward ${DESTINATION}` }])
  })

  test("shows no text and no pins", async () => {
    const { tool } = ruleAddFor()

    const { description } = await describing(tool, { ...ARGS, name: "x", enabled: false })

    expect(description.text).toBeUndefined()
    expect(description.pins).toBeUndefined()
  })

  test("gives the same description twice for the same state", async () => {
    const { tool } = ruleAddFor()

    const first = await describing(tool, ARGS)
    const second = await describing(tool, ARGS)

    expect(second.description).toEqual(first.description)
  })

  test("is accepted by the description check", async () => {
    const { tool } = ruleAddFor()

    const answer = await callDescription(tool, { ...ARGS, name: "x", enabled: false }, CTX)

    expect(answer?.headline).toEqual(HEADLINE)
    expect(answer?.facts).toHaveLength(3)
  })
})

describe("cloudflareEmailRuleAdd: describe refuses where execute would", () => {
  test.each([
    ["an address that already has a rule", [rulesRoute(paged([[ruleRow(TO)]]))], ARGS, "already has a routing rule"],
    [
      "a forward to an address whose owner has not confirmed",
      [addressesRoute(paged([[addressRow(DESTINATION, null)]]))],
      ARGS,
      "has not confirmed",
    ],
    ["a forward to an address the account lacks", [addressesRoute(paged([[]]))], ARGS, "is not a destination address"],
    ["an address outside the zone", [], { ...ARGS, to: "sales@other.net" }, "to must be an address at example.com"],
  ])("throws for %s, and writes and asks nothing", async (_what, routes, args, message) => {
    const { tool, requests } = ruleAddFor(...routes)

    const { error, asked } = await refusing(tool, args)

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain(message)
    expect(asked).toEqual([])
    expect(writes(requests)).toEqual([])
  })

  test("accepts a drop to an address that has no verified destination to check", async () => {
    const { tool } = ruleAddFor(addressesRoute(paged([[]])))

    const { description } = await describing(tool, { ...ARGS, action: { type: "drop" } })

    expect(description.facts).toEqual([{ label: "Action", value: "drop" }])
  })

  test("gives nothing to the description check for a call execute would refuse", async () => {
    const { tool } = ruleAddFor(rulesRoute(paged([[ruleRow(TO)]])))

    expect(await callDescription(tool, ARGS, CTX)).toBeUndefined()
  })
})
