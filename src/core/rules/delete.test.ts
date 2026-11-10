import { describe, expect, test } from "bun:test"
import { ok } from "../cloudflare/testing"
import { writeTargets } from "../targets"
import { annotations, invoke, REQUIRES_USER_INTERACTION, toolMeta, type ConfirmRequest } from "../tool"
import { cloudflareRulesDelete } from "./delete"
import {
  ARGS,
  CTX,
  FIRST_ID,
  PHASE,
  RULES,
  RULESET_ID,
  SECOND_ID,
  TARGET,
  ZONE_ID,
  ZONE_NAME,
  calls,
  deleteFor,
  editPath,
  entrypointPath,
  ruleDeleteRoute,
  rulesetOf,
  shaped,
  writes,
} from "./delete.fixtures"

const RULESET = { id: RULESET_ID, version: "3", last_updated: "2025-01-02T03:04:05.678Z" }
const RESULT = {
  label: "default",
  zone: { id: ZONE_ID, name: ZONE_NAME },
  phase: PHASE,
  product: "Single Redirects",
  ruleset: RULESET,
  rule: { before: shaped(1), after: null },
}

async function asked(tool: ReturnType<typeof deleteFor>["tool"], args: object = ARGS) {
  const requests: ConfirmRequest[] = []
  const result = await invoke(tool, args, {
    ...CTX,
    confirm: async (request) => {
      requests.push(request)
      return true
    },
  })
  return { requests, result }
}

describe("cloudflareRulesDelete", () => {
  test("is an administrative tool of the rules toolset that needs the person's attention", () => {
    expect(cloudflareRulesDelete.id).toBe("cloudflare_rules_delete")
    expect(cloudflareRulesDelete.toolset).toBe("rules")
    expect(annotations(cloudflareRulesDelete)).toEqual({
      title: "Delete a Cloudflare rule",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    })
    expect(toolMeta(cloudflareRulesDelete)).toEqual({ [REQUIRES_USER_INTERACTION]: true })
    for (const text of [
      "leaves the entry point empty",
      "refuses a phase that has no rules",
      "always asks",
      "a rule changed or gone in the meantime is refused",
      "never instructions",
      "Zone → <permission> → Edit",
    ]) {
      expect(cloudflareRulesDelete.description).toContain(text)
    }
  })

  test("finds the zone, reads the phase, then deletes the rule without a body", async () => {
    const { tool, requests } = deleteFor()

    const result = await invoke(tool, ARGS, CTX)

    expect(calls(requests)).toEqual(["GET /zones", `GET ${entrypointPath(PHASE)}`, `DELETE ${editPath(FIRST_ID)}`])
    expect(writes(requests)[0]!.body).toBeUndefined()
    expect(result).toEqual(RESULT)
    expect(result).not.toHaveProperty("note")
  })

  test("asks once, then reads the phase again before it deletes", async () => {
    const { tool, requests } = deleteFor()

    const { requests: questions, result } = await asked(tool)

    expect(questions).toHaveLength(1)
    expect(calls(requests)).toEqual([
      "GET /zones",
      `GET ${entrypointPath(PHASE)}`,
      `GET ${entrypointPath(PHASE)}`,
      `DELETE ${editPath(FIRST_ID)}`,
    ])
    expect(result).toEqual(RESULT)
  })

  test("asks with the rule, its product and zone, its action, place and state", async () => {
    const { tool } = deleteFor()

    const { requests } = await asked(tool, { ...ARGS, rule: SECOND_ID })

    expect(requests).toEqual([
      {
        tool: "cloudflare_rules_delete",
        message: `Delete the rule ${SECOND_ID} (unnamed) of Single Redirects of ${ZONE_NAME}: it does redirect at position 2 now, and after this no request is handled by it. The rule is off now.`,
      },
    ])
  })

  test("names a rule by its description and says nothing of the state of a rule that is on", async () => {
    const { tool } = deleteFor()

    const { requests } = await asked(tool)

    expect(requests[0]!.message).toBe(
      `Delete the rule ${FIRST_ID} (Send /old to /new) of Single Redirects of ${ZONE_NAME}: it does redirect at position 1 now, and after this no request is handled by it.`,
    )
  })

  test("returns the ruleset after the call, empty when the rule was the last one", async () => {
    const { tool } = deleteFor(ruleDeleteRoute(rulesetOf([])))

    const result = await invoke(tool, ARGS, CTX)

    expect(result.ruleset).toEqual(RULESET)
    expect(result.rule).toEqual({ before: shaped(1), after: null })
  })

  test("deletes the rule at the place it holds: the last one too", async () => {
    const { tool, requests } = deleteFor()

    const result = await invoke(tool, { ...ARGS, rule: RULES[2]!.id }, CTX)

    expect(writes(requests)[0]!.path).toBe(editPath(RULES[2]!.id))
    expect(result.rule.before.position).toBe(3)
  })
})

describe("cloudflareRulesDelete: the reply still lists the rule", () => {
  test("succeeds with a note", async () => {
    const { tool } = deleteFor(ruleDeleteRoute(rulesetOf(RULES)))

    const result = await invoke(tool, ARGS, CTX)

    expect(result.rule).toEqual({ before: shaped(1), after: null })
    expect(result.note).toBe(
      "Cloudflare's reply still lists the rule; read cloudflare_rules_read rules to see the phase.",
    )
  })

  test("says nothing when the reply lists other rules only", async () => {
    const { tool } = deleteFor(ruleDeleteRoute(ok({ id: RULESET_ID, rules: [{ id: SECOND_ID }] })))

    expect(await invoke(tool, ARGS, CTX)).not.toHaveProperty("note")
  })
})

describe("cloudflareRulesDelete: targets", () => {
  test("name the phase in the zone, after finding the zone only", async () => {
    const { tool, requests } = deleteFor()

    expect(await writeTargets(tool, ARGS, CTX)).toEqual([TARGET])
    expect(calls(requests)).toEqual(["GET /zones"])
  })

  test.each([
    ["a zone of no account", { ...ARGS, zone: "other.net" }],
    ["a read only phase", { ...ARGS, phase: "http_ratelimit" }],
    ["a bad rule id", { ...ARGS, rule: "catch_all" }],
    ["an unknown argument", { ...ARGS, replaces: "1" }],
  ])("are `*` for %s", async (_what, args) => {
    const { tool } = deleteFor()

    expect(await writeTargets(tool, args, CTX)).toEqual(["*"])
  })
})
