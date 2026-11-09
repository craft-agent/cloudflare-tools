import { describe, expect, test } from "bun:test"
import { callDescription } from "../describe"
import { describing, refusing } from "../describe.fixtures"
import {
  ARGS,
  CTX,
  FIRST_ID,
  NO_ENTRYPOINT,
  PHASE,
  RULE,
  RULES,
  SECOND_ID,
  THIRD_ID,
  deleteFor,
  entrypointRoute,
  rulesetOf,
  shaped,
  writes,
} from "./delete.fixtures"

const HEADLINE = {
  text: "About to delete the rule {rule} of {product} of {zone}",
  values: { rule: RULE.description, product: "Single Redirects", zone: "example.com" },
}
const AT_ONE = { label: "Position", value: { text: "position {index}", values: { index: 1 } } }

describe("cloudflareRulesDelete: describe", () => {
  test("states its intent", () => {
    expect(deleteFor().tool.intent).toBe("About to delete a rule")
  })

  test("names the rule, shows its action, parameters, place and description, and carries its expression", async () => {
    const { tool, requests } = deleteFor()

    const { description, asked } = await describing(tool, ARGS)

    expect(description).toEqual({
      headline: HEADLINE,
      facts: [
        { label: "Action", value: "redirect" },
        { label: "Parameters", value: JSON.stringify(RULE.action_parameters) },
        AT_ONE,
        { label: "Description", value: RULE.description },
      ],
      text: { label: "Expression", body: RULE.expression },
      pins: { rule: JSON.stringify(shaped(1)) },
    })
    expect(asked).toEqual([])
    expect(writes(requests)).toEqual([])
  })

  test("names a rule without a description, or with an empty one, by its id, and leaves the description out", async () => {
    const { tool } = deleteFor(entrypointRoute(PHASE, rulesetOf([{ ...RULE, description: "" }, ...RULES.slice(1)])))

    const empty = await describing(tool, ARGS)
    const none = await describing(deleteFor().tool, { ...ARGS, rule: SECOND_ID })

    expect(empty.description.headline!.values).toMatchObject({ rule: FIRST_ID })
    expect(empty.description.facts.map((fact) => fact.label)).not.toContain("Description")
    expect(none.description.headline!.values).toMatchObject({ rule: SECOND_ID })
  })

  test("says that a rule that is off is, and gives its place", async () => {
    const { tool } = deleteFor()

    const { description } = await describing(tool, { ...ARGS, rule: SECOND_ID })

    expect(description.facts.map((fact) => fact.label)).toEqual(["Action", "Parameters", "Position", "State"])
    expect(description.facts[2]).toEqual({
      label: "Position",
      value: { text: "position {index}", values: { index: 2 } },
    })
    expect(description.facts[3]).toEqual({ label: "State", value: { text: "off" } })
  })

  test("leaves out the parameters of a rule that has none, or an empty object", async () => {
    const empty = await describing(
      deleteFor(entrypointRoute(PHASE, rulesetOf([{ ...RULE, action_parameters: {} }, ...RULES.slice(1)]))).tool,
      ARGS,
    )
    const none = await describing(deleteFor().tool, { ...ARGS, rule: THIRD_ID })

    expect(empty.description.facts.map((fact) => fact.label)).toEqual(["Action", "Position", "Description"])
    expect(none.description.facts.map((fact) => fact.label)).toEqual(["Action", "Position"])
  })

  test("leaves out the text of a rule without an expression", async () => {
    const { tool } = deleteFor(entrypointRoute(PHASE, rulesetOf([{ ...RULE, expression: "" }, ...RULES.slice(1)])))

    const { description } = await describing(tool, ARGS)

    expect(description).not.toHaveProperty("text")
  })

  test("carries the whole expression, never trimmed", async () => {
    const expression = `(http.host eq "${"a".repeat(4000)}")`
    const { tool } = deleteFor(entrypointRoute(PHASE, rulesetOf([{ ...RULE, expression }, ...RULES.slice(1)])))

    const { description } = await describing(tool, ARGS)

    expect(description.text).toEqual({ label: "Expression", body: expression })
  })

  test("gives the same description twice for the same state", async () => {
    const { tool } = deleteFor()

    const first = await describing(tool, ARGS)
    const second = await describing(tool, ARGS)

    expect(second.description).toEqual(first.description)
  })

  test("is accepted by the description check", async () => {
    const { tool } = deleteFor()

    const answer = await callDescription(tool, ARGS, CTX)

    expect(answer?.headline).toEqual(HEADLINE)
    expect(answer?.facts).toHaveLength(4)
  })
})

describe("cloudflareRulesDelete: describe refuses where execute would", () => {
  test.each([
    ["a rule the phase lacks", [], { ...ARGS, rule: "9".repeat(32) }, "No rule"],
    ["a phase with no entry point", [NO_ENTRYPOINT], ARGS, "has no rules"],
  ])("throws for %s, and deletes and asks nothing", async (_what, routes, args, message) => {
    const { tool, requests } = deleteFor(...routes)

    const { error, asked } = await refusing(tool, args)

    expect(error.code).toBe("not_found")
    expect(error.message).toContain(message)
    expect(asked).toEqual([])
    expect(writes(requests)).toEqual([])
  })

  test("gives nothing to the description check for a call execute would refuse", async () => {
    const { tool } = deleteFor()

    expect(await callDescription(tool, { ...ARGS, rule: "9".repeat(32) }, CTX)).toBeUndefined()
  })
})
