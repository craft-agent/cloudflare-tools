import { describe, expect, test } from "bun:test"
import { ToolError, type ErrorCode } from "../errors"
import { failureOfWrite, refusedByCloudflare } from "./refusal"

describe("failureOfWrite", () => {
  const notes = { nothing: "Nothing changed.", maybe: "It may have changed." }

  test.each([
    ["invalid_argument", "Bad input"],
    ["upstream_error", "Cloudflare answered HTTP 409: 10003: Conflict"],
  ] as const)("a refusal (%p) gains the nothing note and keeps its code and cause", (code, message) => {
    const error = new ToolError(code, message)
    const failure = failureOfWrite(error, notes) as ToolError
    expect(failure).toBeInstanceOf(ToolError)
    expect(failure.code).toBe(code)
    expect(failure.message).toBe(`${message}. Nothing changed.`)
    expect(failure.cause).toBe(error)
  })

  test("a failure that does not tell gains the maybe note", () => {
    const error = new ToolError("upstream_error", "Cloudflare answered HTTP 500: 1000: Down")
    const failure = failureOfWrite(error, notes) as ToolError
    expect(failure.code).toBe("upstream_error")
    expect(failure.message).toBe("Cloudflare answered HTTP 500: 1000: Down. It may have changed.")
    expect(failure.cause).toBe(error)
  })

  test.each([
    ["Content is invalid", "Content is invalid. "],
    ["Content is invalid.", "Content is invalid. "],
    ["Is it invalid?", "Is it invalid? "],
    ["Invalid!", "Invalid! "],
  ])(
    "ends the message %p as a sentence before either note, adding a period only when it has none",
    (message, start) => {
      const refused = failureOfWrite(new ToolError("not_found", message), notes) as ToolError
      const unknown = failureOfWrite(new ToolError("upstream_error", message), notes) as ToolError

      expect(refused.message).toBe(`${start}Nothing changed.`)
      expect(unknown.message).toBe(`${start}It may have changed.`)
    },
  )

  test("another code is returned as is", () => {
    const error = new ToolError("internal_error", "Broke")
    expect(failureOfWrite(error, notes)).toBe(error)
  })

  test("a cancellation and a plain error pass untouched", () => {
    const abort = new Error("aborted")
    abort.name = "AbortError"
    const plain = new Error("plain")
    expect(failureOfWrite(abort, notes)).toBe(abort)
    expect(failureOfWrite(plain, notes)).toBe(plain)
  })
})

describe("refusedByCloudflare", () => {
  test.each([
    "invalid_argument",
    "not_found",
    "forbidden",
    "unauthenticated",
    "rate_limited",
    "stale",
  ] as const satisfies ErrorCode[])("accepts %p", (code) => {
    expect(refusedByCloudflare(new ToolError(code, "Refused"))).toBe(true)
  })

  test.each(["declined", "internal_error"] as const satisfies ErrorCode[])("refuses to call %p a refusal", (code) => {
    expect(refusedByCloudflare(new ToolError(code, "Failed"))).toBe(false)
  })

  test("accepts an HTTP 4xx the client has no code for", () => {
    expect(refusedByCloudflare(new ToolError("upstream_error", "Cloudflare answered HTTP 409: 10003: Conflict"))).toBe(
      true,
    )
  })

  test.each([
    "Cloudflare answered HTTP 500: 1000: Down",
    "Cloudflare answered HTTP 4xx: odd",
    "Cloudflare could not be reached: connection reset",
    "Try again: Cloudflare answered HTTP 409: 10003: Conflict",
  ])("does not accept the upstream error %p", (message) => {
    expect(refusedByCloudflare(new ToolError("upstream_error", message))).toBe(false)
  })
})
