import { expect, test } from "bun:test"
import { rejection } from "../cloudflare/client.fixtures"
import { fail } from "../cloudflare/testing"
import { invoke } from "../tool"
import { CTX, PROJECT, PROJECT_PATH, errorOf, toolFor } from "./fixtures"
import { projectArg, projectName } from "./projects"

test("project names are trimmed but never lowercased", () => {
  for (const name of ["a", "0", PROJECT, "a-", "a".repeat(58)]) expect(projectName(` ${name}\n`)).toBe(name)
  for (const name of ["", " ", "My-project", "-a", "a_b", "a/b", "a.b", "a".repeat(59)]) {
    try {
      projectName(name)
      throw new Error("Expected refusal")
    } catch (error) {
      expect(errorOf(error).code).toBe("invalid_argument")
    }
  }
  expect(projectArg.description).toBe(
    "The Pages project's name, as `list` shows it: 1–58 lowercase letters, digits and `-`, starting with a letter or digit.",
  )
})

test("missing projects point at list; other errors retain their code", async () => {
  for (const [status, code] of [
    [404, "not_found"],
    [403, "forbidden"],
    [500, "upstream_error"],
  ] as const) {
    const { tool } = toolFor({
      method: "GET",
      path: PROJECT_PATH,
      reply: fail(status, [{ code: 7003, message: "Cannot read project" }]),
    })
    const error = errorOf(await rejection(invoke(tool, { method: "view", project: PROJECT }, CTX)))
    expect(error.code).toBe(code)
    if (status === 404)
      expect(error.message).toBe(
        `No Pages project ${PROJECT} in the account default; cloudflare_pages_read list shows its projects.`,
      )
  }
})
