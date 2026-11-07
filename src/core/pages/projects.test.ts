import { expect, test } from "bun:test"
import { rejection } from "../cloudflare/client.fixtures"
import { fail } from "../cloudflare/testing"
import { invoke } from "../tool"
import { DEPLOYMENT_ID, CTX, PROJECT, PROJECT_PATH, errorOf, toolFor } from "./fixtures"
import { deploymentId, projectArg, projectName } from "./projects"

test("deployment ids are trimmed and lowercased; non-UUIDs are refused", () => {
  expect(deploymentId(` ${DEPLOYMENT_ID} \n`)).toBe(DEPLOYMENT_ID)
  expect(deploymentId("11111111-1111-4111-8111-AAAAAAAAAAAA")).toBe("11111111-1111-4111-8111-aaaaaaaaaaaa")
  for (const id of ["", "11111111", "not-a-uuid", "11111111-1111-4111-8111-11111111111g"]) {
    try {
      deploymentId(id)
      throw new Error("Expected refusal")
    } catch (error) {
      const err = errorOf(error)
      expect(err.code).toBe("invalid_argument")
      expect(err.message).toBe(
        "`deployment` must be a deployment's id (a UUID), as cloudflare_pages_read deployments shows it; not its short_id.",
      )
    }
  }
})

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
