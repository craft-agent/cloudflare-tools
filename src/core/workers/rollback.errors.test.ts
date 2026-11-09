import { describe, expect, test } from "bun:test"
import { rejection, toolError } from "../cloudflare/client.fixtures"
import { fail, ok, type FakeReply } from "../cloudflare/testing"
import { isAbortError, isToolError } from "../errors"
import { invoke } from "../tool"
import { CTX } from "../zone/fixtures"
import { SCRIPT } from "./fixtures"
import { ARGS, HISTORY, deployRoute, historyRoute, rollbackFor, sent } from "./rollback.fixtures"

const NOTHING_DEPLOYED = "Nothing was deployed."
const MAY_OR_MAY_NOT =
  "Cloudflare may or may not have deployed it; read cloudflare_workers_read deployments before sending it again."

/** Rolls back with the deploy call answering `reply`; returns the error it failed with and what was sent. */
async function failedWith(reply: FakeReply | (() => FakeReply)) {
  const { tool, requests } = rollbackFor(historyRoute(HISTORY), deployRoute(reply))
  const error = await toolError(invoke(tool, ARGS, CTX))
  expect(sent(requests, "POST")).toHaveLength(1)
  return error
}

describe("cloudflareWorkersRollback: Cloudflare's refusal", () => {
  test("keeps the code of a 400 and says nothing was deployed", async () => {
    const error = await failedWith(fail(400, [{ code: 10001, message: "Bad request" }]))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toBe(`10001: Bad request. ${NOTHING_DEPLOYED}`)
  })

  test.each([
    [404, "not_found"],
    [429, "rate_limited"],
  ] as const)("keeps the code of a %p", async (status, code) => {
    const error = await failedWith(fail(status, [{ code: 10002, message: "Refused" }]))

    expect(error.code).toBe(code)
    expect(error.message).toEndWith(` ${NOTHING_DEPLOYED}`)
  })

  test("says nothing was deployed for a 4xx the client has no code for", async () => {
    const error = await failedWith(fail(409, [{ code: 10003, message: "Conflict" }]))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe(`Cloudflare answered HTTP 409: 10003: Conflict. ${NOTHING_DEPLOYED}`)
  })

  test("explains a refusal about secrets and never forces it", async () => {
    const error = await failedWith(
      fail(400, [{ code: 10004, message: "Cannot rollback: Secrets have changed since this version" }]),
    )

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toBe(
      `Cloudflare refused the rollback because Worker ${SCRIPT}'s secrets changed since that version served: the old code would run with today's secrets. Rolling back past it is a decision for the user, in Wrangler (wrangler rollback) or the dashboard; this tool never forces it. ${NOTHING_DEPLOYED}`,
    )
    expect(isToolError(error.cause) && error.cause.message).toContain("Secrets have changed")
  })

  test("never sends force", async () => {
    const { tool, requests } = rollbackFor(
      historyRoute(HISTORY),
      deployRoute(fail(400, [{ code: 10004, message: "secrets changed" }])),
    )

    await rejection(invoke(tool, ARGS, CTX))

    expect(sent(requests, "POST")[0]!.query.toString()).toBe("")
    expect(JSON.stringify(sent(requests, "POST")[0]!.body)).not.toContain("force")
  })
})

describe("cloudflareWorkersRollback: failures that do not tell", () => {
  test("says Cloudflare may or may not have deployed after a 500", async () => {
    const error = await failedWith(fail(500, [{ code: 1000, message: "Down" }]))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe(`Cloudflare answered HTTP 500: 1000: Down. ${MAY_OR_MAY_NOT}`)
  })

  test("says the same when the network fails", async () => {
    const error = await failedWith(() => {
      throw new Error("connection reset")
    })

    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe(`Cloudflare could not be reached: connection reset. ${MAY_OR_MAY_NOT}`)
  })

  test("passes a cancellation on untouched", async () => {
    const controller = new AbortController()
    const { tool } = rollbackFor(
      historyRoute(HISTORY),
      deployRoute(() => {
        controller.abort()
        return ok(null)
      }),
    )

    const error = await rejection(invoke(tool, ARGS, { ...CTX, signal: controller.signal }))

    expect(isAbortError(error)).toBe(true)
    expect(isToolError(error)).toBe(false)
  })
})
