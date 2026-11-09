import { describe, expect, test } from "bun:test"
import { rejection, toolError } from "../cloudflare/client.fixtures"
import { fail, ok, type FakeReply } from "../cloudflare/testing"
import { isAbortError, isToolError } from "../errors"
import { invoke } from "../tool"
import { ARGS, CTX, rollbackFor, rollbackRoute, sent } from "./rollback.fixtures"

const NOTHING_CHANGED = "Nothing changed."
const MAY_OR_MAY_NOT =
  "Cloudflare may or may not have switched it; read cloudflare_pages_read deployments before sending it again."

/** Rolls back with the POST answering `reply`; returns the error it failed with, having sent exactly one POST. */
async function failedWith(reply: FakeReply | (() => FakeReply)) {
  const { tool, requests } = rollbackFor(rollbackRoute(reply))
  const error = await toolError(invoke(tool, ARGS, CTX))
  expect(sent(requests, "POST")).toHaveLength(1)
  return error
}

describe("cloudflarePagesRollback: Cloudflare's refusal", () => {
  test("keeps the code of a 400 and says nothing changed", async () => {
    const error = await failedWith(fail(400, [{ code: 8000039, message: "Cannot rollback to the live deployment" }]))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toBe(`8000039: Cannot rollback to the live deployment. ${NOTHING_CHANGED}`)
    expect(isToolError(error.cause)).toBe(true)
  })

  test.each([
    [404, "not_found"],
    [403, "forbidden"],
    [429, "rate_limited"],
  ] as const)("keeps the code of a %p", async (status, code) => {
    const error = await failedWith(fail(status, [{ code: 10002, message: "Refused" }]))

    expect(error.code).toBe(code)
    expect(error.message).toEndWith(` ${NOTHING_CHANGED}`)
  })

  test("says nothing changed for a 4xx the client has no code for", async () => {
    const error = await failedWith(fail(409, [{ code: 10003, message: "Conflict" }]))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe(`Cloudflare answered HTTP 409: 10003: Conflict. ${NOTHING_CHANGED}`)
  })
})

describe("cloudflarePagesRollback: failures that do not tell", () => {
  test("says Cloudflare may or may not have switched it after a 500", async () => {
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
      rollbackRoute(() => {
        controller.abort()
        return ok(null)
      }),
    )

    const error = await rejection(invoke(tool, ARGS, { ...CTX, signal: controller.signal }))

    expect(isAbortError(error)).toBe(true)
    expect(isToolError(error)).toBe(false)
  })
})
