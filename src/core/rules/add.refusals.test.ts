import { describe, expect, test } from "bun:test"
import { invoke } from "../tool"
import {
  ARGS,
  CTX,
  EXPRESSION,
  FIRST_ID,
  FIRST_RULE,
  NEW_RULE_ID,
  NO_ENTRYPOINT,
  PHASE,
  SECOND_RULE,
  addFor,
  calls,
  entrypointRoute,
  refusalOf,
  rulesetOf,
  writes,
} from "./add.fixtures"

const NOTHING_CHANGED = " Nothing was changed."
const INVALID = "Invalid arguments for cloudflare_rules_add: "
const UNKNOWN_ID = "9".repeat(32)

describe("cloudflareRulesAdd: an action the phase does not take", () => {
  test.each([
    [{ action: "block" }, 'The action of a rule in Single Redirects must be redirect, not "block".'],
    [
      { phase: "http_request_cache_settings", action: "redirect" },
      'The action of a rule in Cache Rules must be set_cache_settings, not "redirect".',
    ],
    [{ action: "" }, 'The action of a rule in Single Redirects must be redirect, not "".'],
  ])("refuses %j before any request is sent", async (extra, message) => {
    const { tool, requests } = addFor()

    const refusal = await refusalOf(invoke(tool, { ...ARGS, ...extra }, CTX))

    expect(refusal).toBe(message + NOTHING_CHANGED)
    expect(requests).toHaveLength(0)
  })
})

describe("cloudflareRulesAdd: arguments the schema refuses", () => {
  test.each(["http_request_firewall_custom", "http_ratelimit", "http_custom_errors", "http_request_firewall_managed"])(
    "refuses the phase %s before reading anything",
    async (phase) => {
      const { tool, requests } = addFor()

      const refusal = await refusalOf(invoke(tool, { ...ARGS, phase }, CTX))

      expect(refusal).toStartWith(`${INVALID}phase: `)
      expect(requests).toHaveLength(0)
    },
  )

  test.each([
    ["an empty expression", { expression: "" }, "expression: "],
    ["an expression of 4097 characters", { expression: "x".repeat(4097) }, "expression: "],
    ["a description of 501 characters", { description: "d".repeat(501) }, "description: "],
    ["parameters that are not an object", { action_parameters: "x" }, "action_parameters: "],
    ["an enabled that is not a boolean", { enabled: "yes" }, "enabled: "],
    ["an argument it does not know", { priority: 1 }, "priority: unknown argument"],
  ])("refuses %s before reading anything", async (_what, extra, message) => {
    const { tool, requests } = addFor()

    const refusal = await refusalOf(invoke(tool, { ...ARGS, ...extra }, CTX))

    expect(refusal).toStartWith(INVALID)
    expect(refusal).toContain(message)
    expect(requests).toHaveLength(0)
  })

  test("accepts an expression of 4096 characters and a description of 500", async () => {
    const { tool, requests } = addFor()

    await invoke(tool, { ...ARGS, expression: "x".repeat(4096), description: "d".repeat(500) }, CTX)

    expect(writes(requests)).toHaveLength(1)
  })

  test.each([
    ["two keys", { before: FIRST_ID, after: FIRST_ID }],
    ["all three keys", { before: FIRST_ID, after: FIRST_ID, index: 1 }],
    ["no key", {}],
    ["a key that is left out of the call", { index: undefined }],
  ])("refuses a position with %s, saying it takes exactly one", async (_what, position) => {
    const { tool, requests } = addFor()

    const refusal = await refusalOf(invoke(tool, { ...ARGS, position }, CTX))

    expect(refusal).toStartWith(`${INVALID}position: give exactly one of before, after and index`)
    expect(requests).toHaveLength(0)
  })

  test.each([
    ["an index of 0", { index: 0 }, "position.index: "],
    ["a fractional index", { index: 1.5 }, "position.index: "],
    ["a rule id that is not 32 hex digits", { before: "x" }, "position.before: "],
    ["a key it does not know", { index: 1, last: true }, "unknown argument"],
  ])("refuses a position with %s", async (_what, position, message) => {
    const { tool, requests } = addFor()

    const refusal = await refusalOf(invoke(tool, { ...ARGS, position }, CTX))

    expect(refusal).toStartWith(INVALID)
    expect(refusal).toContain(message)
    expect(requests).toHaveLength(0)
  })
})

describe("cloudflareRulesAdd: a rule the phase already holds", () => {
  const SAME = { expression: FIRST_RULE.expression, action_parameters: FIRST_RULE.action_parameters }
  const DUPLICATE = `Rule ${FIRST_ID} (position 1) already has that expression and action.${NOTHING_CHANGED}`

  test("refuses the same expression, action and parameters, and sends no write", async () => {
    const { tool, requests } = addFor()

    expect(await refusalOf(invoke(tool, { ...ARGS, ...SAME }, CTX))).toBe(DUPLICATE)
    expect(calls(requests)).toEqual(["GET /zones", expect.stringContaining("/entrypoint")])
  })

  test("compares the parameters without regard to the order of their keys", async () => {
    const { tool } = addFor()
    const parameters = { from_value: { target_url: { value: "/new" }, status_code: 301 } }

    expect(
      await refusalOf(invoke(tool, { ...ARGS, expression: FIRST_RULE.expression, action_parameters: parameters }, CTX)),
    ).toBe(DUPLICATE)
  })

  test("names a rule that is off, at its position", async () => {
    const { tool } = addFor()

    const refusal = await refusalOf(
      invoke(
        tool,
        { ...ARGS, expression: SECOND_RULE.expression, action_parameters: SECOND_RULE.action_parameters },
        CTX,
      ),
    )

    expect(refusal).toBe(
      `Rule ${SECOND_RULE.id} (position 2) already has that expression and action.${NOTHING_CHANGED}`,
    )
  })

  test.each([
    ["parameters left out and a rule with none", undefined, undefined],
    ["parameters left out and a rule with null", undefined, null],
    ["parameters left out and a rule with an empty object", undefined, {}],
    ["empty parameters and a rule with none", {}, undefined],
  ])("treats %s as the same", async (_what, given, held) => {
    const rule = { id: FIRST_ID, expression: EXPRESSION, action: "redirect", action_parameters: held }
    const { tool } = addFor(entrypointRoute(PHASE, rulesetOf([rule])))

    const refusal = await refusalOf(invoke(tool, { ...ARGS, action_parameters: given }, CTX))

    expect(refusal).toBe(`Rule ${FIRST_ID} (position 1) already has that expression and action.${NOTHING_CHANGED}`)
  })

  test.each([
    [
      "other parameters",
      { expression: FIRST_RULE.expression, action_parameters: { from_value: { status_code: 302 } } },
    ],
    ["parameters where the rule has some", { expression: FIRST_RULE.expression }],
    ["another expression", { expression: "true", action_parameters: FIRST_RULE.action_parameters }],
  ])("adds a rule with %s", async (_what, extra) => {
    const { tool } = addFor()

    const result = await invoke(tool, { ...ARGS, ...extra }, CTX)

    expect(result.rule.after?.id).toBe(NEW_RULE_ID)
  })
})

describe("cloudflareRulesAdd: a position the phase cannot give", () => {
  test.each([
    ["before", { before: UNKNOWN_ID }],
    ["after", { after: UNKNOWN_ID }],
  ])("refuses %s a rule the phase lacks, and sends no write", async (_what, position) => {
    const { tool, requests } = addFor()

    const refusal = await refusalOf(invoke(tool, { ...ARGS, position }, CTX))

    expect(refusal).toBe(`No rule ${UNKNOWN_ID} in Single Redirects.${NOTHING_CHANGED}`)
    expect(writes(requests)).toEqual([])
  })

  test("refuses an index past the place after the last rule, and sends no write", async () => {
    const { tool, requests } = addFor()

    const refusal = await refusalOf(invoke(tool, { ...ARGS, position: { index: 4 } }, CTX))

    expect(refusal).toBe(
      `Position 4 is past the end of Single Redirects: the last place a new rule can take is 3.${NOTHING_CHANGED}`,
    )
    expect(writes(requests)).toEqual([])
  })

  test.each([
    ["an index of 2", { index: 2 }],
    ["before a rule", { before: FIRST_ID }],
    ["after a rule", { after: FIRST_ID }],
  ])("refuses %s in a phase with no entry point, saying it can only be first", async (_what, position) => {
    const { tool, requests } = addFor(NO_ENTRYPOINT)

    const refusal = await refusalOf(invoke(tool, { ...ARGS, position }, CTX))

    expect(refusal).toBe(
      `Single Redirects of example.com has no rules yet, so the position can only be first.${NOTHING_CHANGED}`,
    )
    expect(writes(requests)).toEqual([])
  })

  test("takes the first place in a phase with an empty entry point, and the only place after no rule", async () => {
    const { tool, requests } = addFor(entrypointRoute(PHASE, rulesetOf([])))

    await invoke(tool, { ...ARGS, position: { index: 1 } }, CTX)
    const refusal = await refusalOf(invoke(tool, { ...ARGS, position: { index: 2 } }, CTX))

    expect(refusal).toStartWith("Position 2 is past the end of Single Redirects")
    expect(writes(requests)).toHaveLength(1)
  })
})
