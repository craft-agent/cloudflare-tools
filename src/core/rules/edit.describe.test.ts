import { describe, expect, test } from "bun:test"
import { callDescription } from "../describe"
import { describing, refusing } from "../describe.fixtures"
import {
  ARGS,
  CTX,
  FIRST_ID,
  NEW_DESCRIPTION,
  PARAMETERS,
  PHASE,
  RULE,
  RULES,
  SECOND_ID,
  SECOND_RULE,
  THIRD_ID,
  editFor,
  entrypointRoute,
  rulesetOf,
  shaped,
  writes,
} from "./edit.fixtures"

const HEADLINE = {
  text: "About to change the rule {rule} of {product} of {zone}",
  values: { rule: RULE.description, product: "Single Redirects", zone: "example.com" },
}
const EXPRESSION = { label: "Expression", body: RULE.expression }
const BASE = { zone: ARGS.zone, phase: PHASE, rule: FIRST_ID, replaces: "1" }
const SECOND = { ...BASE, rule: SECOND_ID, replaces: "2" }

/** The second rule as the tool shapes it, in the key order the pin carries: it has no reference, description or time. */
const SECOND_SHAPED = {
  position: 2,
  id: SECOND_ID,
  ref: null,
  description: null,
  expression: SECOND_RULE.expression,
  action: "redirect",
  action_parameters: SECOND_RULE.action_parameters,
  enabled: false,
  version: "2",
  last_updated: null,
}

describe("cloudflareRulesEdit: describe", () => {
  test("states its intent", () => {
    expect(editFor().tool.intent).toBe("About to change a rule")
  })

  test("names the rule, shows what changes as before and after, and carries the expression as it is", async () => {
    const { tool, requests } = editFor()

    const { description, asked } = await describing(tool, ARGS)

    expect(description).toEqual({
      headline: HEADLINE,
      facts: [{ label: "Description", value: `${RULE.description} → ${NEW_DESCRIPTION}` }],
      text: EXPRESSION,
      pins: { rule: JSON.stringify(shaped(1)) },
    })
    expect(asked).toEqual([])
    expect(writes(requests)).toEqual([])
  })

  test("names a rule without a description, or with an empty one, by its id", async () => {
    const { tool } = editFor(entrypointRoute(PHASE, rulesetOf([{ ...RULE, description: "" }])))

    const empty = await describing(tool, { ...BASE, enabled: false })
    const none = await describing(editFor().tool, { ...SECOND, enabled: true })

    expect(empty.description.headline!.values).toMatchObject({ rule: FIRST_ID })
    expect(none.description.headline!.values).toMatchObject({ rule: SECOND_ID })
  })

  test("names the zone as Cloudflare reports it, found by id too", async () => {
    const { tool } = editFor()

    const { description } = await describing(tool, { ...ARGS, zone: "f".repeat(32) })

    expect(description.headline!.values).toMatchObject({ zone: "example.com" })
  })

  test("shows each part that changes, in the order action, parameters, description, state, position", async () => {
    const legacy = { ...RULE, action: "block", enabled: false }
    const { tool } = editFor(entrypointRoute(PHASE, rulesetOf([legacy, ...RULES.slice(1)])))

    const { description } = await describing(tool, {
      ...BASE,
      action: "redirect",
      action_parameters: PARAMETERS,
      description: "",
      enabled: true,
      position: { after: SECOND_ID },
    })

    expect(description.facts).toEqual([
      { label: "Action", value: "block → redirect" },
      { label: "Parameters", value: `${JSON.stringify(RULE.action_parameters)} → ${JSON.stringify(PARAMETERS)}` },
      { label: "Description", value: `${RULE.description} → (none)` },
      { label: "State", value: { text: "off → on" } },
      { label: "Position", value: { text: "position {from} → {to}", values: { from: 1, to: 2 } } },
    ])
  })

  test("shows a rule going off, a description it gains, and parameters it gains as `{}`", async () => {
    const { tool } = editFor()

    const off = await describing(tool, { ...BASE, enabled: false })
    const gains = await describing(tool, { ...SECOND, description: "Older" })
    const parameters = await describing(tool, { ...BASE, rule: THIRD_ID, replaces: "5", action_parameters: PARAMETERS })

    expect(off.description.facts).toEqual([{ label: "State", value: { text: "on → off" } }])
    expect(gains.description.facts).toEqual([{ label: "Description", value: "(none) → Older" }])
    expect(parameters.description.facts).toEqual([{ label: "Parameters", value: `{} → ${JSON.stringify(PARAMETERS)}` }])
  })

  test("shows the move of a rule up as its places before and after", async () => {
    const { tool } = editFor()

    const { description } = await describing(tool, { ...SECOND, position: { before: FIRST_ID } })

    expect(description.facts).toEqual([
      { label: "Position", value: { text: "position {from} → {to}", values: { from: 2, to: 1 } } },
    ])
  })

  test.each([
    ["before", { before: THIRD_ID }, 2],
    ["after", { after: THIRD_ID }, 3],
    ["index", { index: 3 }, 3],
  ])("counts the place a rule takes for a position given as %s", async (_what, position, to) => {
    const { tool } = editFor()

    const { description } = await describing(tool, { ...BASE, position })

    expect(description.facts[0]!.value).toEqual({ text: "position {from} → {to}", values: { from: 1, to } })
  })

  test("says nothing of a part that does not change, or a position that leaves the rule where it is", async () => {
    const { tool } = editFor()

    const { description } = await describing(tool, {
      ...ARGS,
      expression: RULE.expression,
      enabled: true,
      action_parameters: RULE.action_parameters,
      position: { index: 1 },
    })

    expect(description.facts).toEqual([{ label: "Description", value: `${RULE.description} → ${NEW_DESCRIPTION}` }])
  })

  test("shows a changed expression as the old one, an arrow line and the new one", async () => {
    const { tool } = editFor()
    const expression = '(http.host eq "old.example.com")'

    const { description } = await describing(tool, { ...BASE, expression })

    expect(description.text).toEqual({ label: "Expression", body: `${RULE.expression}\n→\n${expression}` })
    expect(description.facts).toEqual([])
  })

  test("carries both expressions whole, never trimmed", async () => {
    const { tool } = editFor()
    const expression = `(http.host eq "${"a".repeat(4000)}")`

    const { description } = await describing(tool, { ...BASE, expression })

    expect(description.text!.body).toBe(`${RULE.expression}\n→\n${expression}`)
  })

  test("pins the rule as it was read, and gives the same description twice for the same state", async () => {
    const { tool } = editFor()

    const first = await describing(tool, { ...SECOND, position: { index: 1 } })
    const second = await describing(tool, { ...SECOND, position: { index: 1 } })

    expect(first.description.pins).toEqual({ rule: JSON.stringify(SECOND_SHAPED) })
    expect(second.description).toEqual(first.description)
  })

  test("is accepted by the description check", async () => {
    const { tool } = editFor()

    const answer = await callDescription(tool, { ...ARGS, enabled: false }, CTX)

    expect(answer?.headline).toEqual(HEADLINE)
    expect(answer?.facts).toHaveLength(2)
    expect(answer?.text).toEqual(EXPRESSION)
  })
})

describe("cloudflareRulesEdit: describe refuses where execute would", () => {
  test.each([
    ["a call that names no change", BASE, "invalid_argument", "Name at least one"],
    ["an action the phase does not take", { ...BASE, action: "block" }, "invalid_argument", "must be redirect"],
    ["a rule the phase lacks", { ...BASE, rule: "9".repeat(32), enabled: false }, "not_found", "No rule"],
    ["a rule changed since it was read", { ...BASE, replaces: "0", enabled: false }, "stale", "is now version 1"],
    ["a position at the rule itself", { ...BASE, position: { after: FIRST_ID } }, "invalid_argument", "itself"],
    ["a place past the end", { ...BASE, position: { index: 4 } }, "invalid_argument", "past the end"],
    ["a change that alters nothing", { ...BASE, enabled: true }, "invalid_argument", "already reads that way"],
  ] as const)("throws for %s, and writes and asks nothing", async (_what, args, code, message) => {
    const { tool, requests } = editFor()

    const { error, asked } = await refusing(tool, args)

    expect(error.code).toBe(code)
    expect(error.message).toContain(message)
    expect(asked).toEqual([])
    expect(writes(requests)).toEqual([])
  })

  test("gives nothing to the description check for a call execute would refuse", async () => {
    const { tool } = editFor()

    expect(await callDescription(tool, { ...BASE, replaces: "0", enabled: false }, CTX)).toBeUndefined()
  })
})
