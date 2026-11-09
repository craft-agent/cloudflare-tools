import { describe, expect, test } from "bun:test"
import { fail, ok, type FakeRoute } from "../cloudflare/testing"
import { callDescription } from "../describe"
import type { ErrorCode } from "../errors"
import {
  CATCH_ALL_RULE,
  CATCH_BASE,
  DISABLED_CATCH_ALL,
  SHAPED_CATCH_ALL,
  catchAllEditFor,
  catchAllRoute,
} from "./catchall.fixtures"
import { describing, readsOf, refusing, writes } from "./describe.fixtures"
import { CATCH_ALL_PATH } from "./fixtures"
import { OTHER_DESTINATION } from "./rule.current.fixtures"
import { CTX, DESTINATION, addressRow, addressesRoute, paged, routingRoute } from "./rule.fixtures"

const HEADLINE = { text: "About to change the catch-all of {zone}", values: { zone: "example.com" } }
const ROUTING_OFF = {
  label: "Email Routing",
  value: { text: "off: no mail is routed until it is turned on in the dashboard" },
}
const NO_CATCH_ALL = catchAllRoute(fail(404, [{ code: 1004, message: "Not found" }]))
const OFF = { text: "off: mail no rule matches is rejected" }
const on = (action: string) => ({ text: "on: {action}", values: { action } })

describe("cloudflareEmailCatchAllEdit: describe", () => {
  test("states its intent", () => {
    expect(catchAllEditFor().tool.intent).toBe("About to change a catch-all")
  })

  test("names the zone and the catch-all's action now and after, and pins the catch-all as it was read", async () => {
    const { tool, requests } = catchAllEditFor()

    const { description, asked } = await describing(tool, {
      ...CATCH_BASE,
      action: { type: "forward", to: OTHER_DESTINATION },
    })

    expect(description).toEqual({
      headline: HEADLINE,
      facts: [
        { label: "Now", value: on("drop") },
        { label: "After", value: on(`forward ${OTHER_DESTINATION}`) },
      ],
      pins: { catch_all: expect.any(String) },
    })
    expect(JSON.parse(description.pins!.catch_all!)).toEqual(SHAPED_CATCH_ALL)
    expect(asked).toEqual([])
    expect(writes(requests)).toEqual([])
  })

  test("shows turning the catch-all off as off after", async () => {
    const { tool } = catchAllEditFor()

    const { description } = await describing(tool, { ...CATCH_BASE, enabled: false })

    expect(description.facts).toEqual([
      { label: "Now", value: on("drop") },
      { label: "After", value: OFF },
    ])
  })

  test("shows turning it on from off as off now and the action it keeps after", async () => {
    const { tool } = catchAllEditFor(catchAllRoute(ok(DISABLED_CATCH_ALL)))

    const { description } = await describing(tool, { ...CATCH_BASE, replaces: "disabled", enabled: true })

    expect(description.facts).toEqual([
      { label: "Now", value: OFF },
      { label: "After", value: on("drop") },
    ])
  })

  test("shows a zone without a catch-all as off now, and pins nothing but that", async () => {
    const { tool } = catchAllEditFor(NO_CATCH_ALL)

    const { description } = await describing(tool, {
      zone: "example.com",
      replaces: "disabled",
      enabled: true,
      action: { type: "forward", to: DESTINATION },
    })

    expect(description.facts).toEqual([
      { label: "Now", value: OFF },
      { label: "After", value: on(`forward ${DESTINATION}`) },
    ])
    expect(description.pins).toEqual({ catch_all: "null" })
  })

  test("shows a forward changed to a Worker, and a new action given while it is turned off as off after", async () => {
    const forward = { type: "forward", value: [DESTINATION] }
    const { tool } = catchAllEditFor(catchAllRoute(ok({ ...CATCH_ALL_RULE, actions: [forward] })))

    const change = await describing(tool, {
      ...CATCH_BASE,
      replaces: { type: "forward", to: DESTINATION },
      action: { type: "worker", worker: "inbox" },
    })
    const off = await describing(tool, {
      ...CATCH_BASE,
      replaces: { type: "forward", to: DESTINATION },
      action: { type: "worker", worker: "inbox" },
      enabled: false,
    })

    expect(change.description.facts).toEqual([
      { label: "Now", value: on(`forward ${DESTINATION}`) },
      { label: "After", value: on("worker inbox") },
    ])
    expect(off.description.facts[1]).toEqual({ label: "After", value: OFF })
  })

  test("puts a zone with Email Routing off first, and says nothing of one that cannot be read", async () => {
    const off = await describing(catchAllEditFor(routingRoute(ok({ enabled: false }))).tool, {
      ...CATCH_BASE,
      enabled: false,
    })
    const unknown = await describing(catchAllEditFor(routingRoute({ status: 500, body: "down" })).tool, {
      ...CATCH_BASE,
      enabled: false,
    })

    expect(off.description.facts[0]).toEqual(ROUTING_OFF)
    expect(off.description.facts).toHaveLength(3)
    expect(unknown.description.facts).toHaveLength(2)
  })

  test("pins change with a part the prompt does not show: the catch-all's name", async () => {
    const args = { ...CATCH_BASE, enabled: false }
    const base = await describing(catchAllEditFor().tool, args)
    const renamed = await describing(
      catchAllEditFor(catchAllRoute(ok({ ...CATCH_ALL_RULE, name: "Other" }))).tool,
      args,
    )

    expect(renamed.description.facts).toEqual(base.description.facts)
    expect(renamed.description.pins).not.toEqual(base.description.pins)
  })

  test("reads the catch-all once and never again after an answer", async () => {
    const { tool, requests } = catchAllEditFor()

    await describing(tool, { ...CATCH_BASE, enabled: false })

    expect(readsOf(requests, CATCH_ALL_PATH)).toBe(1)
  })

  test("gives the same description twice for the same state", async () => {
    const { tool } = catchAllEditFor()
    const args = { ...CATCH_BASE, enabled: false }

    const first = await describing(tool, args)
    const second = await describing(tool, args)

    expect(second.description).toEqual(first.description)
  })

  test("is accepted by the description check", async () => {
    const { tool } = catchAllEditFor()

    const answer = await callDescription(tool, { ...CATCH_BASE, enabled: false }, CTX)

    expect(answer?.headline).toEqual(HEADLINE)
    expect(answer?.pins?.catch_all).toBeDefined()
  })
})

describe("cloudflareEmailCatchAllEdit: describe refuses where execute would", () => {
  test.each<[string, FakeRoute[], object, ErrorCode, string]>([
    ["nothing named", [], CATCH_BASE, "invalid_argument", "Name what changes: action or enabled."],
    [
      "a catch-all in another state",
      [],
      { ...CATCH_BASE, replaces: "disabled", enabled: true },
      "stale",
      "is now on (mail no rule matches is dropped), not off",
    ],
    [
      "an action it already has",
      [],
      { ...CATCH_BASE, action: { type: "drop" } },
      "invalid_argument",
      "already reads that way",
    ],
    [
      "turning on a catch-all that has no action",
      [NO_CATCH_ALL],
      { zone: "example.com", replaces: "disabled", enabled: true },
      "invalid_argument",
      "Name the action the catch-all takes once it is on",
    ],
    [
      "a forward to an address whose owner has not confirmed",
      [addressesRoute(paged([[addressRow(DESTINATION), addressRow(OTHER_DESTINATION, null)]]))],
      { ...CATCH_BASE, action: { type: "forward", to: OTHER_DESTINATION } },
      "invalid_argument",
      "has not confirmed",
    ],
    [
      "a catch-all Wrangler manages",
      [catchAllRoute(ok({ ...CATCH_ALL_RULE, source: "wrangler" }))],
      { ...CATCH_BASE, enabled: false },
      "invalid_argument",
      "managed by a Worker's Wrangler",
    ],
    [
      "a catch-all of a shape it does not change",
      [catchAllRoute(ok({ ...CATCH_ALL_RULE, actions: [] }))],
      { ...CATCH_BASE, enabled: false },
      "invalid_argument",
      "has a shape these tools do not change",
    ],
  ])("throws for %s, and writes and asks nothing", async (_what, routes, args, code, message) => {
    const { tool, requests } = catchAllEditFor(...routes)

    const { error, asked } = await refusing(tool, args)

    expect(error.code).toBe(code)
    expect(error.message).toContain(message)
    expect(asked).toEqual([])
    expect(writes(requests)).toEqual([])
  })

  test("gives nothing to the description check for a call execute would refuse", async () => {
    const { tool } = catchAllEditFor()

    expect(await callDescription(tool, CATCH_BASE, CTX)).toBeUndefined()
  })
})
