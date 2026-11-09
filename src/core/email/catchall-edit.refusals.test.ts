import { describe, expect, test } from "bun:test"
import { toolError } from "../cloudflare/client.fixtures"
import { fail, ok, type FakeRoute } from "../cloudflare/testing"
import { invoke } from "../tool"
import { CATCH_ALL_RULE, CATCH_BASE, DISABLED_CATCH_ALL, catchAllEditFor, catchAllRoute } from "./catchall.fixtures"
import { OTHER_DESTINATION } from "./rule.current.fixtures"
import { CTX, DESTINATION, ZONE_NAME, addressRow, addressesRoute, paged, refusalOf, sent } from "./rule.fixtures"

const NOTHING_CHANGED = " Nothing was changed."
const MISSING = catchAllRoute(fail(404, [{ code: 1004, message: "Not found" }]))
const FORWARDING = { ...CATCH_ALL_RULE, actions: [{ type: "forward", value: [DESTINATION] }] }
const DROPPING = "on (mail no rule matches is dropped)"
const OFF = "off (mail no rule matches is rejected)"
const STALE_END = `; read cloudflare_email_read routing again before changing it.${NOTHING_CHANGED}`

describe("cloudflareEmailCatchAllEdit: stale", () => {
  test.each<[string, FakeRoute | undefined, object, string]>([
    [
      "an action for another",
      undefined,
      { replaces: { type: "forward", to: DESTINATION } },
      `${DROPPING}, not on (mail no rule matches is forwarded to ${DESTINATION})`,
    ],
    [
      "an action for a Worker",
      undefined,
      { replaces: { type: "worker", worker: "mail-handler" } },
      `${DROPPING}, not on (mail no rule matches goes to the Worker mail-handler)`,
    ],
    ["disabled for an enabled catch-all", undefined, { replaces: "disabled" }, `${DROPPING}, not ${OFF}`],
    [
      "an action for a disabled catch-all",
      catchAllRoute(ok(DISABLED_CATCH_ALL)),
      { replaces: { type: "drop" } },
      `${OFF}, not ${DROPPING}`,
    ],
    ["an action for a missing catch-all", MISSING, { replaces: { type: "drop" } }, `${OFF}, not ${DROPPING}`],
  ])("refuses %s, and sends no write", async (_what, route, extra, text) => {
    const { tool, requests } = catchAllEditFor(...(route ? [route] : []))

    const error = await toolError(invoke(tool, { ...CATCH_BASE, enabled: false, ...extra }, CTX))

    expect(error.code).toBe("stale")
    expect(error.message).toBe(`The catch-all of ${ZONE_NAME} is now ${text}${STALE_END}`)
    expect(sent(requests, "PUT")).toHaveLength(0)
  })

  test("does not take a forward address that differs only in case for a mismatch", async () => {
    const { tool, requests } = catchAllEditFor(
      catchAllRoute(ok({ ...FORWARDING, actions: [{ type: "forward", value: ["Owner@Example.NET"] }] })),
    )

    await invoke(tool, { ...CATCH_BASE, replaces: { type: "forward", to: "OWNER@example.net" }, enabled: false }, CTX)

    expect(sent(requests, "PUT")).toHaveLength(1)
  })

  test("takes `disabled` for a catch-all that is off, whatever action it keeps", async () => {
    const { tool, requests } = catchAllEditFor(
      catchAllRoute(ok({ ...DISABLED_CATCH_ALL, actions: [{ type: "worker", value: ["w"] }] })),
    )

    await invoke(tool, { ...CATCH_BASE, replaces: "disabled", action: { type: "drop" } }, CTX)

    expect(sent(requests, "PUT")).toHaveLength(1)
  })

  test("is checked before the new values", async () => {
    const { tool } = catchAllEditFor()

    const error = await toolError(invoke(tool, { ...CATCH_BASE, replaces: "disabled", enabled: true }, CTX))

    expect(error.code).toBe("stale")
  })
})

describe("cloudflareEmailCatchAllEdit: the change", () => {
  test("refuses a call that names nothing to change, before anything is read", async () => {
    const { tool, requests } = catchAllEditFor()

    const message = await refusalOf(invoke(tool, CATCH_BASE, CTX))

    expect(message).toBe("Name what changes: action or enabled.")
    expect(requests).toHaveLength(0)
  })

  test.each<[string, FakeRoute | undefined]>([
    ["no catch-all", MISSING],
    ["a disabled catch-all with no plain action", catchAllRoute(ok({ ...DISABLED_CATCH_ALL, actions: [] }))],
  ])("refuses turning on %s without an action", async (_what, route) => {
    const { tool, requests } = catchAllEditFor(route!)

    const message = await refusalOf(invoke(tool, { ...CATCH_BASE, replaces: "disabled", enabled: true }, CTX))

    expect(message).toBe(`Name the action the catch-all takes once it is on.${NOTHING_CHANGED}`)
    expect(sent(requests, "PUT")).toHaveLength(0)
  })

  test.each<[string, FakeRoute | undefined, object]>([
    ["the same action while it is on", undefined, { action: { type: "drop" }, enabled: true }],
    [
      "the same forward in another case",
      catchAllRoute(ok(FORWARDING)),
      { replaces: { type: "forward", to: DESTINATION }, action: { type: "forward", to: "OWNER@example.net" } },
    ],
    ["turning off what is off", catchAllRoute(ok(DISABLED_CATCH_ALL)), { replaces: "disabled", enabled: false }],
    ["turning off a missing catch-all", MISSING, { replaces: "disabled", enabled: false }],
    [
      "the kept action of a disabled catch-all",
      catchAllRoute(ok(DISABLED_CATCH_ALL)),
      { replaces: "disabled", action: { type: "drop" }, enabled: false },
    ],
  ])("refuses %s as no change, and sends no write", async (_what, route, extra) => {
    const { tool, requests } = catchAllEditFor(...(route ? [route] : []))

    const message = await refusalOf(invoke(tool, { ...CATCH_BASE, ...extra }, CTX))

    expect(message).toBe(`The catch-all of ${ZONE_NAME} already reads that way.${NOTHING_CHANGED}`)
    expect(sent(requests, "PUT")).toHaveLength(0)
  })

  test("refuses a catch-all that a Worker's Wrangler configuration manages", async () => {
    const { tool, requests } = catchAllEditFor(catchAllRoute(ok({ ...CATCH_ALL_RULE, source: "wrangler" })))

    const message = await refusalOf(invoke(tool, { ...CATCH_BASE, enabled: false }, CTX))

    expect(message).toBe(
      `The catch-all of ${ZONE_NAME} is managed by a Worker's Wrangler configuration, and its next deploy would undo the change; change it there.${NOTHING_CHANGED}`,
    )
    expect(sent(requests, "PUT")).toHaveLength(0)
  })

  test("refuses an enabled catch-all of a shape these tools do not change", async () => {
    const { tool, requests } = catchAllEditFor(catchAllRoute(ok({ ...CATCH_ALL_RULE, actions: [] })))

    const message = await refusalOf(invoke(tool, { ...CATCH_BASE, enabled: false }, CTX))

    expect(message).toBe(
      `The catch-all of ${ZONE_NAME} has a shape these tools do not change; change it in the dashboard.${NOTHING_CHANGED}`,
    )
    expect(sent(requests, "PUT")).toHaveLength(0)
  })

  test("refuses an answer that is not a rule", async () => {
    const { tool } = catchAllEditFor(catchAllRoute(ok("none")))

    const error = await toolError(invoke(tool, { ...CATCH_BASE, enabled: false }, CTX))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe("Cloudflare returned an unexpected routing rule response.")
  })

  test("refuses unknown arguments, a priority among them", async () => {
    const { tool, requests } = catchAllEditFor()

    const message = await refusalOf(invoke(tool, { ...CATCH_BASE, enabled: false, priority: 1 }, CTX))

    expect(message).toContain("priority: unknown argument")
    expect(requests).toHaveLength(0)
  })
})

describe("cloudflareEmailCatchAllEdit: a forward to an address that is not a verified destination", () => {
  const FORWARD = { ...CATCH_BASE, action: { type: "forward", to: OTHER_DESTINATION } }

  test("refuses an address the account does not have", async () => {
    const { tool, requests } = catchAllEditFor(addressesRoute(paged([[addressRow("someone@example.net")]])))

    const message = await refusalOf(invoke(tool, FORWARD, CTX))

    expect(message).toBe(
      `${OTHER_DESTINATION} is not a destination address of this account. cloudflare_email_address_add adds it; Cloudflare then mails its owner, and a rule can forward to it once they confirm.${NOTHING_CHANGED}`,
    )
    expect(sent(requests, "PUT")).toHaveLength(0)
  })

  test("refuses an address whose owner has not confirmed it", async () => {
    const { tool, requests } = catchAllEditFor(addressesRoute(paged([[addressRow(OTHER_DESTINATION, null)]])))

    const message = await refusalOf(invoke(tool, FORWARD, CTX))

    expect(message).toBe(
      `${OTHER_DESTINATION} is a destination address whose owner has not confirmed Cloudflare's mail yet; a rule can forward only to a verified address.${NOTHING_CHANGED}`,
    )
    expect(sent(requests, "PUT")).toHaveLength(0)
  })

  test("refuses turning on a catch-all that kept a forward when the new forward is another address", async () => {
    const { tool, requests } = catchAllEditFor(
      catchAllRoute(ok({ ...FORWARDING, enabled: false })),
      addressesRoute(ok([])),
    )

    const message = await refusalOf(invoke(tool, { ...FORWARD, replaces: "disabled", enabled: true }, CTX))

    expect(message).toContain("is not a destination address of this account")
    expect(sent(requests, "PUT")).toHaveLength(0)
  })

  test("does not check an address the catch-all will not use, since it ends up off", async () => {
    const { tool, requests } = catchAllEditFor(addressesRoute(ok([])))

    await invoke(tool, { ...FORWARD, enabled: false }, CTX)

    expect(sent(requests, "PUT")).toHaveLength(1)
  })
})
