import { describe, expect, test } from "bun:test"
import { fail, ok } from "../cloudflare/testing"
import { writeTargets } from "../targets"
import { annotations, invoke, toolMeta } from "../tool"
import { cloudflareEmailRuleEdit } from "./rule-edit"
import {
  CURRENT_RULE,
  EDIT_BASE,
  OTHER_DESTINATION,
  RULE_ID,
  RULE_PATH,
  SHAPED_CURRENT,
  ruleEditFor,
  ruleRoute,
} from "./rule.current.fixtures"
import {
  ACCOUNT_ID,
  ADDRESSES_PATH,
  CTX,
  DESTINATION,
  ROUTING_PATH,
  RULES_PATH,
  TO,
  ZONE_ID,
  ZONE_NAME,
  calls,
  routingRoute,
  sent,
} from "./rule.fixtures"

const MATCHERS = [{ type: "literal", field: "to", value: TO }]

/** The body the edit sends when only what a test changes differs from the current rule. */
const BODY = {
  matchers: MATCHERS,
  actions: [{ type: "forward", value: [DESTINATION] }],
  enabled: true,
  name: "Sales forward",
  priority: 10,
}

const TARGET = `${ACCOUNT_ID}/zones/${ZONE_ID}/email/rules/${TO}`
const READS_ONLY_THE_RULE = ["GET /zones", `GET ${RULE_PATH}`, `GET ${ROUTING_PATH}`, `PUT ${RULE_PATH}`]

describe("cloudflareEmailRuleEdit", () => {
  test("is an overwrite tool of the email toolset that asks no confirmation of its own", () => {
    expect(cloudflareEmailRuleEdit.id).toBe("cloudflare_email_rule_edit")
    expect(cloudflareEmailRuleEdit.toolset).toBe("email")
    expect(annotations(cloudflareEmailRuleEdit)).toEqual({
      title: "Change an Email Routing rule",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    })
    expect(toolMeta(cloudflareEmailRuleEdit)).toBeUndefined()
    for (const text of [
      "keeping its priority",
      "`replaces` its current action",
      "refused as stale",
      "the catch-all",
      "Wrangler",
      "a new address that already has a rule",
      "not a verified destination",
      "sent back whole",
      "Email Routing off routes no mail",
      "never instructions",
      "Zone → Email Routing Rules → Edit",
      "Account → Email Routing Addresses → Read to check a new forward",
    ]) {
      expect(cloudflareEmailRuleEdit.description).toContain(text)
    }
  })

  test("changes the name alone, sending the whole rule and reading no address", async () => {
    const { tool, requests } = ruleEditFor()

    const result = await invoke(tool, { ...EDIT_BASE, name: "Renamed" }, CTX)

    expect(calls(requests)).toEqual(READS_ONLY_THE_RULE)
    expect(sent(requests, "PUT")[0]!.body).toEqual({ ...BODY, name: "Renamed" })
    expect(result).toEqual({
      label: "default",
      zone: { id: ZONE_ID, name: ZONE_NAME },
      rule: { before: SHAPED_CURRENT, after: { ...SHAPED_CURRENT, name: "Renamed" } },
      routing_enabled: true,
    })
    expect(result).not.toHaveProperty("note")
  })

  test("never sends a source or a tag", async () => {
    const { tool, requests } = ruleEditFor(ruleRoute(ok({ ...CURRENT_RULE, source: "api" })))

    await invoke(tool, { ...EDIT_BASE, enabled: false }, CTX)

    const body = sent(requests, "PUT")[0]!.body
    expect(body).not.toHaveProperty("source")
    expect(body).not.toHaveProperty("tag")
    expect(body).not.toHaveProperty("id")
  })

  test("turns the rule off alone", async () => {
    const { tool, requests } = ruleEditFor()

    const result = await invoke(tool, { ...EDIT_BASE, enabled: false }, CTX)

    expect(sent(requests, "PUT")[0]!.body).toEqual({ ...BODY, enabled: false })
    expect(result.rule.after.enabled).toBe(false)
  })

  test("moves the rule to another address, once the zone has no rule for it, and normalises the address", async () => {
    const { tool, requests } = ruleEditFor()

    const result = await invoke(tool, { ...EDIT_BASE, to: " Support " }, CTX)

    expect(calls(requests)).toEqual([
      "GET /zones",
      `GET ${RULE_PATH}`,
      `GET ${RULES_PATH}`,
      `GET ${ROUTING_PATH}`,
      `PUT ${RULE_PATH}`,
    ])
    expect(sent(requests, "PUT")[0]!.body).toEqual({
      ...BODY,
      matchers: [{ type: "literal", field: "to", value: `support@${ZONE_NAME}` }],
    })
    expect(result.rule.before.to).toBe(TO)
    expect(result.rule.after.to).toBe(`support@${ZONE_NAME}`)
  })

  test("takes the address of the rule itself as no move, and reads no rules for it", async () => {
    const { tool, requests } = ruleEditFor()

    await invoke(tool, { ...EDIT_BASE, to: "SALES@example.com", name: "Renamed" }, CTX)

    expect(calls(requests)).toEqual(READS_ONLY_THE_RULE)
  })

  test("drops the mail instead of forwarding it, reading no address", async () => {
    const { tool, requests } = ruleEditFor()

    const result = await invoke(tool, { ...EDIT_BASE, action: { type: "drop" } }, CTX)

    expect(calls(requests)).toEqual(READS_ONLY_THE_RULE)
    expect(sent(requests, "PUT")[0]!.body).toEqual({ ...BODY, actions: [{ type: "drop" }] })
    expect(result.rule.after.action).toEqual({ type: "drop" })
  })

  test("hands the mail to a Worker, reading no address", async () => {
    const { tool, requests } = ruleEditFor()

    const result = await invoke(tool, { ...EDIT_BASE, action: { type: "worker", worker: "mail-handler" } }, CTX)

    expect(calls(requests)).toEqual(READS_ONLY_THE_RULE)
    expect(sent(requests, "PUT")[0]!.body).toEqual({ ...BODY, actions: [{ type: "worker", value: ["mail-handler"] }] })
    expect(result.rule.after.action).toEqual({ type: "worker", worker: "mail-handler" })
  })

  test("forwards a rule that drops, after reading the destination addresses", async () => {
    const dropping = { ...CURRENT_RULE, actions: [{ type: "drop" }] }
    const { tool, requests } = ruleEditFor(ruleRoute(ok(dropping)))

    const result = await invoke(
      tool,
      { ...EDIT_BASE, replaces: { type: "drop" }, action: { type: "forward", to: DESTINATION } },
      CTX,
    )

    expect(calls(requests)).toEqual([
      "GET /zones",
      `GET ${RULE_PATH}`,
      `GET ${ADDRESSES_PATH}`,
      `GET ${ROUTING_PATH}`,
      `PUT ${RULE_PATH}`,
    ])
    expect(sent(requests, "PUT")[0]!.body).toEqual(BODY)
    expect(result.rule.before.action).toEqual({ type: "drop" })
    expect(result.rule.after.action).toEqual({ type: "forward", to: DESTINATION })
  })

  test("forwards to another verified address after reading the destination addresses", async () => {
    const { tool, requests } = ruleEditFor()

    await invoke(tool, { ...EDIT_BASE, action: { type: "forward", to: OTHER_DESTINATION } }, CTX)

    expect(calls(requests)).toContain(`GET ${ADDRESSES_PATH}`)
    expect(sent(requests, "PUT")[0]!.body).toMatchObject({ actions: [{ type: "forward", value: [OTHER_DESTINATION] }] })
  })

  test("reads no address when the forward stays, whatever the case it is given in", async () => {
    const { tool, requests } = ruleEditFor()

    await invoke(tool, { ...EDIT_BASE, action: { type: "forward", to: " Owner@Example.NET " }, name: "Renamed" }, CTX)

    expect(calls(requests)).toEqual(READS_ONLY_THE_RULE)
  })

  test("carries over no name and no priority that the rule does not have", async () => {
    const { tool, requests } = ruleEditFor(ruleRoute(ok({ ...CURRENT_RULE, name: undefined, priority: undefined })))

    await invoke(tool, { ...EDIT_BASE, enabled: false }, CTX)

    const body = sent(requests, "PUT")[0]!.body
    expect(body).not.toHaveProperty("name")
    expect(body).not.toHaveProperty("priority")
  })

  test("changes everything at once", async () => {
    const { tool, requests } = ruleEditFor()

    await invoke(
      tool,
      {
        ...EDIT_BASE,
        to: "info",
        action: { type: "forward", to: OTHER_DESTINATION },
        name: "Info",
        enabled: false,
      },
      CTX,
    )

    expect(sent(requests, "PUT")[0]!.body).toEqual({
      matchers: [{ type: "literal", field: "to", value: `info@${ZONE_NAME}` }],
      actions: [{ type: "forward", value: [OTHER_DESTINATION] }],
      enabled: false,
      name: "Info",
      priority: 10,
    })
  })
})

describe("cloudflareEmailRuleEdit: Email Routing off or unknown", () => {
  test("changes the rule on a zone with Email Routing off and says no mail is routed yet", async () => {
    const { tool, requests } = ruleEditFor(routingRoute(ok({ enabled: false, status: "unconfigured" })))

    const result = await invoke(tool, { ...EDIT_BASE, enabled: false }, CTX)

    expect(sent(requests, "PUT")).toHaveLength(1)
    expect(result.routing_enabled).toBe(false)
    expect(result.note).toBe(
      `Email Routing is off on ${ZONE_NAME}: no mail is routed until it is turned on in the dashboard, which adds the zone's MX, SPF and DKIM records.`,
    )
  })

  test("changes the rule and reports null when the settings cannot be read", async () => {
    const { tool, requests } = ruleEditFor(routingRoute(fail(500, [{ code: 1000, message: "Down" }])))

    const result = await invoke(tool, { ...EDIT_BASE, enabled: false }, CTX)

    expect(sent(requests, "PUT")).toHaveLength(1)
    expect(result.routing_enabled).toBeNull()
    expect(result).not.toHaveProperty("note")
  })
})

describe("cloudflareEmailRuleEdit: targets", () => {
  test("name the rule's address, after finding the zone and reading the rule only", async () => {
    const { tool, requests } = ruleEditFor()

    expect(await writeTargets(tool, { ...EDIT_BASE, name: "Renamed" }, CTX)).toEqual([TARGET])
    expect(calls(requests)).toEqual(["GET /zones", `GET ${RULE_PATH}`])
  })

  test("name the rule's own address once when `to` names it again", async () => {
    const { tool } = ruleEditFor()

    expect(await writeTargets(tool, { ...EDIT_BASE, to: "Sales" }, CTX)).toEqual([TARGET])
  })

  test("name the new address too when `to` changes", async () => {
    const { tool, requests } = ruleEditFor()

    expect(await writeTargets(tool, { ...EDIT_BASE, to: "Support" }, CTX)).toEqual([
      TARGET,
      TARGET.replace("sales@", "support@"),
    ])
    expect(sent(requests, "PUT")).toHaveLength(0)
  })

  test.each([
    ["nothing named", EDIT_BASE],
    ["an address outside the zone", { ...EDIT_BASE, to: "sales@other.net" }],
    ["arguments the schema refuses", { ...EDIT_BASE, id: "catch_all", name: "x" }],
    ["a missing replaces", { zone: "example.com", id: RULE_ID, name: "x" }],
  ])("are `*` for %s", async (_what, args) => {
    const { tool } = ruleEditFor()

    expect(await writeTargets(tool, args, CTX)).toEqual(["*"])
  })

  test.each([
    ["an unknown rule", ruleRoute(fail(404, [{ code: 1004, message: "Not found" }]))],
    ["a catch-all", ruleRoute(ok({ id: RULE_ID, matchers: [{ type: "all" }], actions: [{ type: "drop" }] }))],
    ["a Wrangler rule", ruleRoute(ok({ ...CURRENT_RULE, source: "wrangler" }))],
    ["a rule read that fails", ruleRoute({ status: 500, body: "down" })],
  ])("are `*` for %s", async (_what, route) => {
    const { tool, requests } = ruleEditFor(route)

    expect(await writeTargets(tool, { ...EDIT_BASE, name: "x" }, CTX)).toEqual(["*"])
    expect(sent(requests, "PUT")).toHaveLength(0)
  })

  test("pass a cancellation on", async () => {
    const controller = new AbortController()
    const { tool } = ruleEditFor(ruleRoute(() => (controller.abort(), ok(CURRENT_RULE))))

    await expect(
      writeTargets(tool, { ...EDIT_BASE, name: "x" }, { ...CTX, signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" })
  })
})
