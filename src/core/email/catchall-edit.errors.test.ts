import { describe, expect, test } from "bun:test"
import { rejection, toolError } from "../cloudflare/client.fixtures"
import { fail, ok, type FakeReply } from "../cloudflare/testing"
import { isAbortError, isToolError } from "../errors"
import { invoke, type ToolContext } from "../tool"
import {
  CATCH_ALL_PATH,
  CATCH_ALL_RULE,
  CATCH_BASE,
  catchAllEditFor,
  catchAllRoute,
  replaceCatchAllRoute,
} from "./catchall.fixtures"
import { OTHER_DESTINATION } from "./rule.current.fixtures"
import { CTX, ROUTING_PATH, ZONE_NAME, addressesRoute, calls, dropped, routingRoute, sent } from "./rule.fixtures"

const DENIED = fail(403, [{ code: 10000, message: "Authentication error" }])
const MISSING = fail(404, [{ code: 1004, message: "Not found" }])
const REFUSED = { code: 9005, message: "Content is invalid" }
const NOTHING_CHANGED = " Nothing was changed."
const MAYBE =
  "Cloudflare may or may not have changed the catch-all; read cloudflare_email_read routing before sending it again."
const CHANGED = `The catch-all of ${ZONE_NAME} changed while waiting for the answer. Nothing was changed; read it again before trying again.`
const OFF = { ...CATCH_BASE, enabled: false }

const CONFIRMED: ToolContext = { ...CTX, confirm: async () => true }

/** A catch-all route that answers the first read as it is, and every later one with `later`. */
function changingRoute(later: FakeReply, first: FakeReply = ok(CATCH_ALL_RULE)) {
  let reads = 0
  return catchAllRoute(() => (reads++ === 0 ? first : later))
}

describe("cloudflareEmailCatchAllEdit: a read fails", () => {
  test("names the Rules Read permission when the catch-all cannot be read, and sends no write", async () => {
    const { tool, requests } = catchAllEditFor(catchAllRoute(DENIED))

    const error = await toolError(invoke(tool, OFF, CTX))

    expect(error.code).toBe("forbidden")
    expect(error.message).toBe("10000: Authentication error. The token needs Zone → Email Routing Rules → Read.")
    expect(sent(requests, "PUT")).toHaveLength(0)
  })

  test("a catch-all read that fails is not taken for a missing catch-all", async () => {
    const { tool } = catchAllEditFor(catchAllRoute(fail(500, [{ code: 1000, message: "Down" }])))

    const error = await toolError(invoke(tool, OFF, CTX))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe("Cloudflare answered HTTP 500: 1000: Down")
  })

  test("names the Addresses Read permission when a new forward cannot be checked", async () => {
    const { tool, requests } = catchAllEditFor(addressesRoute(DENIED))

    const error = await toolError(
      invoke(tool, { ...CATCH_BASE, action: { type: "forward", to: OTHER_DESTINATION } }, CTX),
    )

    expect(error.code).toBe("forbidden")
    expect(error.message).toBe(
      "10000: Authentication error. The token needs Account → Email Routing Addresses → Read to check the forward.",
    )
    expect(sent(requests, "PUT")).toHaveLength(0)
  })

  test("does not need the Addresses permission for a drop", async () => {
    const { tool } = catchAllEditFor(addressesRoute(DENIED))

    const result = await invoke(tool, OFF, CTX)

    expect(result.catch_all.after.enabled).toBe(false)
  })
})

describe("cloudflareEmailCatchAllEdit: declined", () => {
  test("is declined when the person says no, and nothing more is sent", async () => {
    const { tool, requests } = catchAllEditFor()

    const error = await toolError(invoke(tool, OFF, { ...CTX, confirm: async () => false }))

    expect(error.code).toBe("declined")
    expect(error.message).toStartWith("cloudflare_email_catchall_edit was declined: Change the catch-all of")
    expect(calls(requests)).toEqual(["GET /zones", `GET ${CATCH_ALL_PATH}`, `GET ${ROUTING_PATH}`])
  })
})

describe("cloudflareEmailCatchAllEdit: the catch-all changes while the person answers", () => {
  test.each([
    [
      "has another action",
      changingRoute(ok({ ...CATCH_ALL_RULE, actions: [{ type: "forward", value: ["a@example.net"] }] })),
    ],
    ["is turned off", changingRoute(ok({ ...CATCH_ALL_RULE, enabled: false }))],
    ["has another name", changingRoute(ok({ ...CATCH_ALL_RULE, name: "Renamed" }))],
    ["is gone", changingRoute(MISSING)],
    ["appears where there was none", changingRoute(ok(CATCH_ALL_RULE), MISSING)],
    ["is now managed by Wrangler", changingRoute(ok({ ...CATCH_ALL_RULE, source: "wrangler" }))],
    ["has a shape these tools do not change", changingRoute(ok({ ...CATCH_ALL_RULE, actions: [] }))],
  ])("refuses it as stale when it %s, and sends no write", async (what, route) => {
    const { tool, requests } = catchAllEditFor(route)
    const args =
      what === "appears where there was none"
        ? { ...CATCH_BASE, replaces: "disabled", action: { type: "drop" }, enabled: true }
        : OFF

    const error = await toolError(invoke(tool, args, CONFIRMED))

    expect(error.code).toBe("stale")
    expect(error.message).toBe(CHANGED)
    expect(sent(requests, "PUT")).toHaveLength(0)
  })

  test("writes when the second read is the catch-all as approved", async () => {
    const { tool, requests } = catchAllEditFor(changingRoute(ok({ ...CATCH_ALL_RULE })))

    await invoke(tool, OFF, CONFIRMED)

    expect(sent(requests, "PUT")).toHaveLength(1)
  })

  test("passes a failed second read on as it is, with no write sent", async () => {
    const { tool, requests } = catchAllEditFor(changingRoute(DENIED))

    const error = await toolError(invoke(tool, OFF, CONFIRMED))

    expect(error.code).toBe("forbidden")
    expect(sent(requests, "PUT")).toHaveLength(0)
  })

  test("reads the catch-all only once when the harness's approval stands in for the question", async () => {
    const { tool, requests } = catchAllEditFor(changingRoute(ok({ ...CATCH_ALL_RULE, name: "Renamed" })))

    await invoke(tool, OFF, CTX)

    expect(sent(requests, "PUT")).toHaveLength(1)
    expect(requests.filter((request) => request.path === CATCH_ALL_PATH && request.method === "GET")).toHaveLength(1)
  })
})

describe("cloudflareEmailCatchAllEdit: the write fails", () => {
  test.each([
    [400, "invalid_argument"],
    [404, "not_found"],
    [429, "rate_limited"],
    [409, "upstream_error"],
  ] as const)("keeps the code of a %p and says nothing was changed", async (status, code) => {
    const { tool, requests } = catchAllEditFor(replaceCatchAllRoute(fail(status, [REFUSED])))

    const error = await toolError(invoke(tool, OFF, CTX))

    expect(error.code).toBe(code)
    expect(error.message).toStartWith(
      status === 409 ? "Cloudflare answered HTTP 409: 9005: Content is invalid" : "9005",
    )
    expect(error.message).toEndWith(NOTHING_CHANGED)
    expect(sent(requests, "PUT")).toHaveLength(1)
  })

  test("names the Edit permission when forbidden, before the note", async () => {
    const { tool } = catchAllEditFor(replaceCatchAllRoute(DENIED))

    const error = await toolError(invoke(tool, OFF, CTX))

    expect(error.code).toBe("forbidden")
    expect(error.message).toBe(
      `10000: Authentication error. The token needs Zone → Email Routing Rules → Edit.${NOTHING_CHANGED}`,
    )
  })

  test("says Cloudflare may or may not have changed the catch-all after a 500", async () => {
    const { tool } = catchAllEditFor(replaceCatchAllRoute(fail(500, [{ code: 1000, message: "Down" }])))

    const error = await toolError(invoke(tool, OFF, CTX))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe(`Cloudflare answered HTTP 500: 1000: Down ${MAYBE}`)
  })

  test("says so too when the connection drops", async () => {
    const { tool, requests } = catchAllEditFor(replaceCatchAllRoute(dropped))

    const error = await toolError(invoke(tool, OFF, CTX))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe(`Cloudflare could not be reached: connection reset ${MAYBE}`)
    expect(sent(requests, "PUT")).toHaveLength(1)
  })

  test.each([
    ["no result", ok(undefined)],
    ["a result that is not an object", ok("done")],
    ["a rule without an id", ok({ name: "x" })],
  ])("treats %s as an unexpected response that may have changed the catch-all", async (_what, reply) => {
    const { tool } = catchAllEditFor(replaceCatchAllRoute(reply))

    const error = await toolError(invoke(tool, OFF, CTX))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe(`Cloudflare returned an unexpected routing rule response. ${MAYBE}`)
  })
})

describe("cloudflareEmailCatchAllEdit: cancellation", () => {
  const ARGS = { ...CATCH_BASE, action: { type: "forward", to: OTHER_DESTINATION } }

  async function cancelledAt(route: Parameters<typeof catchAllEditFor>[number]) {
    const controller = new AbortController()
    const { tool, requests } = catchAllEditFor({ ...route, reply: () => (controller.abort(), ok({})) })
    const error = await rejection(invoke(tool, ARGS, { ...CONFIRMED, signal: controller.signal }))
    return { error, requests }
  }

  test.each([
    ["the catch-all read", catchAllRoute()],
    ["the destination read", addressesRoute()],
    ["the settings read", routingRoute()],
    ["the write", replaceCatchAllRoute()],
  ])("passes a cancellation during %s on untouched, and writes nothing more", async (_what, route) => {
    const { error, requests } = await cancelledAt(route)

    expect(isAbortError(error)).toBe(true)
    expect(isToolError(error)).toBe(false)
    expect(sent(requests, "PUT")).toHaveLength(route.method === "PUT" ? 1 : 0)
  })

  test("passes a cancellation during the second read on", async () => {
    const controller = new AbortController()
    let reads = 0
    const route = catchAllRoute(() => (reads++ === 0 ? ok(CATCH_ALL_RULE) : (controller.abort(), ok(CATCH_ALL_RULE))))
    const { tool, requests } = catchAllEditFor(route)

    const error = await rejection(invoke(tool, ARGS, { ...CONFIRMED, signal: controller.signal }))

    expect(isAbortError(error)).toBe(true)
    expect(sent(requests, "PUT")).toHaveLength(0)
  })
})
