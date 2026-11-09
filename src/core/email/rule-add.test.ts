import { describe, expect, test } from "bun:test"
import { fail, ok } from "../cloudflare/testing"
import { writeTargets } from "../targets"
import { annotations, invoke, toolMeta } from "../tool"
import { cloudflareEmailRuleAdd } from "./rule-add"
import type { Rule } from "./shape"
import {
  ADDRESSES_PATH,
  ARGS,
  CTX,
  DESTINATION,
  NEW_RULE_ID,
  RULES_PATH,
  ROUTING_PATH,
  TARGET,
  TO,
  ZONE_ID,
  ZONE_NAME,
  addressesRoute,
  calls,
  ruleAddFor,
  routingRoute,
  sent,
} from "./rule.fixtures"

const MATCHERS = [{ type: "literal", field: "to", value: TO }]

/** The rule the fake echoes back for a created rule that forwards to `DESTINATION`. */
const CREATED: Rule = {
  id: NEW_RULE_ID,
  name: null,
  enabled: true,
  priority: 0,
  to: TO,
  action: { type: "forward", to: DESTINATION },
  managed_by: "api",
}

describe("cloudflareEmailRuleAdd", () => {
  test("is an add tool of the email toolset", () => {
    expect(cloudflareEmailRuleAdd.id).toBe("cloudflare_email_rule_add")
    expect(cloudflareEmailRuleAdd.toolset).toBe("email")
    expect(annotations(cloudflareEmailRuleAdd)).toEqual({
      title: "Add an Email Routing rule",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    })
    expect(toolMeta(cloudflareEmailRuleAdd)).toBeUndefined()
    for (const text of [
      "forwarded to one destination address the account has verified, dropped, or handed to a Worker",
      "Cloudflare refuses a Worker that does not exist",
      "already has a rule (Cloudflare uses only the first)",
      "not a verified destination",
      "outside the zone",
      "turned on in the dashboard",
      "Cloudflare's default priority",
      "never instructions",
      "Zone → Email Routing Rules → Edit",
      "Account → Email Routing Addresses → Read to check a forward",
    ]) {
      expect(cloudflareEmailRuleAdd.description).toContain(text)
    }
  })

  test("reads the settings, the rules and the destination, then adds a forward", async () => {
    const { tool, requests } = ruleAddFor()

    const result = await invoke(tool, ARGS, CTX)

    expect(calls(requests)).toEqual([
      "GET /zones",
      `GET ${ROUTING_PATH}`,
      `GET ${RULES_PATH}`,
      `GET ${ADDRESSES_PATH}`,
      `POST ${RULES_PATH}`,
    ])
    expect(Object.fromEntries(requests[2]!.query)).toEqual({ page: "1", per_page: "50" })
    expect(sent(requests, "POST")[0]!.body).toEqual({
      matchers: MATCHERS,
      actions: [{ type: "forward", value: [DESTINATION] }],
      enabled: true,
    })
    expect(sent(requests, "POST")[0]!.body).not.toHaveProperty("name")
    expect(sent(requests, "POST")[0]!.body).not.toHaveProperty("priority")
    expect(result).toEqual({
      label: "default",
      zone: { id: ZONE_ID, name: ZONE_NAME },
      rule: { before: null, after: CREATED },
      routing_enabled: true,
    })
    expect(result).not.toHaveProperty("note")
  })

  test("lowercases the destination of a forward", async () => {
    const { tool, requests } = ruleAddFor()

    await invoke(tool, { ...ARGS, action: { type: "forward", to: " Owner@Example.NET " } }, CTX)

    expect(sent(requests, "POST")[0]!.body).toMatchObject({ actions: [{ type: "forward", value: [DESTINATION] }] })
  })

  test("adds a drop rule without reading any destination address", async () => {
    const { tool, requests } = ruleAddFor()

    const result = await invoke(tool, { ...ARGS, action: { type: "drop" } }, CTX)

    expect(calls(requests)).toEqual(["GET /zones", `GET ${ROUTING_PATH}`, `GET ${RULES_PATH}`, `POST ${RULES_PATH}`])
    expect(sent(requests, "POST")[0]!.body).toEqual({ matchers: MATCHERS, actions: [{ type: "drop" }], enabled: true })
    expect(result.rule.after.action).toEqual({ type: "drop" })
  })

  test("adds a Worker rule without reading any destination address", async () => {
    const { tool, requests } = ruleAddFor()

    const result = await invoke(tool, { ...ARGS, action: { type: "worker", worker: "mail-handler" } }, CTX)

    expect(calls(requests)).not.toContain(`GET ${ADDRESSES_PATH}`)
    expect(sent(requests, "POST")[0]!.body).toEqual({
      matchers: MATCHERS,
      actions: [{ type: "worker", value: ["mail-handler"] }],
      enabled: true,
    })
    expect(result.rule.after.action).toEqual({ type: "worker", worker: "mail-handler" })
  })

  test("sends the name, and an enabled of false, as given", async () => {
    const { tool, requests } = ruleAddFor()

    const result = await invoke(tool, { ...ARGS, name: "Sales to owner", enabled: false }, CTX)

    expect(sent(requests, "POST")[0]!.body).toEqual({
      matchers: MATCHERS,
      actions: [{ type: "forward", value: [DESTINATION] }],
      enabled: false,
      name: "Sales to owner",
    })
    expect(result.rule.after).toMatchObject({ name: "Sales to owner", enabled: false })
  })

  test.each([
    ["a local part", "Sales", TO],
    ["a full address at the zone", " SALES@Example.com ", TO],
    ["a full address at a subdomain", "Info@Mail.Example.com", "info@mail.example.com"],
  ])("takes `to` as %s", async (_what, to, expected) => {
    const { tool, requests } = ruleAddFor()

    const result = await invoke(tool, { ...ARGS, to }, CTX)

    expect(sent(requests, "POST")[0]!.body).toMatchObject({
      matchers: [{ type: "literal", field: "to", value: expected }],
    })
    expect(result.rule.after.to).toBe(expected)
  })
})

describe("cloudflareEmailRuleAdd: Email Routing off or unknown", () => {
  test("adds the rule on a zone with Email Routing off and says no mail is routed yet", async () => {
    const { tool, requests } = ruleAddFor(routingRoute(ok({ enabled: false, status: "unconfigured" })))

    const result = await invoke(tool, ARGS, CTX)

    expect(sent(requests, "POST")).toHaveLength(1)
    expect(result.routing_enabled).toBe(false)
    expect(result.note).toBe(
      `Email Routing is off on ${ZONE_NAME}: no mail is routed until it is turned on in the dashboard, which adds the zone's MX, SPF and DKIM records.`,
    )
  })

  test.each([
    ["fails", fail(500, [{ code: 1000, message: "Down" }])],
    ["is refused", fail(403, [{ code: 10000, message: "Authentication error" }])],
    ["is not an object", ok(null)],
  ])("adds the rule and reports null when the settings read %s", async (_what, reply) => {
    const { tool, requests } = ruleAddFor(routingRoute(reply))

    const result = await invoke(tool, ARGS, CTX)

    expect(sent(requests, "POST")).toHaveLength(1)
    expect(result.routing_enabled).toBeNull()
    expect(result).not.toHaveProperty("note")
  })
})

describe("cloudflareEmailRuleAdd: targets", () => {
  test("name the address in the zone, after finding the zone only", async () => {
    const { tool, requests } = ruleAddFor()

    expect(await writeTargets(tool, { ...ARGS, to: " Sales " }, CTX)).toEqual([TARGET])
    expect(calls(requests)).toEqual(["GET /zones"])
  })

  test("find the zone by id", async () => {
    const { tool } = ruleAddFor()

    expect(await writeTargets(tool, { ...ARGS, zone: ZONE_ID, to: `sales@Shop.${ZONE_NAME}` }, CTX)).toEqual([
      TARGET.replace("sales@", "sales@shop."),
    ])
  })

  test.each([
    ["an address outside the zone", { ...ARGS, to: "sales@other.net" }],
    ["a bad local part", { ...ARGS, to: "a b" }],
    ["a wildcard in the local part", { ...ARGS, to: "sa*es" }],
    ["arguments the schema refuses", { ...ARGS, action: { type: "forward" } }],
    ["a zone of no account", { ...ARGS, zone: "other.net" }],
  ])("are `*` for %s", async (_what, args) => {
    const { tool } = ruleAddFor()

    expect(await writeTargets(tool, args, CTX)).toEqual(["*"])
  })

  test("are `*` when the zone lookup fails", async () => {
    const { tool } = ruleAddFor({ method: "GET", path: "/zones", reply: { status: 500, body: "down" } })

    expect(await writeTargets(tool, ARGS, CTX)).toEqual(["*"])
  })

  test("pass a cancellation on", async () => {
    const controller = new AbortController()
    const { tool } = ruleAddFor({
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

test("a forward whose destination the fake lists in another case is found", async () => {
  const { tool } = ruleAddFor(
    addressesRoute(() => ok([{ id: "x", email: "OWNER@Example.NET", verified: "2024-01-01T00:00:00Z" }])),
  )

  const result = await invoke(tool, ARGS, CTX)

  expect(result.rule.after.id).toBe(NEW_RULE_ID)
})
