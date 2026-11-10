import { describe, expect, test } from "bun:test"
import { toolError } from "../cloudflare/client.fixtures"
import { invoke } from "../tool"
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
  calls,
  editFor,
  entrypointRoute,
  refusalOf,
  rulesetOf,
} from "./edit.fixtures"

const NOTHING_CHANGED = " Nothing was changed."
const INVALID = "Invalid arguments for cloudflare_rules_edit: "
const UNKNOWN_ID = "9".repeat(32)
const BASE = { zone: ARGS.zone, phase: PHASE, rule: FIRST_ID, replaces: "1" }

describe("cloudflareRulesEdit: a call that names no change", () => {
  test("is refused before any request is sent", async () => {
    const { tool, requests } = editFor()

    const refusal = await refusalOf(invoke(tool, BASE, CTX))

    expect(refusal).toBe(
      `Name at least one of expression, action, action_parameters, description, enabled or position.${NOTHING_CHANGED}`,
    )
    expect(requests).toHaveLength(0)
  })

  test.each([
    [{ action: "block" }, 'The action of a rule in Single Redirects must be redirect, not "block".'],
    [{ action: "" }, 'The action of a rule in Single Redirects must be redirect, not "".'],
    [
      { phase: "http_request_cache_settings", action: "redirect" },
      'The action of a rule in Cache Rules must be set_cache_settings, not "redirect".',
    ],
  ])("refuses an action the phase does not take: %j, before any request is sent", async (extra, message) => {
    const { tool, requests } = editFor()

    const refusal = await refusalOf(invoke(tool, { ...BASE, ...extra }, CTX))

    expect(refusal).toBe(message + NOTHING_CHANGED)
    expect(requests).toHaveLength(0)
  })

  test.each([
    ["a phase that cannot be written", { phase: "http_ratelimit", enabled: false }, "phase: "],
    ["a rule id that is not 32 hex digits", { rule: "x", enabled: false }, "rule: "],
    ["a call without the version it replaces", { replaces: undefined, enabled: false }, "replaces: "],
    ["an empty expression", { expression: "" }, "expression: "],
    ["an expression of 4097 characters", { expression: "x".repeat(4097) }, "expression: "],
    ["a description of 501 characters", { description: "d".repeat(501) }, "description: "],
    ["parameters that are not an object", { action_parameters: "x" }, "action_parameters: "],
    ["a position with two keys", { position: { index: 1, after: SECOND_ID } }, "position: give exactly one"],
    ["an argument it does not know", { priority: 1 }, "priority: unknown argument"],
  ])("refuses %s before reading anything", async (_what, extra, message) => {
    const { tool, requests } = editFor()

    const refusal = await refusalOf(invoke(tool, { ...BASE, ...extra }, CTX))

    expect(refusal).toStartWith(INVALID)
    expect(refusal).toContain(message)
    expect(requests).toHaveLength(0)
  })
})

describe("cloudflareRulesEdit: the rule is not there", () => {
  test("a phase with no entry point has no rules, and nothing is written", async () => {
    const { tool, requests } = editFor(NO_ENTRYPOINT)

    const error = await toolError(invoke(tool, ARGS, CTX))

    expect(error.code).toBe("not_found")
    expect(error.message).toBe(`Single Redirects of example.com has no rules.${NOTHING_CHANGED}`)
    expect(calls(requests)).toEqual(["GET /zones", expect.stringContaining("/entrypoint")])
  })

  test("a rule the phase does not hold is not_found", async () => {
    const { tool, requests } = editFor()

    const error = await toolError(invoke(tool, { ...ARGS, rule: UNKNOWN_ID }, CTX))

    expect(error.code).toBe("not_found")
    expect(error.message).toBe(`No rule ${UNKNOWN_ID} in Single Redirects of example.com.${NOTHING_CHANGED}`)
    expect(requests.filter((request) => request.method !== "GET")).toHaveLength(0)
  })
})

describe("cloudflareRulesEdit: the rule changed since it was read", () => {
  test.each([["0"], ["2"], ["1 "]])("a rule at version 1 is stale for version %p", async (replaces) => {
    const { tool, requests } = editFor()

    const error = await toolError(invoke(tool, { ...ARGS, replaces }, CTX))

    expect(error.code).toBe("stale")
    expect(error.message).toBe(
      `Rule ${FIRST_ID} is now version 1, not ${replaces}; read the phase again before changing it.${NOTHING_CHANGED}`,
    )
    expect(requests.filter((request) => request.method !== "GET")).toHaveLength(0)
  })

  test("a rule without a version is stale for any version", async () => {
    const { tool } = editFor(entrypointRoute(PHASE, rulesetOf([{ ...RULE, version: undefined }])))

    const error = await toolError(invoke(tool, ARGS, CTX))

    expect(error.code).toBe("stale")
    expect(error.message).toContain("is now version unknown, not 1;")
  })
})

describe("cloudflareRulesEdit: a position the phase cannot give", () => {
  test.each([
    ["before itself", { before: FIRST_ID }, `Rule ${FIRST_ID} cannot be placed before or after itself.`],
    ["after itself", { after: FIRST_ID }, `Rule ${FIRST_ID} cannot be placed before or after itself.`],
    [
      "before a rule the phase lacks",
      { before: UNKNOWN_ID },
      `No rule ${UNKNOWN_ID} in Single Redirects of example.com.`,
    ],
    [
      "after a rule the phase lacks",
      { after: UNKNOWN_ID },
      `No rule ${UNKNOWN_ID} in Single Redirects of example.com.`,
    ],
    ["past the last place", { index: 4 }, "Position 4 is past the end of Single Redirects: the last place is 3."],
  ])("refuses %s, and sends nothing", async (_what, position, message) => {
    const { tool, requests } = editFor()

    const refusal = await refusalOf(invoke(tool, { ...ARGS, position }, CTX))

    expect(refusal).toBe(message + NOTHING_CHANGED)
    expect(requests.filter((request) => request.method !== "GET")).toHaveLength(0)
  })

  test("accepts the last place the rules give: as many as there are rules", async () => {
    const { tool } = editFor()

    const result = await invoke(tool, { ...ARGS, position: { index: RULES.length } }, CTX)

    expect(result.rule.after?.position).toBe(RULES.length)
  })
})

describe("cloudflareRulesEdit: a call that changes nothing", () => {
  const READS = `Rule ${FIRST_ID} already reads that way.${NOTHING_CHANGED}`

  test.each([
    ["the description it has", { description: RULE.description }],
    ["the expression it has", { expression: RULE.expression }],
    ["the parameters it has", { action_parameters: RULE.action_parameters }],
    ["the state it has", { enabled: true }],
    ["the action it has", { action: "redirect" }],
    [
      "all of these together",
      {
        expression: RULE.expression,
        action: "redirect",
        action_parameters: RULE.action_parameters,
        description: RULE.description,
        enabled: true,
      },
    ],
    ["the place it is at", { position: { index: 1 } }],
    ["a place before the rule that follows it", { position: { before: SECOND_ID } }],
    ["the description it has, and the place it is at", { description: RULE.description, position: { index: 1 } }],
  ])("refuses %s, and sends nothing", async (_what, extra) => {
    const { tool, requests } = editFor()

    const refusal = await refusalOf(invoke(tool, { ...BASE, ...extra }, CTX))

    expect(refusal).toBe(READS)
    expect(requests.filter((request) => request.method !== "GET")).toHaveLength(0)
  })

  test("sees an empty description as none, and empty parameters as none", async () => {
    const { tool } = editFor()

    const description = await refusalOf(invoke(tool, { ...BASE, rule: SECOND_ID, replaces: "2", description: "" }, CTX))
    const parameters = await refusalOf(
      invoke(tool, { ...BASE, rule: THIRD_ID, replaces: "5", action_parameters: {} }, CTX),
    )

    expect(description).toBe(`Rule ${SECOND_ID} already reads that way.${NOTHING_CHANGED}`)
    expect(parameters).toBe(`Rule ${THIRD_ID} already reads that way.${NOTHING_CHANGED}`)
  })

  test("sees a rule without a state as on", async () => {
    const { tool } = editFor(entrypointRoute(PHASE, rulesetOf([{ ...RULE, enabled: undefined }])))

    expect(await refusalOf(invoke(tool, { ...BASE, enabled: true }, CTX))).toBe(READS)
  })
})
