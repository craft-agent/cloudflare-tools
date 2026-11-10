import { describe, expect, test } from "bun:test"
import { toolError } from "../cloudflare/client.fixtures"
import { fail } from "../cloudflare/testing"
import { invoke, type ToolContext } from "../tool"
import {
  ARGS,
  CTX,
  FIRST_ID,
  PHASE,
  RULE,
  RULES,
  calls,
  changingEntrypoint,
  deleteFor,
  editPath,
  entrypointPath,
  rulesetOf,
  writes,
} from "./delete.fixtures"

const CONFIRMED: ToolContext = { ...CTX, confirm: async () => true }
const NOTHING_CHANGED = " Nothing was changed."
const CHANGED = `Rule ${FIRST_ID} changed while waiting for the answer. Nothing was changed; read the phase again before trying again.`
const OTHERS = RULES.slice(1)

describe("cloudflareRulesDelete: declined", () => {
  test("is declined when the person says no, and nothing more is sent", async () => {
    const { tool, requests } = deleteFor()

    const error = await toolError(invoke(tool, ARGS, { ...CTX, confirm: async () => false }))

    expect(error.code).toBe("declined")
    expect(error.message).toStartWith("cloudflare_rules_delete was declined: Delete the rule")
    expect(calls(requests)).toEqual(["GET /zones", `GET ${entrypointPath(PHASE)}`])
  })
})

describe("cloudflareRulesDelete: the phase changes while the person answers", () => {
  test.each([
    ["has another expression", rulesetOf([{ ...RULE, expression: "true" }, ...OTHERS])],
    ["has another action", rulesetOf([{ ...RULE, action: "block" }, ...OTHERS])],
    ["has other parameters", rulesetOf([{ ...RULE, action_parameters: {} }, ...OTHERS])],
    ["is turned off", rulesetOf([{ ...RULE, enabled: false }, ...OTHERS])],
    ["has another description", rulesetOf([{ ...RULE, description: "Renamed" }, ...OTHERS])],
    ["has another version", rulesetOf([{ ...RULE, version: "2" }, ...OTHERS])],
    ["has moved down", rulesetOf([OTHERS[0], RULE, OTHERS[1]])],
    ["has moved because a rule came before it", rulesetOf([{ id: "f".repeat(32) }, RULE, ...OTHERS])],
  ])("refuses it as stale when the rule %s, and sends no delete", async (_what, later) => {
    const { tool, requests } = deleteFor(changingEntrypoint(later))

    const error = await toolError(invoke(tool, ARGS, CONFIRMED))

    expect(error.code).toBe("stale")
    expect(error.message).toBe(CHANGED)
    expect(writes(requests)).toEqual([])
  })

  test.each([
    ["the rule is gone", rulesetOf(OTHERS), `No rule ${FIRST_ID} in Single Redirects of example.com.`],
    ["the phase has no rules", rulesetOf([]), `No rule ${FIRST_ID} in Single Redirects of example.com.`],
    [
      "the entry point is gone",
      fail(404, [{ code: 10003, message: "Could not find entrypoint" }]),
      "Single Redirects of example.com has no rules.",
    ],
  ])("refuses it as not_found when %s, and sends no delete", async (_what, later, message) => {
    const { tool, requests } = deleteFor(changingEntrypoint(later))

    const error = await toolError(invoke(tool, ARGS, CONFIRMED))

    expect(error.code).toBe("not_found")
    expect(error.message).toBe(message + NOTHING_CHANGED)
    expect(writes(requests)).toEqual([])
  })

  test("deletes when the second read is the phase as approved, or changed in another rule only", async () => {
    const { tool, requests } = deleteFor(
      changingEntrypoint(rulesetOf([RULE, { ...OTHERS[0], version: "9" }, OTHERS[1]])),
    )

    await invoke(tool, ARGS, CONFIRMED)

    expect(writes(requests)).toHaveLength(1)
    expect(writes(requests)[0]!.path).toBe(editPath(FIRST_ID))
  })

  test("passes a failed second read on as it is, with no delete sent", async () => {
    const { tool, requests } = deleteFor(
      changingEntrypoint(fail(403, [{ code: 10000, message: "Authentication error" }])),
    )

    const error = await toolError(invoke(tool, ARGS, CONFIRMED))

    expect(error.code).toBe("forbidden")
    expect(error.message).toBe("10000: Authentication error. The token needs Zone → Dynamic URL Redirects → Read.")
    expect(writes(requests)).toEqual([])
  })

  test("reads the phase only once when the harness's approval stands in for the question", async () => {
    const { tool, requests } = deleteFor(changingEntrypoint(rulesetOf([{ ...RULE, enabled: false }, ...OTHERS])))

    await invoke(tool, ARGS, CTX)

    expect(writes(requests)).toHaveLength(1)
    expect(requests.filter((request) => request.path === entrypointPath(PHASE))).toHaveLength(1)
  })
})
