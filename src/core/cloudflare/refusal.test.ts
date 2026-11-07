import { describe, expect, test } from "bun:test"
import { ToolError, type ErrorCode } from "../errors"
import { refusedByCloudflare } from "./refusal"

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
