import { describe, expect, test } from "bun:test"
import { fail, ok, type FakeRoute } from "../cloudflare/testing"
import { callDescription } from "../describe"
import type { ErrorCode } from "../errors"
import { describing, refusing, writes } from "./describe.fixtures"
import { OTHER_RULE_ID } from "./fixtures"
import {
  CATCH_ALL_RULE,
  CURRENT_RULE,
  EDIT_BASE,
  OTHER_DESTINATION,
  SHAPED_CURRENT,
  ruleEditFor,
  ruleRoute,
} from "./rule.current.fixtures"
import {
  CTX,
  DESTINATION,
  TO,
  addressRow,
  addressesRoute,
  paged,
  routingRoute,
  ruleRow,
  rulesRoute,
} from "./rule.fixtures"

const HEADLINE = { text: "About to change the routing rule for {address}", values: { address: TO } }

describe("cloudflareEmailRuleEdit: describe", () => {
  test("states its intent", () => {
    expect(ruleEditFor().tool.intent).toBe("About to change a routing rule")
  })

  test("names the rule's address and its changes, and pins the rule as it was read", async () => {
    const { tool, requests } = ruleEditFor()

    const { description, asked } = await describing(tool, { ...EDIT_BASE, name: "Renamed" })

    expect(description).toEqual({
      headline: HEADLINE,
      facts: [],
      text: { label: "Changes", body: "name: Sales forward → Renamed" },
      pins: { rule: expect.any(String) },
    })
    expect(JSON.parse(description.pins!.rule!)).toEqual(SHAPED_CURRENT)
    expect(asked).toEqual([])
    expect(writes(requests)).toEqual([])
  })

  test("names the address the rule has now, even when the call moves it", async () => {
    const { tool } = ruleEditFor()

    const { description } = await describing(tool, { ...EDIT_BASE, to: "Support" })

    expect(description.headline).toEqual(HEADLINE)
    expect(description.text!.body).toBe(`to: ${TO} → support@example.com`)
  })

  test.each([
    [
      "another destination",
      { action: { type: "forward", to: OTHER_DESTINATION } },
      `action: forward ${DESTINATION} → forward ${OTHER_DESTINATION}`,
    ],
    ["a drop", { action: { type: "drop" } }, `action: forward ${DESTINATION} → drop`],
    ["a Worker", { action: { type: "worker", worker: "inbox" } }, `action: forward ${DESTINATION} → worker inbox`],
    ["off", { enabled: false }, "enabled: on → off"],
  ])("lists a change to %s", async (_what, extra, line) => {
    const { tool } = ruleEditFor()

    const { description } = await describing(tool, { ...EDIT_BASE, ...extra })

    expect(description.text).toEqual({ label: "Changes", body: line })
  })

  test("lists a rule turned on from off, and a first name as (none) before", async () => {
    const { tool } = ruleEditFor(ruleRoute(ok({ ...CURRENT_RULE, name: undefined, enabled: false })))

    const { description } = await describing(tool, { ...EDIT_BASE, enabled: true, name: "Sales" })

    expect(description.text!.body).toBe("name: (none) → Sales\nenabled: off → on")
  })

  test("lists only the parts that differ, one line each in the order to, action, name, enabled", async () => {
    const { tool } = ruleEditFor(ruleRoute(ok({ ...CURRENT_RULE, enabled: false })))

    const { description } = await describing(tool, {
      ...EDIT_BASE,
      enabled: true,
      name: "Sales forward",
      action: { type: "drop" },
      to: "support@example.com",
    })

    expect(description.text!.body).toBe(
      [`to: ${TO} → support@example.com`, `action: forward ${DESTINATION} → drop`, "enabled: off → on"].join("\n"),
    )
  })

  test("leaves out an argument that repeats what the rule has, in whatever case", async () => {
    const { tool } = ruleEditFor()

    const { description } = await describing(tool, {
      ...EDIT_BASE,
      to: TO.toUpperCase(),
      action: { type: "forward", to: DESTINATION.toUpperCase() },
      enabled: false,
    })

    expect(description.text!.body).toBe("enabled: on → off")
  })

  test("puts a zone with Email Routing off first, and says nothing of one that cannot be read", async () => {
    const off = await describing(ruleEditFor(routingRoute(ok({ enabled: false }))).tool, { ...EDIT_BASE, name: "x" })
    const unknown = await describing(ruleEditFor(routingRoute({ status: 500, body: "down" })).tool, {
      ...EDIT_BASE,
      name: "x",
    })

    expect(off.description.facts).toEqual([
      {
        label: "Email Routing",
        value: { text: "off: no mail is routed until it is turned on in the dashboard" },
      },
    ])
    expect(unknown.description.facts).toEqual([])
  })

  test("pins change with a part the prompt does not show: the priority, and the name when it is not named", async () => {
    const args = { ...EDIT_BASE, enabled: false }
    const base = await describing(ruleEditFor().tool, args)
    const priority = await describing(ruleEditFor(ruleRoute(ok({ ...CURRENT_RULE, priority: 20 }))).tool, args)
    const name = await describing(ruleEditFor(ruleRoute(ok({ ...CURRENT_RULE, name: "Other" }))).tool, args)

    expect({ ...priority.description, pins: undefined }).toEqual({ ...base.description, pins: undefined })
    expect(priority.description.pins).not.toEqual(base.description.pins)
    expect(name.description.pins).not.toEqual(base.description.pins)
    expect(JSON.parse(priority.description.pins!.rule!).priority).toBe(20)
  })

  test("gives the same description twice for the same state", async () => {
    const { tool } = ruleEditFor()
    const args = { ...EDIT_BASE, name: "Renamed", enabled: false }

    const first = await describing(tool, args)
    const second = await describing(tool, args)

    expect(second.description).toEqual(first.description)
  })

  test("is accepted by the description check", async () => {
    const { tool } = ruleEditFor()

    const answer = await callDescription(tool, { ...EDIT_BASE, name: "Renamed" }, CTX)

    expect(answer?.headline).toEqual(HEADLINE)
    expect(answer?.pins?.rule).toBeDefined()
  })
})

describe("cloudflareEmailRuleEdit: describe refuses where execute would", () => {
  const OTHER_RULE = ruleRow("support@example.com", { id: OTHER_RULE_ID })

  test.each<[string, FakeRoute[], object, ErrorCode, string]>([
    ["nothing named", [], EDIT_BASE, "invalid_argument", "Name what changes: to, action, name or enabled."],
    [
      "a rule that does something else now",
      [],
      { ...EDIT_BASE, replaces: { type: "drop" }, name: "x" },
      "stale",
      `Mail to ${TO} now is forwarded to ${DESTINATION}, not dropped`,
    ],
    [
      "a change that is none",
      [],
      { ...EDIT_BASE, name: "Sales forward" },
      "invalid_argument",
      "already reads that way",
    ],
    [
      "an address another rule has",
      [rulesRoute(paged([[OTHER_RULE]]))],
      { ...EDIT_BASE, to: "support" },
      "invalid_argument",
      "already has a routing rule",
    ],
    [
      "a forward to an unverified address",
      [addressesRoute(paged([[addressRow(DESTINATION), addressRow(OTHER_DESTINATION, null)]]))],
      { ...EDIT_BASE, action: { type: "forward", to: OTHER_DESTINATION } },
      "invalid_argument",
      "has not confirmed",
    ],
    [
      "the id of the catch-all",
      [ruleRoute(ok(CATCH_ALL_RULE))],
      { ...EDIT_BASE, name: "x" },
      "invalid_argument",
      "is the zone's catch-all",
    ],
    [
      "a rule Wrangler manages",
      [ruleRoute(ok({ ...CURRENT_RULE, source: "wrangler" }))],
      { ...EDIT_BASE, name: "x" },
      "invalid_argument",
      "managed by a Worker's Wrangler",
    ],
    [
      "a rule that is gone",
      [ruleRoute(fail(404, [{ code: 1004, message: "Not found" }]))],
      { ...EDIT_BASE, name: "x" },
      "not_found",
      "is not a routing rule of example.com",
    ],
  ])("throws for %s, and writes and asks nothing", async (_what, routes, args, code, message) => {
    const { tool, requests } = ruleEditFor(...routes)

    const { error, asked } = await refusing(tool, args)

    expect(error.code).toBe(code)
    expect(error.message).toContain(message)
    expect(asked).toEqual([])
    expect(writes(requests)).toEqual([])
  })

  test("gives nothing to the description check for a call execute would refuse", async () => {
    const { tool } = ruleEditFor()

    expect(await callDescription(tool, EDIT_BASE, CTX)).toBeUndefined()
  })
})
