import { describe, expect, test } from "bun:test"
import { callDescription } from "../describe"
import { describing, refusing } from "../describe.fixtures"
import {
  ARGS,
  CTX,
  EXISTING,
  EXPRESSION,
  FIRST_ID,
  NO_ENTRYPOINT,
  PARAMETERS,
  SECOND_ID,
  addFor,
  entrypointRoute,
  PHASE,
  rulesetOf,
  writes,
} from "./add.fixtures"

const HEADLINE = {
  text: "About to add a rule to {product} of {zone}",
  values: { product: "Single Redirects", zone: "example.com" },
}
const TEXT = { label: "Expression", body: EXPRESSION }

describe("cloudflareRulesAdd: describe", () => {
  test("states its intent", () => {
    expect(addFor().tool.intent).toBe("About to add a rule")
  })

  test("names the product and the zone, the action, and the expression as its text", async () => {
    const { tool, requests } = addFor()

    const { description, asked } = await describing(tool, ARGS)

    expect(description).toEqual({ headline: HEADLINE, facts: [{ label: "Action", value: "redirect" }], text: TEXT })
    expect(asked).toEqual([])
    expect(writes(requests)).toEqual([])
  })

  test("names the zone as Cloudflare reports it, found by id too", async () => {
    const { tool } = addFor()

    const { description } = await describing(tool, { ...ARGS, zone: "f".repeat(32) })

    expect(description.headline!.values).toEqual({ product: "Single Redirects", zone: "example.com" })
  })

  test("shows the parameters as compact JSON, the description, and that the rule is off, in that order", async () => {
    const { tool } = addFor()

    const { description } = await describing(tool, {
      ...ARGS,
      action_parameters: PARAMETERS,
      position: { index: 2 },
      description: "Old host",
      enabled: false,
    })

    expect(description.facts).toEqual([
      { label: "Action", value: "redirect" },
      { label: "Parameters", value: JSON.stringify(PARAMETERS) },
      { label: "Position", value: { text: "position {index}", values: { index: 2 } } },
      { label: "Description", value: "Old host" },
      { label: "State", value: { text: "off" } },
    ])
  })

  test("says nothing of the state for a rule that is on, said or not", async () => {
    const { tool } = addFor()

    const { description } = await describing(tool, { ...ARGS, enabled: true })

    expect(description.facts).toEqual([{ label: "Action", value: "redirect" }])
  })

  test("names the rule a position refers to by its description, else by its id", async () => {
    const { tool } = addFor()

    const before = await describing(tool, { ...ARGS, position: { before: FIRST_ID } })
    const after = await describing(tool, { ...ARGS, position: { after: SECOND_ID } })

    expect(before.description.facts[1]).toEqual({
      label: "Position",
      value: { text: "before rule {rule}", values: { rule: "Send /old to /new" } },
    })
    expect(after.description.facts[1]).toEqual({
      label: "Position",
      value: { text: "after rule {rule}", values: { rule: SECOND_ID } },
    })
  })

  test("names a rule whose description is empty by its id", async () => {
    const { tool } = addFor(entrypointRoute(PHASE, rulesetOf([{ ...EXISTING[0]!, description: "" }])))

    const { description } = await describing(tool, { ...ARGS, position: { after: FIRST_ID } })

    expect(description.facts[1]!.value).toEqual({ text: "after rule {rule}", values: { rule: FIRST_ID } })
  })

  test("shows a phase with no entry point, and the first place", async () => {
    const { tool, requests } = addFor(NO_ENTRYPOINT)

    const { description } = await describing(tool, { ...ARGS, position: { index: 1 } })

    expect(description.headline).toEqual(HEADLINE)
    expect(description.facts[1]).toEqual({
      label: "Position",
      value: { text: "position {index}", values: { index: 1 } },
    })
    expect(writes(requests)).toEqual([])
  })

  test("carries the whole expression, never trimmed", async () => {
    const { tool } = addFor()
    const expression = `(http.host eq "${"a".repeat(4000)}")`

    const { description } = await describing(tool, { ...ARGS, expression })

    expect(description.text).toEqual({ label: "Expression", body: expression })
  })

  test("pins nothing, and gives the same description twice for the same state", async () => {
    const { tool } = addFor()

    const first = await describing(tool, ARGS)
    const second = await describing(tool, ARGS)

    expect(first.description.pins).toBeUndefined()
    expect(second.description).toEqual(first.description)
  })

  test("is accepted by the description check", async () => {
    const { tool } = addFor()

    const answer = await callDescription(tool, { ...ARGS, description: "x", enabled: false }, CTX)

    expect(answer?.headline).toEqual(HEADLINE)
    expect(answer?.facts).toHaveLength(3)
    expect(answer?.text).toEqual(TEXT)
  })
})

describe("cloudflareRulesAdd: describe refuses where execute would", () => {
  test.each([
    ["an action the phase does not take", { ...ARGS, action: "block" }, "must be redirect"],
    [
      "a rule the phase already holds",
      { ...ARGS, expression: EXISTING[0]!.expression, action_parameters: EXISTING[0]!.action_parameters },
      "already has that expression",
    ],
    ["a rule id the phase lacks", { ...ARGS, position: { before: "9".repeat(32) } }, "No rule"],
    ["a place past the end", { ...ARGS, position: { index: 4 } }, "past the end"],
  ])("throws for %s, and writes and asks nothing", async (_what, args, message) => {
    const { tool, requests } = addFor()

    const { error, asked } = await refusing(tool, args)

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain(message)
    expect(asked).toEqual([])
    expect(writes(requests)).toEqual([])
  })

  test("gives nothing to the description check for a call execute would refuse", async () => {
    const { tool } = addFor()

    expect(await callDescription(tool, { ...ARGS, action: "block" }, CTX)).toBeUndefined()
  })
})
