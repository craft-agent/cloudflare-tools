import { describe, expect, test } from "bun:test"
import { ToolError } from "../errors"
import { assertAcceptedKeys } from "./args"

const ACCEPTED_KEYS = { list: ["page"] }

describe("assertAcceptedKeys", () => {
  test("accepts keys allowed by the method", () => {
    expect(() => assertAcceptedKeys(ACCEPTED_KEYS, "list", { page: 2 })).not.toThrow()
  })

  test("skips method and undefined values", () => {
    expect(() => assertAcceptedKeys(ACCEPTED_KEYS, "list", { method: "list", zone: undefined })).not.toThrow()
  })

  test("refuses an unaccepted key with invalid_argument and the method's message", () => {
    expect(() => assertAcceptedKeys(ACCEPTED_KEYS, "list", { zone: "example.com" })).toThrow(
      new ToolError("invalid_argument", 'Method "list" takes no `zone`.'),
    )
    try {
      assertAcceptedKeys(ACCEPTED_KEYS, "list", { zone: "example.com" })
    } catch (error) {
      expect(error).toBeInstanceOf(ToolError)
      expect((error as ToolError).code).toBe("invalid_argument")
    }
  })
})
