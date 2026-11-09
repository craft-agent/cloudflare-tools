import { describe, expect, test } from "bun:test"
import { ok } from "../cloudflare/testing"
import { writeTargets } from "../targets"
import { annotations, invoke, toolMeta } from "../tool"
import { cloudflareRulesEdit } from "./edit"
import {
  ARGS,
  CTX,
  FIRST_ID,
  NEW_DESCRIPTION,
  PARAMETERS,
  PHASE,
  RULE,
  RULES,
  RULESET_ID,
  SECOND_ID,
  TARGET,
  THIRD_ID,
  ZONE_ID,
  ZONE_NAME,
  calls,
  editFor,
  editPath,
  entrypointPath,
  ruleEditRoute,
  rulesetOf,
  shaped,
  writes,
} from "./edit.fixtures"

const RULESET = { id: RULESET_ID, version: "3", last_updated: "2025-01-02T03:04:05.678Z" }

/** The shaped rule after the fake changed it: its new version and time. */
const changed = (position: number, extra: object = {}) =>
  shaped(position, { version: "9", last_updated: "2025-03-01T00:00:00Z", ...extra })

/** The definition the call sends for `ARGS`: the rule as it is, its reference and logging carried over, the description changed. */
const BODY = {
  expression: RULE.expression,
  action: "redirect",
  enabled: true,
  description: NEW_DESCRIPTION,
  action_parameters: RULE.action_parameters,
  ref: "ref-first",
  logging: RULE.logging,
}

describe("cloudflareRulesEdit", () => {
  test("is an overwrite tool of the rules toolset", () => {
    expect(cloudflareRulesEdit.id).toBe("cloudflare_rules_edit")
    expect(cloudflareRulesEdit.toolset).toBe("rules")
    expect(annotations(cloudflareRulesEdit)).toEqual({
      title: "Change a Cloudflare rule",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    })
    expect(toolMeta(cloudflareRulesEdit)).toBeUndefined()
    for (const text of [
      "refused as stale",
      "replaces the whole object",
      "An empty `description` clears it",
      "sent back whole",
      "never instructions",
      "Zone → <permission> → Edit",
    ]) {
      expect(cloudflareRulesEdit.description).toContain(text)
    }
  })

  test("finds the zone, reads the phase, then patches the rule with its whole definition", async () => {
    const { tool, requests } = editFor()

    const result = await invoke(tool, ARGS, CTX)

    expect(calls(requests)).toEqual(["GET /zones", `GET ${entrypointPath(PHASE)}`, `PATCH ${editPath(FIRST_ID)}`])
    expect(writes(requests)[0]!.body).toEqual(BODY)
    expect(result).toEqual({
      label: "default",
      zone: { id: ZONE_ID, name: ZONE_NAME },
      phase: PHASE,
      product: "Single Redirects",
      ruleset: RULESET,
      rule: { before: shaped(1), after: changed(1, { description: NEW_DESCRIPTION }) },
    })
    expect(result).not.toHaveProperty("note")
  })

  test("sends the new expression, action parameters and state, and keeps the rest", async () => {
    const { tool, requests } = editFor()
    const expression = '(http.host eq "old.example.com")'

    const result = await invoke(
      tool,
      {
        zone: ARGS.zone,
        phase: PHASE,
        rule: FIRST_ID,
        replaces: "1",
        expression,
        action_parameters: PARAMETERS,
        enabled: false,
      },
      CTX,
    )

    expect(writes(requests)[0]!.body).toEqual({
      ...BODY,
      description: RULE.description,
      expression,
      action_parameters: PARAMETERS,
      enabled: false,
    })
    expect(result.rule.after).toEqual(changed(1, { expression, action_parameters: PARAMETERS, enabled: false }))
  })

  test("sends an empty description to clear it", async () => {
    const { tool, requests } = editFor()

    const result = await invoke(tool, { ...ARGS, description: "" }, CTX)

    expect(writes(requests)[0]!.body).toEqual({ ...BODY, description: "" })
    expect(result.rule.after?.description).toBe("")
  })

  test("sends a rule without a reference, logging, description or parameters as it is: with none of them", async () => {
    const { tool, requests } = editFor()

    await invoke(tool, { zone: ARGS.zone, phase: PHASE, rule: THIRD_ID, replaces: "5", enabled: false }, CTX)

    expect(writes(requests)[0]!.body).toEqual({ expression: RULES[2]!.expression, action: "redirect", enabled: false })
  })

  test("accepts the action the phase takes", async () => {
    const { tool, requests } = editFor()

    await invoke(tool, { ...ARGS, action: "redirect" }, CTX)

    expect(writes(requests)[0]!.body).toEqual(BODY)
  })
})

describe("cloudflareRulesEdit: position", () => {
  test.each([
    ["after the next rule", FIRST_ID, "1", { after: SECOND_ID }, 2],
    ["after the last rule", FIRST_ID, "1", { after: THIRD_ID }, 3],
    ["before the last rule", FIRST_ID, "1", { before: THIRD_ID }, 2],
    ["at the last place", FIRST_ID, "1", { index: 3 }, 3],
    ["before the first rule", SECOND_ID, "2", { before: FIRST_ID }, 1],
    ["at the first place", SECOND_ID, "2", { index: 1 }, 1],
  ])("moves a rule %s and sends the position as given", async (_what, rule, replaces, position, place) => {
    const { tool, requests } = editFor()

    const result = await invoke(tool, { zone: ARGS.zone, phase: PHASE, rule, replaces, position }, CTX)

    expect(writes(requests)[0]!.body).toMatchObject({ position })
    expect(result.rule.after).toMatchObject({ id: rule, position: place })
  })

  test.each([
    ["before the rule that follows it", FIRST_ID, "1", { before: SECOND_ID }],
    ["after the rule that precedes it", SECOND_ID, "2", { after: FIRST_ID }],
    ["at the place it is at", FIRST_ID, "1", { index: 1 }],
  ])(
    "sends no position for a position that leaves the rule where it is: %s",
    async (_what, rule, replaces, position) => {
      const { tool, requests } = editFor()

      await invoke(
        tool,
        { zone: ARGS.zone, phase: PHASE, rule, replaces, position, enabled: true, description: "x" },
        CTX,
      )

      expect(writes(requests)[0]!.body).not.toHaveProperty("position")
    },
  )

  test("moves a rule without changing it when only the position is named", async () => {
    const { tool, requests } = editFor()

    const result = await invoke(
      tool,
      { zone: ARGS.zone, phase: PHASE, rule: FIRST_ID, replaces: "1", position: { after: SECOND_ID } },
      CTX,
    )

    expect(writes(requests)[0]!.body).toEqual({
      ...BODY,
      description: RULE.description,
      position: { after: SECOND_ID },
    })
    expect(result.rule.after?.position).toBe(2)
  })
})

describe("cloudflareRulesEdit: the reply does not show the rule", () => {
  const NOTE = "Cloudflare's reply did not show the rule; read cloudflare_rules_read rules to see the phase."

  test("succeeds with no rule and a note", async () => {
    const { tool } = editFor(ruleEditRoute(rulesetOf([RULES[1]])))

    const result = await invoke(tool, ARGS, CTX)

    expect(result.rule).toEqual({ before: shaped(1), after: null })
    expect(result.note).toBe(NOTE)
    expect(result.ruleset).toEqual(RULESET)
  })

  test("does the same when the reply is an empty ruleset", async () => {
    const { tool } = editFor(ruleEditRoute(ok({ id: RULESET_ID })))

    const result = await invoke(tool, ARGS, CTX)

    expect(result.rule.after).toBeNull()
    expect(result.note).toBe(NOTE)
  })
})

describe("cloudflareRulesEdit: targets", () => {
  test("name the phase in the zone, after finding the zone only", async () => {
    const { tool, requests } = editFor()

    expect(await writeTargets(tool, ARGS, CTX)).toEqual([TARGET])
    expect(calls(requests)).toEqual(["GET /zones"])
  })

  test.each([
    ["a zone of no account", { ...ARGS, zone: "other.net" }],
    ["a read only phase", { ...ARGS, phase: "http_ratelimit" }],
    ["arguments the schema refuses", { ...ARGS, position: { index: 1, after: FIRST_ID } }],
  ])("are `*` for %s", async (_what, args) => {
    const { tool } = editFor()

    expect(await writeTargets(tool, args, CTX)).toEqual(["*"])
  })
})
