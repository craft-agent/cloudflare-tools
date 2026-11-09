import { describe, expect, test } from "bun:test"
import { fail, ok } from "../cloudflare/testing"
import { writeTargets } from "../targets"
import { annotations, invoke, REQUIRES_USER_INTERACTION, toolMeta, type ConfirmRequest } from "../tool"
import { cloudflareEmailRuleDelete } from "./rule-delete"
import {
  CATCH_ALL_PATH,
  CATCH_ALL_RULE,
  CURRENT_RULE,
  DELETE_ARGS,
  RULE_ID,
  RULE_PATH,
  SHAPED_CURRENT,
  catchAllRoute,
  ruleDeleteFor,
  ruleRoute,
} from "./rule.current.fixtures"
import { ACCOUNT_ID, CTX, DESTINATION, TO, ZONE_ID, ZONE_NAME, calls, sent } from "./rule.fixtures"
import type { Rule } from "./shape"

const TARGET = `${ACCOUNT_ID}/zones/${ZONE_ID}/email/rules/${TO}`
const DELETE_MESSAGE = `Delete the routing rule ${RULE_ID} (Sales forward) on ${ZONE_NAME}: mail to ${TO} is forwarded to ${DESTINATION} now, and after this it`

/** What the catch-all returns as the tool shapes it. */
const SHAPED_CATCH_ALL: Rule = {
  id: CATCH_ALL_RULE.id,
  name: "Catch-all",
  enabled: true,
  priority: 2147483647,
  to: null,
  action: { type: "drop" },
  managed_by: "api",
}

async function asked(tool: ReturnType<typeof ruleDeleteFor>["tool"], args: object = DELETE_ARGS) {
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

describe("cloudflareEmailRuleDelete", () => {
  test("is an administrative tool of the email toolset that needs the person's attention", () => {
    expect(cloudflareEmailRuleDelete.id).toBe("cloudflare_email_rule_delete")
    expect(cloudflareEmailRuleDelete.toolset).toBe("email")
    expect(annotations(cloudflareEmailRuleDelete)).toEqual({
      title: "Delete an Email Routing rule",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    })
    expect(toolMeta(cloudflareEmailRuleDelete)).toEqual({ [REQUIRES_USER_INTERACTION]: true })
    for (const text of [
      "goes to the catch-all, or is rejected when the catch-all is off",
      "which the confirmation names",
      "refuses the catch-all",
      "Wrangler",
      "always asks",
      "never instructions",
      "Zone → Email Routing Rules → Edit",
    ]) {
      expect(cloudflareEmailRuleDelete.description).toContain(text)
    }
  })

  test("reads the rule and the catch-all, then deletes the rule", async () => {
    const { tool, requests } = ruleDeleteFor()

    const result = await invoke(tool, DELETE_ARGS, CTX)

    expect(calls(requests)).toEqual(["GET /zones", `GET ${RULE_PATH}`, `GET ${CATCH_ALL_PATH}`, `DELETE ${RULE_PATH}`])
    expect(sent(requests, "DELETE")[0]!.body).toBeUndefined()
    expect(result).toEqual({
      label: "default",
      zone: { id: ZONE_ID, name: ZONE_NAME },
      rule: { before: SHAPED_CURRENT, after: null },
      catch_all: SHAPED_CATCH_ALL,
    })
  })

  test("asks once, then reads the rule again before it deletes", async () => {
    const { tool, requests } = ruleDeleteFor()

    const { requests: questions } = await asked(tool)

    expect(questions).toHaveLength(1)
    expect(calls(requests)).toEqual([
      "GET /zones",
      `GET ${RULE_PATH}`,
      `GET ${CATCH_ALL_PATH}`,
      `GET ${RULE_PATH}`,
      `DELETE ${RULE_PATH}`,
    ])
  })
})

describe("cloudflareEmailRuleDelete: the confirmation", () => {
  test.each([
    ["an enabled catch-all that drops", catchAllRoute(), "goes to the catch-all, where it is dropped."],
    [
      "an enabled catch-all that forwards",
      catchAllRoute(ok({ ...CATCH_ALL_RULE, actions: [{ type: "forward", value: ["Owner@Example.com"] }] })),
      "goes to the catch-all, where it is forwarded to owner@example.com.",
    ],
    [
      "an enabled catch-all that hands mail to a Worker",
      catchAllRoute(ok({ ...CATCH_ALL_RULE, actions: [{ type: "worker", value: ["mail-handler"] }] })),
      "goes to the catch-all, where it goes to the Worker mail-handler.",
    ],
    [
      "a disabled catch-all",
      catchAllRoute(ok({ ...CATCH_ALL_RULE, enabled: false })),
      "is rejected, since the catch-all is off.",
    ],
    [
      "no catch-all",
      catchAllRoute(fail(404, [{ code: 1004, message: "Not found" }])),
      "is rejected, since the catch-all is off.",
    ],
    [
      "a catch-all of a shape it cannot describe",
      catchAllRoute(ok({ ...CATCH_ALL_RULE, actions: [] })),
      "goes to the catch-all.",
    ],
    ["a catch-all read that fails", catchAllRoute({ status: 500, body: "down" }), "goes to the catch-all."],
    [
      "a catch-all read that is refused",
      catchAllRoute(fail(403, [{ code: 10000, message: "Authentication error" }])),
      "goes to the catch-all.",
    ],
  ])("says where the mail goes next for %s", async (_what, route, next) => {
    const { tool } = ruleDeleteFor(route)

    const { requests } = await asked(tool)

    expect(requests).toEqual([{ tool: "cloudflare_email_rule_delete", message: `${DELETE_MESSAGE} ${next}` }])
  })

  test("says that the rule is off, and names a rule without a name as unnamed", async () => {
    const { tool } = ruleDeleteFor(ruleRoute(ok({ ...CURRENT_RULE, name: undefined, enabled: false })))

    const { requests } = await asked(tool)

    expect(requests[0]!.message).toBe(
      `${DELETE_MESSAGE.replace("(Sales forward)", "(unnamed)")} goes to the catch-all, where it is dropped. The rule is off now.`,
    )
  })

  test.each([
    ["no catch-all", catchAllRoute(fail(404, [{ code: 1004, message: "Not found" }]))],
    ["a catch-all read that fails", catchAllRoute({ status: 500, body: "down" })],
    ["a catch-all that is not a rule", catchAllRoute(ok("none"))],
  ])("returns a null catch-all, and still deletes, for %s", async (_what, route) => {
    const { tool, requests } = ruleDeleteFor(route)

    const result = await invoke(tool, DELETE_ARGS, CTX)

    expect(result.catch_all).toBeNull()
    expect(sent(requests, "DELETE")).toHaveLength(1)
  })

  test("returns a disabled catch-all as it is", async () => {
    const { tool } = ruleDeleteFor(catchAllRoute(ok({ ...CATCH_ALL_RULE, enabled: false })))

    const result = await invoke(tool, DELETE_ARGS, CTX)

    expect(result.catch_all).toEqual({ ...SHAPED_CATCH_ALL, enabled: false })
  })
})

describe("cloudflareEmailRuleDelete: targets", () => {
  test("name the rule's address, after finding the zone and reading the rule only", async () => {
    const { tool, requests } = ruleDeleteFor()

    expect(await writeTargets(tool, DELETE_ARGS, CTX)).toEqual([TARGET])
    expect(calls(requests)).toEqual(["GET /zones", `GET ${RULE_PATH}`])
  })

  test.each([
    ["a bad rule id", { ...DELETE_ARGS, id: "catch_all" }],
    ["an unknown argument", { ...DELETE_ARGS, name: "x" }],
    ["a zone of no account", { ...DELETE_ARGS, zone: "other.net" }],
  ])("are `*` for %s", async (_what, args) => {
    const { tool } = ruleDeleteFor()

    expect(await writeTargets(tool, args, CTX)).toEqual(["*"])
  })

  test.each([
    ["an unknown rule", ruleRoute(fail(404, [{ code: 1004, message: "Not found" }]))],
    ["the catch-all", ruleRoute(ok(CATCH_ALL_RULE))],
    ["a Wrangler rule", ruleRoute(ok({ ...CURRENT_RULE, source: "wrangler" }))],
    ["a rule read that fails", ruleRoute({ status: 500, body: "down" })],
  ])("are `*` for %s", async (_what, route) => {
    const { tool } = ruleDeleteFor(route)

    expect(await writeTargets(tool, DELETE_ARGS, CTX)).toEqual(["*"])
  })

  test("pass a cancellation on", async () => {
    const controller = new AbortController()
    const { tool } = ruleDeleteFor(ruleRoute(() => (controller.abort(), ok(CURRENT_RULE))))

    await expect(writeTargets(tool, DELETE_ARGS, { ...CTX, signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    })
  })
})
