import { describe, expect, test } from "bun:test"
import { fail, ok, type FakeRoute } from "../cloudflare/testing"
import { callDescription } from "../describe"
import type { ErrorCode } from "../errors"
import { describing, readsOf, refusing, writes } from "./describe.fixtures"
import {
  CATCH_ALL_RULE,
  CURRENT_RULE,
  DELETE_ARGS,
  INVALID_RULE_OPERATION,
  RULE_ID,
  RULE_PATH,
  catchAllRoute,
  ruleDeleteFor,
  ruleRoute,
} from "./rule.current.fixtures"
import { CTX, DESTINATION, TO } from "./rule.fixtures"

const HEADLINE = { text: "About to delete the routing rule for {address}", values: { address: TO } }
const ACTION = { label: "Action", value: `forward ${DESTINATION}` }
const NAME = { label: "Name", value: "Sales forward" }
const TAKES = { text: "the catch-all takes the mail" }
const REJECTED = { text: "the mail is rejected: the catch-all is off" }
const NO_CATCH_ALL = catchAllRoute(fail(404, [{ code: 1004, message: "Not found" }]))

describe("cloudflareEmailRuleDelete: describe", () => {
  test("states its intent", () => {
    expect(ruleDeleteFor().tool.intent).toBe("About to delete a routing rule")
  })

  test("names the rule's address, its action and name, and where its mail goes next", async () => {
    const { tool, requests } = ruleDeleteFor()

    const { description, asked } = await describing(tool, DELETE_ARGS)

    expect(description).toEqual({
      headline: HEADLINE,
      facts: [
        ACTION,
        NAME,
        { label: "Afterwards", value: { text: "the catch-all takes the mail: {action}", values: { action: "drop" } } },
      ],
    })
    expect(asked).toEqual([])
    expect(writes(requests)).toEqual([])
  })

  test("leaves out the name of an unnamed rule and says that a rule that is off is", async () => {
    const { tool } = ruleDeleteFor(ruleRoute(ok({ ...CURRENT_RULE, name: undefined, enabled: false })))

    const { description } = await describing(tool, DELETE_ARGS)

    expect(description.facts.map((fact) => fact.label)).toEqual(["Action", "State", "Afterwards"])
    expect(description.facts[1]).toEqual({ label: "State", value: { text: "off" } })
  })

  test.each([
    ["a Worker", { type: "worker", value: ["mail-handler"] }, "worker mail-handler"],
    ["a forward", { type: "forward", value: ["Owner@Example.com"] }, "forward owner@example.com"],
    ["a drop", { type: "drop" }, "drop"],
  ])("names the action of an enabled catch-all that takes %s", async (_what, action, text) => {
    const { tool } = ruleDeleteFor(catchAllRoute(ok({ ...CATCH_ALL_RULE, actions: [action] })))

    const { description } = await describing(tool, DELETE_ARGS)

    expect(description.facts.at(-1)).toEqual({
      label: "Afterwards",
      value: { text: "the catch-all takes the mail: {action}", values: { action: text } },
    })
  })

  test.each([
    ["a disabled catch-all", catchAllRoute(ok({ ...CATCH_ALL_RULE, enabled: false })), REJECTED],
    ["no catch-all", NO_CATCH_ALL, REJECTED],
    ["a catch-all of a shape it cannot describe", catchAllRoute(ok({ ...CATCH_ALL_RULE, actions: [] })), TAKES],
  ])("says where the mail goes for %s", async (_what, route, afterwards) => {
    const { tool } = ruleDeleteFor(route)

    const { description } = await describing(tool, DELETE_ARGS)

    expect(description.facts.at(-1)).toEqual({ label: "Afterwards", value: afterwards })
  })

  test.each([
    ["a catch-all read that fails", catchAllRoute({ status: 500, body: "down" })],
    ["a catch-all read that is refused", catchAllRoute(fail(403, [{ code: 10000, message: "Authentication error" }]))],
    ["a catch-all that is not a rule", catchAllRoute(ok("none"))],
  ])("does not say where the mail goes for %s, since it cannot tell", async (_what, route) => {
    const { tool } = ruleDeleteFor(route)

    const { description } = await describing(tool, DELETE_ARGS)

    expect(description.facts.map((fact) => fact.label)).not.toContain("Afterwards")
  })

  test("shows no text and no pins, and never reads the rule again", async () => {
    const { tool, requests } = ruleDeleteFor()

    const { description } = await describing(tool, DELETE_ARGS)

    expect(description.text).toBeUndefined()
    expect(description.pins).toBeUndefined()
    expect(readsOf(requests, RULE_PATH)).toBe(1)
  })

  test("gives the same description twice for the same state, an unreadable catch-all included", async () => {
    for (const route of [catchAllRoute(), catchAllRoute({ status: 500, body: "down" })]) {
      const { tool } = ruleDeleteFor(route)

      const first = await describing(tool, DELETE_ARGS)
      const second = await describing(tool, DELETE_ARGS)

      expect(second.description).toEqual(first.description)
    }
  })

  test("is accepted by the description check", async () => {
    const { tool } = ruleDeleteFor()

    const answer = await callDescription(tool, DELETE_ARGS, CTX)

    expect(answer?.headline).toEqual(HEADLINE)
    expect(answer?.facts).toHaveLength(3)
  })
})

describe("cloudflareEmailRuleDelete: describe refuses where execute would", () => {
  test.each<[string, FakeRoute[], ErrorCode, string]>([
    [
      "an unknown rule",
      [ruleRoute(fail(404, [{ code: 1004, message: "Not found" }]))],
      "not_found",
      "is not a routing rule",
    ],
    ["the catch-all", [ruleRoute(ok(CATCH_ALL_RULE))], "invalid_argument", "is the zone's catch-all"],
    [
      "the id of the catch-all, which Cloudflare will not read as a rule",
      [ruleRoute(INVALID_RULE_OPERATION), catchAllRoute(ok({ ...CATCH_ALL_RULE, id: RULE_ID }))],
      "invalid_argument",
      `${RULE_ID} is the zone's catch-all`,
    ],
    [
      "a Wrangler rule",
      [ruleRoute(ok({ ...CURRENT_RULE, source: "wrangler" }))],
      "invalid_argument",
      "managed by a Worker's Wrangler",
    ],
    [
      "a rule of an unusual shape",
      [ruleRoute(ok({ ...CURRENT_RULE, actions: [] }))],
      "invalid_argument",
      "has a shape these tools do not change",
    ],
    [
      "a rule that cannot be read",
      [ruleRoute(fail(403, [{ code: 10000, message: "Authentication error" }]))],
      "forbidden",
      "Zone → Email Routing Rules → Read",
    ],
  ])("throws for %s, and deletes and asks nothing", async (_what, routes, code, message) => {
    const { tool, requests } = ruleDeleteFor(...routes)

    const { error, asked } = await refusing(tool, DELETE_ARGS)

    expect(error.code).toBe(code)
    expect(error.message).toContain(message)
    expect(asked).toEqual([])
    expect(writes(requests)).toEqual([])
  })

  test("gives nothing to the description check for a call execute would refuse", async () => {
    const { tool } = ruleDeleteFor(ruleRoute(ok(CATCH_ALL_RULE)))

    expect(await callDescription(tool, DELETE_ARGS, CTX)).toBeUndefined()
  })
})
