import { describe, expect, test } from "bun:test"
import { fail, ok } from "../cloudflare/testing"
import { toolError } from "../cloudflare/client.fixtures"
import { invoke } from "../tool"
import {
  CATCH_ALL_RULE,
  CURRENT_RULE,
  EDIT_BASE,
  OTHER_DESTINATION,
  RULE_ID,
  ruleEditFor,
  ruleRoute,
} from "./rule.current.fixtures"
import {
  CTX,
  DESTINATION,
  TO,
  ZONE_NAME,
  addressRow,
  addressesRoute,
  paged,
  refusalOf,
  ruleRow,
  rulesRoute,
  sent,
} from "./rule.fixtures"

const NOTHING_CHANGED = " Nothing was changed."

describe("cloudflareEmailRuleEdit: a rule these tools do not change", () => {
  test("refuses a rule the zone does not have as not_found, naming where to look", async () => {
    const { tool, requests } = ruleEditFor(ruleRoute(fail(404, [{ code: 1004, message: "Rule not found" }])))

    const error = await toolError(invoke(tool, { ...EDIT_BASE, name: "x" }, CTX))

    expect(error.code).toBe("not_found")
    expect(error.message).toBe(
      `${RULE_ID} is not a routing rule of ${ZONE_NAME}; cloudflare_email_read rules lists them.${NOTHING_CHANGED}`,
    )
    expect(sent(requests, "PUT")).toHaveLength(0)
  })

  test("refuses the catch-all and names the tool that changes it", async () => {
    const { tool, requests } = ruleEditFor(ruleRoute(ok(CATCH_ALL_RULE)))

    const message = await refusalOf(invoke(tool, { ...EDIT_BASE, name: "x" }, CTX))

    expect(message).toBe(
      `${RULE_ID} is the zone's catch-all; cloudflare_email_catchall_edit changes it.${NOTHING_CHANGED}`,
    )
    expect(sent(requests, "PUT")).toHaveLength(0)
  })

  test("refuses a rule that a Worker's Wrangler configuration manages", async () => {
    const { tool, requests } = ruleEditFor(ruleRoute(ok({ ...CURRENT_RULE, source: "wrangler" })))

    const message = await refusalOf(invoke(tool, { ...EDIT_BASE, name: "x" }, CTX))

    expect(message).toBe(
      `Rule ${RULE_ID} is managed by a Worker's Wrangler configuration, and its next deploy would undo the change; change it there.${NOTHING_CHANGED}`,
    )
    expect(sent(requests, "PUT")).toHaveLength(0)
  })

  test.each([
    [
      "two matchers",
      { matchers: [...CURRENT_RULE.matchers, { type: "literal", field: "to", value: "b@example.com" }] },
    ],
    ["two actions", { actions: [...CURRENT_RULE.actions, { type: "drop" }] }],
    ["an action of another kind", { actions: [{ type: "unknown", value: ["x"] }] }],
  ])("refuses a rule with %s", async (_what, extra) => {
    const { tool, requests } = ruleEditFor(ruleRoute(ok({ ...CURRENT_RULE, ...extra })))

    const message = await refusalOf(invoke(tool, { ...EDIT_BASE, name: "x" }, CTX))

    expect(message).toBe(
      `Rule ${RULE_ID} has a shape these tools do not change; change it in the dashboard.${NOTHING_CHANGED}`,
    )
    expect(sent(requests, "PUT")).toHaveLength(0)
  })

  test("refuses an answer that is not a rule", async () => {
    const { tool, requests } = ruleEditFor(ruleRoute(ok([])))

    const error = await toolError(invoke(tool, { ...EDIT_BASE, name: "x" }, CTX))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe("Cloudflare returned an unexpected routing rule response.")
    expect(sent(requests, "PUT")).toHaveLength(0)
  })
})

describe("cloudflareEmailRuleEdit: stale", () => {
  test.each([
    ["a drop for a forward", { type: "drop" }, "now is forwarded to owner@example.net, not dropped"],
    [
      "a Worker for a forward",
      { type: "worker", worker: "mail-handler" },
      "now is forwarded to owner@example.net, not going to the Worker mail-handler",
    ],
    [
      "another forward",
      { type: "forward", to: OTHER_DESTINATION },
      "now is forwarded to owner@example.net, not forwarded to other@example.net",
    ],
  ])("refuses %s, and sends no write", async (_what, replaces, text) => {
    const { tool, requests } = ruleEditFor()

    const error = await toolError(invoke(tool, { ...EDIT_BASE, replaces, name: "x" }, CTX))

    expect(error.code).toBe("stale")
    expect(error.message).toBe(
      `Mail to ${TO} ${text}; read the rules again before changing rule ${RULE_ID}.${NOTHING_CHANGED}`,
    )
    expect(sent(requests, "PUT")).toHaveLength(0)
  })

  test.each([
    ["a forward for a drop", { type: "drop" }, { type: "forward", to: DESTINATION }, "now is dropped, not forwarded"],
    ["another Worker", { type: "worker", worker: "a" }, { type: "worker", worker: "b" }, "now goes to the Worker a"],
  ])("names %s as the rule does it now", async (_what, now, replaces, text) => {
    const { tool } = ruleEditFor(ruleRoute(ok({ ...CURRENT_RULE, actions: [{ ...now, value: ["a"] }] })))

    const error = await toolError(invoke(tool, { ...EDIT_BASE, replaces, name: "x" }, CTX))

    expect(error.code).toBe("stale")
    expect(error.message).toContain(text)
  })

  test("does not take a forward address that differs only in case for a mismatch", async () => {
    const { tool, requests } = ruleEditFor(
      ruleRoute(ok({ ...CURRENT_RULE, actions: [{ type: "forward", value: ["Owner@Example.NET"] }] })),
    )

    await invoke(tool, { ...EDIT_BASE, replaces: { type: "forward", to: "OWNER@example.net" }, name: "x" }, CTX)

    expect(sent(requests, "PUT")).toHaveLength(1)
  })

  test("is checked before the new values: an unusable address is not what the call answers first", async () => {
    const { tool } = ruleEditFor()

    const error = await toolError(
      invoke(tool, { ...EDIT_BASE, replaces: { type: "drop" }, to: "sales@other.net" }, CTX),
    )

    expect(error.code).toBe("stale")
  })
})

describe("cloudflareEmailRuleEdit: the change", () => {
  test("refuses a call that names nothing to change, before anything is read", async () => {
    const { tool, requests } = ruleEditFor()

    const message = await refusalOf(invoke(tool, EDIT_BASE, CTX))

    expect(message).toBe("Name what changes: to, action, name or enabled.")
    expect(requests).toHaveLength(0)
  })

  test("refuses a call whose values are the rule's own, whatever the case of the address", async () => {
    const { tool, requests } = ruleEditFor()

    const message = await refusalOf(
      invoke(
        tool,
        {
          ...EDIT_BASE,
          to: "SALES",
          action: { type: "forward", to: "OWNER@example.net" },
          name: "Sales forward",
          enabled: true,
        },
        CTX,
      ),
    )

    expect(message).toBe(`Rule ${RULE_ID} already reads that way.${NOTHING_CHANGED}`)
    expect(sent(requests, "PUT")).toHaveLength(0)
  })

  test("refuses an address outside the zone", async () => {
    const { tool, requests } = ruleEditFor()

    const message = await refusalOf(invoke(tool, { ...EDIT_BASE, to: "sales@other.net" }, CTX))

    expect(message).toStartWith(`to must be an address at ${ZONE_NAME} or one of its subdomains`)
    expect(sent(requests, "PUT")).toHaveLength(0)
  })

  test("refuses a new address that another rule already has, and sends no write", async () => {
    const other = ruleRow("support@example.com", { id: "b2".repeat(16), name: null })
    const { tool, requests } = ruleEditFor(rulesRoute(paged([[ruleRow("x@example.com"), other]])))

    const message = await refusalOf(invoke(tool, { ...EDIT_BASE, to: "Support" }, CTX))

    expect(message).toBe(
      `support@${ZONE_NAME} already has a routing rule (${"b2".repeat(16)}, unnamed), and Cloudflare uses only the first rule for an address; change that one instead.${NOTHING_CHANGED}`,
    )
    expect(sent(requests, "PUT")).toHaveLength(0)
  })

  test("does not read the rules when the address stays, though a rule of that address exists", async () => {
    const { tool, requests } = ruleEditFor(rulesRoute(paged([[ruleRow(TO, { id: RULE_ID })]])))

    await invoke(tool, { ...EDIT_BASE, to: TO, enabled: false }, CTX)

    expect(sent(requests, "PUT")).toHaveLength(1)
    expect(requests.filter((request) => request.path.endsWith("/rules"))).toHaveLength(0)
  })

  test("refuses a forward to an address the account does not have", async () => {
    const { tool, requests } = ruleEditFor(addressesRoute(paged([[addressRow("someone@example.net")]])))

    const message = await refusalOf(
      invoke(tool, { ...EDIT_BASE, action: { type: "forward", to: OTHER_DESTINATION } }, CTX),
    )

    expect(message).toBe(
      `${OTHER_DESTINATION} is not a destination address of this account. cloudflare_email_address_add adds it; Cloudflare then mails its owner, and a rule can forward to it once they confirm.${NOTHING_CHANGED}`,
    )
    expect(sent(requests, "PUT")).toHaveLength(0)
  })

  test("refuses a forward to an address whose owner has not confirmed it", async () => {
    const { tool, requests } = ruleEditFor(addressesRoute(paged([[addressRow(OTHER_DESTINATION, null)]])))

    const message = await refusalOf(
      invoke(tool, { ...EDIT_BASE, action: { type: "forward", to: OTHER_DESTINATION } }, CTX),
    )

    expect(message).toBe(
      `${OTHER_DESTINATION} is a destination address whose owner has not confirmed Cloudflare's mail yet; a rule can forward only to a verified address.${NOTHING_CHANGED}`,
    )
    expect(sent(requests, "PUT")).toHaveLength(0)
  })

  test("checks the destination of a forward after a drop, since the rule did not forward before", async () => {
    const dropping = { ...CURRENT_RULE, actions: [{ type: "drop" }] }
    const { tool, requests } = ruleEditFor(ruleRoute(ok(dropping)), addressesRoute(ok([])))

    const message = await refusalOf(
      invoke(tool, { ...EDIT_BASE, replaces: { type: "drop" }, action: { type: "forward", to: DESTINATION } }, CTX),
    )

    expect(message).toContain("is not a destination address of this account")
    expect(sent(requests, "PUT")).toHaveLength(0)
  })

  test("refuses unknown arguments, a priority among them", async () => {
    const { tool, requests } = ruleEditFor()

    const message = await refusalOf(invoke(tool, { ...EDIT_BASE, name: "x", priority: 1 }, CTX))

    expect(message).toContain("priority: unknown argument")
    expect(requests).toHaveLength(0)
  })
})
