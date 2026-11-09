import { describe, expect, test } from "bun:test"
import { ok } from "../cloudflare/testing"
import { invoke } from "../tool"
import {
  ADDRESSES_PATH,
  ARGS,
  CTX,
  DESTINATION,
  NEW_RULE_ID,
  TO,
  ZONE_NAME,
  addressRow,
  addressesRoute,
  calls,
  paged,
  refusalOf,
  ruleAddFor,
  ruleRow,
  rulesRoute,
  sent,
} from "./rule.fixtures"

const BAD_TO = `to must be an address at ${ZONE_NAME} or one of its subdomains, e.g. sales@${ZONE_NAME}.`
const NOTHING_CHANGED = " Nothing was changed."

describe("cloudflareEmailRuleAdd: `to` outside the zone or not an address", () => {
  test.each([
    ["another domain", "sales@other.net"],
    ["a look-alike suffix", `sales@evil${ZONE_NAME}`],
    ["a parent of the zone", "sales@com"],
    ["a second @", "a@b@mail.example.com"],
    ["an empty local part", `@${ZONE_NAME}`],
    ["nothing at all", "   "],
    ["a space", "sa les"],
    ["a backtick", "sa`les"],
    ["a non-ASCII letter", "salés"],
    ["a leading dot", ".sales"],
    ["a trailing dot", "sales."],
    ["a local part of 65 characters", "a".repeat(65)],
    ["an empty subdomain label", `sales@.${ZONE_NAME}`],
  ])("refuses %s and sends no write", async (_what, to) => {
    const { tool, requests } = ruleAddFor()

    const message = await refusalOf(invoke(tool, { ...ARGS, to }, CTX))

    expect(message).toStartWith(BAD_TO)
    expect(message).toEndWith(NOTHING_CHANGED)
    expect(sent(requests, "POST")).toHaveLength(0)
    expect(calls(requests)).toEqual(["GET /zones"])
  })

  test("names the rule for the part before @ when that is the problem", async () => {
    const { tool } = ruleAddFor()

    const message = await refusalOf(invoke(tool, { ...ARGS, to: "sa les" }, CTX))

    expect(message).toContain("The part before @ is 1–64 letters, digits or")
  })

  test("refuses an address longer than 90 characters, the most Cloudflare lets a rule match", async () => {
    const { tool, requests } = ruleAddFor()

    const to = `${"a".repeat(64)}@${"b".repeat(14)}.${ZONE_NAME}`
    expect(to).toHaveLength(91)
    const message = await refusalOf(invoke(tool, { ...ARGS, to }, CTX))

    expect(message).toBe(`to is longer than 90 characters, the most Cloudflare lets a rule match.${NOTHING_CHANGED}`)
    expect(sent(requests, "POST")).toHaveLength(0)
  })

  test("accepts the longest local part and an address of exactly 90 characters", async () => {
    const { tool } = ruleAddFor()
    const edge = `${"a".repeat(64)}@${"b".repeat(13)}.${ZONE_NAME}`
    expect(edge).toHaveLength(90)

    const longest = await invoke(tool, { ...ARGS, to: "a".repeat(64) }, CTX)
    const atLimit = await invoke(tool, { ...ARGS, to: edge }, CTX)

    expect(longest.rule.after.to).toBe(`${"a".repeat(64)}@${ZONE_NAME}`)
    expect(atLimit.rule.after.to).toBe(edge)
  })
})

describe("cloudflareEmailRuleAdd: arguments the schema refuses", () => {
  test.each([
    ["a forward without a destination", { type: "forward" }],
    ["a forward to something that is not an address", { type: "forward", to: "not-an-address" }],
    ["a forward to an address without a dot in its domain", { type: "forward", to: "owner@localhost" }],
    ["a forward to an address longer than 90 characters", { type: "forward", to: `${"a".repeat(80)}@example.net` }],
    ["a Worker with an uppercase name", { type: "worker", worker: "Mail-Handler" }],
    ["a Worker with a name of 64 characters", { type: "worker", worker: "a".repeat(64) }],
    ["a Worker without a name", { type: "worker" }],
    ["an unknown type", { type: "reject" }],
    ["no type", { to: DESTINATION }],
    ["a drop with an extra key", { type: "drop", to: DESTINATION }],
    ["a forward with an extra key", { type: "forward", to: DESTINATION, worker: "w" }],
  ])("refuses %s before reading anything", async (_what, action) => {
    const { tool, requests } = ruleAddFor()

    const message = await refusalOf(invoke(tool, { ...ARGS, action }, CTX))

    expect(message).toStartWith("Invalid arguments for cloudflare_email_rule_add: ")
    expect(requests).toHaveLength(0)
  })

  test.each([
    ["a newline", "two\nlines"],
    ["a control character", "bell\u0007"],
    ["101 characters", "n".repeat(101)],
    ["nothing", ""],
  ])("refuses a name with %s", async (_what, name) => {
    const { tool, requests } = ruleAddFor()

    const message = await refusalOf(invoke(tool, { ...ARGS, name }, CTX))

    expect(message).toStartWith("Invalid arguments for cloudflare_email_rule_add: name: ")
    expect(requests).toHaveLength(0)
  })

  test("refuses an argument it does not know, and a priority", async () => {
    const { tool, requests } = ruleAddFor()

    const message = await refusalOf(invoke(tool, { ...ARGS, priority: 1 }, CTX))

    expect(message).toContain("priority: unknown argument")
    expect(requests).toHaveLength(0)
  })

  test("accepts a name of 100 characters", async () => {
    const { tool, requests } = ruleAddFor()

    await invoke(tool, { ...ARGS, name: "n".repeat(100) }, CTX)

    expect(sent(requests, "POST")).toHaveLength(1)
  })
})

describe("cloudflareEmailRuleAdd: an address that already has a rule", () => {
  const EXISTING = `${TO} already has a routing rule (${"a1".repeat(16)}, Existing), and Cloudflare uses only the first rule for an address; change that one instead.${NOTHING_CHANGED}`

  test("refuses it, without reading the destination addresses, and sends no write", async () => {
    const { tool, requests } = ruleAddFor(rulesRoute(paged([[ruleRow("other@example.com"), ruleRow(TO)]])))

    const message = await refusalOf(invoke(tool, ARGS, CTX))

    expect(message).toBe(EXISTING)
    expect(calls(requests).filter((call) => call.includes("addresses"))).toEqual([])
    expect(sent(requests, "POST")).toHaveLength(0)
  })

  test("compares without regard to case and names a rule without a name as unnamed", async () => {
    const { tool } = ruleAddFor(rulesRoute(paged([[ruleRow("SALES@Example.com", { name: null })]])))

    const message = await refusalOf(invoke(tool, ARGS, CTX))

    expect(message).toBe(EXISTING.replace("Existing", "unnamed"))
  })

  test("refuses it for any action", async () => {
    const { tool } = ruleAddFor(rulesRoute(paged([[ruleRow(TO)]])))

    for (const action of [{ type: "drop" }, { type: "worker", worker: "mail-handler" }]) {
      expect(await refusalOf(invoke(tool, { ...ARGS, action }, CTX))).toBe(EXISTING)
    }
  })

  test("finds it when the rule has a shape these tools do not change", async () => {
    const odd = ruleRow(TO, {
      matchers: [
        { type: "literal", field: "to", value: TO },
        { type: "literal", field: "to", value: "other@example.com" },
      ],
    })
    const { tool, requests } = ruleAddFor(rulesRoute(paged([[odd]])))

    expect(await refusalOf(invoke(tool, ARGS, CTX))).toBe(EXISTING)
    expect(sent(requests, "POST")).toHaveLength(0)
  })

  test("finds it on the second page, and reads no further", async () => {
    const { tool, requests } = ruleAddFor(
      rulesRoute(paged([[ruleRow("a@example.com")], [ruleRow(TO)], [ruleRow("b@example.com")]])),
    )

    expect(await refusalOf(invoke(tool, ARGS, CTX))).toBe(EXISTING)
    const pages = requests.filter((request) => request.path.endsWith("/rules") && request.method === "GET")
    expect(pages.map((request) => request.query.get("page"))).toEqual(["1", "2"])
  })

  test("is not confused by the catch-all or by another address", async () => {
    const catchAll = { id: "c9", matchers: [{ type: "all" }], actions: [{ type: "drop" }], enabled: true }
    const { tool, requests } = ruleAddFor(rulesRoute(paged([[catchAll, ruleRow(`x${TO}`)]])))

    const result = await invoke(tool, ARGS, CTX)

    expect(result.rule.after.id).toBe(NEW_RULE_ID)
    expect(sent(requests, "POST")).toHaveLength(1)
  })
})

describe("cloudflareEmailRuleAdd: a forward to an address that is not a verified destination", () => {
  const UNKNOWN = `${DESTINATION} is not a destination address of this account. Add it as one; Cloudflare then mails its owner, and a rule can forward to it once they confirm.${NOTHING_CHANGED}`
  const PENDING = `${DESTINATION} is a destination address whose owner has not confirmed Cloudflare's mail yet; a rule can forward only to a verified address.${NOTHING_CHANGED}`

  test("refuses an address the account does not have", async () => {
    const { tool, requests } = ruleAddFor(addressesRoute(paged([[addressRow("someone@example.net")]])))

    expect(await refusalOf(invoke(tool, ARGS, CTX))).toBe(UNKNOWN)
    expect(sent(requests, "POST")).toHaveLength(0)
  })

  test.each([
    ["has no verification time", null],
    ["has an empty one", ""],
  ])("refuses an address that %s", async (_what, verified) => {
    const { tool, requests } = ruleAddFor(addressesRoute(paged([[addressRow(DESTINATION, verified)]])))

    expect(await refusalOf(invoke(tool, ARGS, CTX))).toBe(PENDING)
    expect(sent(requests, "POST")).toHaveLength(0)
  })

  test("matches the address without regard to case, and finds a pending one on the second page", async () => {
    const { tool, requests } = ruleAddFor(
      addressesRoute(paged([[addressRow("someone@example.net")], [addressRow("OWNER@Example.NET", null)]])),
    )

    expect(await refusalOf(invoke(tool, ARGS, CTX))).toBe(PENDING)
    const pages = requests.filter((request) => request.path === ADDRESSES_PATH)
    expect(pages.map((request) => request.query.get("page"))).toEqual(["1", "2"])
    expect(sent(requests, "POST")).toHaveLength(0)
  })

  test("accepts a verified address found on the second page, matched without regard to case", async () => {
    const { tool, requests } = ruleAddFor(
      addressesRoute(paged([[addressRow("someone@example.net")], [addressRow("OWNER@Example.NET")]])),
    )

    const result = await invoke(tool, ARGS, CTX)

    expect(result.rule.after.action).toEqual({ type: "forward", to: DESTINATION })
    expect(sent(requests, "POST")).toHaveLength(1)
  })

  test("is not asked of a drop or a Worker, whatever the addresses are", async () => {
    const { tool } = ruleAddFor(addressesRoute(ok([])))

    for (const action of [{ type: "drop" }, { type: "worker", worker: "mail-handler" }]) {
      const result = await invoke(tool, { ...ARGS, to: `${action.type}`, action }, CTX)
      expect(result.rule.after.id).toBe(NEW_RULE_ID)
    }
  })
})
