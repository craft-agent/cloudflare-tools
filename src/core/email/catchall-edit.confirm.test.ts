import { describe, expect, test } from "bun:test"
import { fail, ok, type FakeRoute } from "../cloudflare/testing"
import { writeTargets } from "../targets"
import { invoke, type ConfirmRequest } from "../tool"
import {
  CATCH_ALL_PATH,
  CATCH_ALL_RULE,
  CATCH_BASE,
  DISABLED_CATCH_ALL,
  catchAllEditFor,
  catchAllRoute,
} from "./catchall.fixtures"
import { OTHER_DESTINATION } from "./rule.current.fixtures"
import { ACCOUNT_ID, CTX, DESTINATION, ROUTING_PATH, ZONE_ID, ZONE_NAME, calls, routingRoute } from "./rule.fixtures"

const TARGET = `${ACCOUNT_ID}/zones/${ZONE_ID}/email/catch_all`
const FORWARDING = { ...CATCH_ALL_RULE, actions: [{ type: "forward", value: [DESTINATION] }] }

async function asked(tool: ReturnType<typeof catchAllEditFor>["tool"], args: object) {
  const questions: ConfirmRequest[] = []
  const result = await invoke(tool, args, {
    ...CTX,
    confirm: async (request) => {
      questions.push(request)
      return true
    },
  })
  return { questions, result }
}

describe("cloudflareEmailCatchAllEdit: the confirmation", () => {
  const BEGIN = `Change the catch-all of ${ZONE_NAME}: mail to an address no rule matches now`
  const OFF = "is rejected, since the catch-all is off"

  test.each<[string, FakeRoute | undefined, object, string]>([
    [
      "a drop to a forward",
      undefined,
      { action: { type: "forward", to: OTHER_DESTINATION } },
      `is dropped, and after this it is forwarded to ${OTHER_DESTINATION}.`,
    ],
    ["a drop to off", undefined, { enabled: false }, `is dropped, and after this it ${OFF}.`],
    [
      "a forward to a Worker",
      catchAllRoute(ok(FORWARDING)),
      { replaces: { type: "forward", to: DESTINATION }, action: { type: "worker", worker: "mail-handler" } },
      `is forwarded to ${DESTINATION}, and after this it goes to the Worker mail-handler.`,
    ],
    [
      "off to a drop",
      catchAllRoute(ok(DISABLED_CATCH_ALL)),
      { replaces: "disabled", enabled: true },
      `${OFF}, and after this it is dropped.`,
    ],
    [
      "off with no catch-all to a forward",
      catchAllRoute(fail(404, [{ code: 1004, message: "Not found" }])),
      { replaces: "disabled", enabled: true, action: { type: "forward", to: DESTINATION } },
      `${OFF}, and after this it is forwarded to ${DESTINATION}.`,
    ],
    [
      "a drop to off in the same call as a new action",
      undefined,
      { action: { type: "worker", worker: "w" }, enabled: false },
      `is dropped, and after this it ${OFF}.`,
    ],
  ])("says what changes for %s", async (_what, route, extra, clauses) => {
    const { tool } = catchAllEditFor(...(route ? [route] : []))

    const { questions } = await asked(tool, { ...CATCH_BASE, ...extra })

    expect(questions).toEqual([{ tool: "cloudflare_email_catchall_edit", message: `${BEGIN} ${clauses}` }])
  })

  test("adds that no mail is routed while Email Routing is off", async () => {
    const { tool } = catchAllEditFor(routingRoute(ok({ enabled: false })))

    const { questions } = await asked(tool, { ...CATCH_BASE, enabled: false })

    expect(questions[0]!.message).toBe(
      `${BEGIN} is dropped, and after this it ${OFF}. Email Routing is off on ${ZONE_NAME}, so no mail is routed until it is turned on in the dashboard.`,
    )
  })

  test("asks once and reads the catch-all again before it writes", async () => {
    const { tool, requests } = catchAllEditFor()

    const { questions } = await asked(tool, { ...CATCH_BASE, enabled: false })

    expect(questions).toHaveLength(1)
    expect(calls(requests)).toEqual([
      "GET /zones",
      `GET ${CATCH_ALL_PATH}`,
      `GET ${ROUTING_PATH}`,
      `GET ${CATCH_ALL_PATH}`,
      `PUT ${CATCH_ALL_PATH}`,
    ])
  })
})

describe("cloudflareEmailCatchAllEdit: targets", () => {
  test("name the zone's catch-all, after finding the zone only", async () => {
    const { tool, requests } = catchAllEditFor()

    expect(await writeTargets(tool, { ...CATCH_BASE, enabled: false }, CTX)).toEqual([TARGET])
    expect(calls(requests)).toEqual(["GET /zones"])
  })

  test.each([
    ["nothing named", CATCH_BASE],
    ["a missing replaces", { zone: "example.com", enabled: false }],
    ["an unknown argument", { ...CATCH_BASE, enabled: false, name: "x" }],
    ["a zone of no account", { ...CATCH_BASE, zone: "other.net", enabled: false }],
  ])("are `*` for %s", async (_what, args) => {
    const { tool } = catchAllEditFor()

    expect(await writeTargets(tool, args, CTX)).toEqual(["*"])
  })

  test("are `*` when the zone lookup fails", async () => {
    const { tool } = catchAllEditFor({ method: "GET", path: "/zones", reply: { status: 500, body: "down" } })

    expect(await writeTargets(tool, { ...CATCH_BASE, enabled: false }, CTX)).toEqual(["*"])
  })

  test("pass a cancellation on", async () => {
    const controller = new AbortController()
    const { tool } = catchAllEditFor({
      method: "GET",
      path: "/zones",
      reply: () => (controller.abort(), ok([])),
    })

    await expect(
      writeTargets(tool, { ...CATCH_BASE, enabled: false }, { ...CTX, signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" })
  })
})
