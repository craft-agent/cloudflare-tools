import { describe, expect, test } from "bun:test"
import { isToolError } from "../errors"
import { MAX_TEXT_LENGTH, clipText } from "./shape"
import { scriptName } from "./scripts"

describe("scriptName", () => {
  test("accepts 1–63 lowercase letters, digits, - and _, and trims", () => {
    for (const name of ["a", "my-worker_2", "0", "_", "-", "a".repeat(63)]) expect(scriptName(name)).toBe(name)
    expect(scriptName("  my-worker \n")).toBe("my-worker")
  })

  test("refuses anything else as invalid_argument naming the form, and never lowercases", () => {
    for (const name of ["", "  ", "My-Worker", "a b", "a/b", "../x", "a.b", "é", "a".repeat(64)]) {
      try {
        scriptName(name)
        throw new Error(`Expected "${name}" to be refused`)
      } catch (error) {
        expect(isToolError(error) && error.code).toBe("invalid_argument")
        expect(isToolError(error) && error.message).toContain("1–63 lowercase letters, digits, `-` and `_`")
      }
    }
  })
})

describe("clipText", () => {
  test("keeps text up to 200 characters as it is", () => {
    expect(MAX_TEXT_LENGTH).toBe(200)
    expect(clipText("")).toBe("")
    expect(clipText("x".repeat(200))).toBe("x".repeat(200))
  })

  test("cuts longer text to 200 characters and ends it with …", () => {
    expect(clipText("x".repeat(201))).toBe(`${"x".repeat(200)}…`)
  })

  test("counts characters, so a surrogate pair is never cut in two", () => {
    expect(clipText("😀".repeat(200))).toBe("😀".repeat(200))
    expect(clipText("😀".repeat(201))).toBe(`${"😀".repeat(200)}…`)
  })
})
