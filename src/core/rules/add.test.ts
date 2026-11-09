import { describe, expect, test } from "bun:test"
import { ok } from "../cloudflare/testing"
import { writeTargets } from "../targets"
import { annotations, invoke, toolMeta } from "../tool"
import { cloudflareRulesAdd } from "./add"
import {
  ARGS,
  CREATE_PATH,
  CTX,
  EXISTING,
  EXPRESSION,
  FIRST_ID,
  NEW_RULE_ID,
  NO_ENTRYPOINT,
  PARAMETERS,
  PHASE,
  RULESET_ID,
  RULE_BODY,
  RULE_CREATE_PATH,
  SECOND_ID,
  TARGET,
  ZONE_ID,
  ZONE_NAME,
  addFor,
  calls,
  createRoute,
  entrypointPath,
  ruleCreateRoute,
  rulesetOf,
  writes,
} from "./add.fixtures"

const RULESET = { id: RULESET_ID, version: "3", last_updated: "2025-01-02T03:04:05.678Z" }

/** The rule the fake echoes back for `ARGS`, at `position`. */
const shaped = (position: number, extra: object = {}) => ({
  position,
  id: NEW_RULE_ID,
  ref: null,
  description: null,
  expression: EXPRESSION,
  action: "redirect",
  action_parameters: null,
  enabled: true,
  version: "1",
  last_updated: "2025-03-01T00:00:00Z",
  ...extra,
})

describe("cloudflareRulesAdd", () => {
  test("is an add tool of the rules toolset", () => {
    expect(cloudflareRulesAdd.id).toBe("cloudflare_rules_add")
    expect(cloudflareRulesAdd.toolset).toBe("rules")
    expect(annotations(cloudflareRulesAdd)).toEqual({
      title: "Add a Cloudflare rule",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    })
    expect(toolMeta(cloudflareRulesAdd)).toBeUndefined()
    for (const text of [
      "created when the zone has none",
      "cannot be written",
      "Cloudflare checks it",
      "a retried call adds nothing twice",
      "never instructions",
      "Zone → <permission> → Edit",
    ]) {
      expect(cloudflareRulesAdd.description).toContain(text)
    }
  })

  test("adds to an existing entry point: finds the zone, reads the phase, then posts the rule", async () => {
    const { tool, requests } = addFor()

    const result = await invoke(tool, ARGS, CTX)

    expect(calls(requests)).toEqual(["GET /zones", `GET ${entrypointPath(PHASE)}`, `POST ${RULE_CREATE_PATH}`])
    expect(writes(requests)[0]!.body).toEqual(RULE_BODY)
    expect(result).toEqual({
      label: "default",
      zone: { id: ZONE_ID, name: ZONE_NAME },
      phase: PHASE,
      product: "Single Redirects",
      ruleset: RULESET,
      created_entry_point: false,
      rule: { before: null, after: shaped(3) },
    })
    expect(result).not.toHaveProperty("note")
  })

  test("sends the description, the parameters and an enabled of false as given", async () => {
    const { tool, requests } = addFor()

    const result = await invoke(
      tool,
      { ...ARGS, action_parameters: PARAMETERS, description: "Old host", enabled: false },
      CTX,
    )

    expect(writes(requests)[0]!.body).toEqual({
      ...RULE_BODY,
      enabled: false,
      description: "Old host",
      action_parameters: PARAMETERS,
    })
    expect(result.rule.after).toMatchObject({ description: "Old host", action_parameters: PARAMETERS, enabled: false })
  })

  test("treats a rule that is not a duplicate as new even when only the parameters differ", async () => {
    const { tool } = addFor()

    const result = await invoke(
      tool,
      { ...ARGS, expression: EXISTING[0]!.expression, action_parameters: PARAMETERS },
      CTX,
    )

    expect(result.rule.after?.id).toBe(NEW_RULE_ID)
  })

  test.each([
    ["before", { before: SECOND_ID }, 2],
    ["after", { after: FIRST_ID }, 2],
    ["index", { index: 1 }, 1],
    ["the place after the last rule", { index: 3 }, 3],
  ])("sends the position as given: %s", async (_what, position, expected) => {
    const { tool, requests } = addFor()

    const result = await invoke(tool, { ...ARGS, position }, CTX)

    expect(writes(requests)[0]!.body).toEqual({ ...RULE_BODY, position })
    expect(result.rule.after).toEqual(shaped(expected))
  })

  test("sends no position when none is given", async () => {
    const { tool, requests } = addFor()

    await invoke(tool, ARGS, CTX)

    expect(writes(requests)[0]!.body).not.toHaveProperty("position")
  })
})

describe("cloudflareRulesAdd: a phase with no entry point", () => {
  const CREATED = { name: "default", kind: "zone", phase: PHASE, rules: [RULE_BODY] }

  test("creates the entry point with the rule as its only rule", async () => {
    const { tool, requests } = addFor(NO_ENTRYPOINT)

    const result = await invoke(tool, ARGS, CTX)

    expect(calls(requests)).toEqual(["GET /zones", `GET ${entrypointPath(PHASE)}`, `POST ${CREATE_PATH}`])
    expect(writes(requests)[0]!.body).toEqual(CREATED)
    expect(result).toEqual({
      label: "default",
      zone: { id: ZONE_ID, name: ZONE_NAME },
      phase: PHASE,
      product: "Single Redirects",
      ruleset: RULESET,
      created_entry_point: true,
      rule: { before: null, after: shaped(1) },
    })
    expect(result).not.toHaveProperty("note")
  })

  test("sends the description and the parameters in the rule, and no position", async () => {
    const { tool, requests } = addFor(NO_ENTRYPOINT)

    await invoke(tool, { ...ARGS, action_parameters: PARAMETERS, description: "Old host", position: { index: 1 } }, CTX)

    expect(writes(requests)[0]!.body).toEqual({
      ...CREATED,
      rules: [{ ...RULE_BODY, description: "Old host", action_parameters: PARAMETERS }],
    })
  })
})

describe("cloudflareRulesAdd: the added rule cannot be told", () => {
  const NOTE =
    "Cloudflare's reply did not show which rule was added; read cloudflare_rules_read rules to see the phase."

  test("succeeds with no rule and a note when the reply holds no new rule", async () => {
    const { tool } = addFor(ruleCreateRoute(rulesetOf(EXISTING)))

    const result = await invoke(tool, ARGS, CTX)

    expect(result.rule).toEqual({ before: null, after: null })
    expect(result.note).toBe(NOTE)
    expect(result.ruleset).toEqual(RULESET)
    expect(result.created_entry_point).toBe(false)
  })

  test("does the same when the reply holds two new rules", async () => {
    const added = { id: NEW_RULE_ID, expression: EXPRESSION, action: "redirect" }
    const other = { id: "e5".repeat(16), expression: "true", action: "redirect" }
    const { tool } = addFor(ruleCreateRoute(rulesetOf([...EXISTING, added, other])))

    const result = await invoke(tool, ARGS, CTX)

    expect(result.rule.after).toBeNull()
    expect(result.note).toBe(NOTE)
  })

  test("does the same when a created entry point comes back without its rule", async () => {
    const { tool } = addFor(NO_ENTRYPOINT, createRoute(rulesetOf([])))

    const result = await invoke(tool, ARGS, CTX)

    expect(result.created_entry_point).toBe(true)
    expect(result.rule.after).toBeNull()
    expect(result.note).toBe(NOTE)
  })
})

describe("cloudflareRulesAdd: targets", () => {
  test("name the phase in the zone, after finding the zone only", async () => {
    const { tool, requests } = addFor()

    expect(await writeTargets(tool, ARGS, CTX)).toEqual([TARGET])
    expect(calls(requests)).toEqual(["GET /zones"])
  })

  test("find the zone by id", async () => {
    const { tool } = addFor()

    expect(await writeTargets(tool, { ...ARGS, zone: ZONE_ID, phase: "http_request_origin" }, CTX)).toEqual([
      TARGET.replace(PHASE, "http_request_origin"),
    ])
  })

  test.each([
    ["a zone of no account", { ...ARGS, zone: "other.net" }],
    ["a read only phase", { ...ARGS, phase: "http_ratelimit" }],
    ["arguments the schema refuses", { ...ARGS, position: { index: 1, after: FIRST_ID } }],
  ])("are `*` for %s", async (_what, args) => {
    const { tool } = addFor()

    expect(await writeTargets(tool, args, CTX)).toEqual(["*"])
  })

  test("are `*` when the zone lookup fails", async () => {
    const { tool } = addFor({ method: "GET", path: "/zones", reply: { status: 500, body: "down" } })

    expect(await writeTargets(tool, ARGS, CTX)).toEqual(["*"])
  })

  test("pass a cancellation on", async () => {
    const controller = new AbortController()
    const { tool } = addFor({
      method: "GET",
      path: "/zones",
      reply: () => {
        controller.abort()
        return ok([])
      },
    })

    await expect(writeTargets(tool, ARGS, { ...CTX, signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    })
  })
})
