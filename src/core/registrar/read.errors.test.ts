import { expect, test } from "bun:test"
import { rejection } from "../cloudflare/client.fixtures"
import { fail, ok } from "../cloudflare/testing"
import { invoke } from "../tool"
import { CTX, DOMAIN_NAME, errorOf, REGISTRATION_PATH, REGISTRATIONS_PATH, toolFor } from "./fixtures"

test("forbidden reads carry the permission hint on every request path", async () => {
  for (const [args, path] of [
    [{ method: "list" }, REGISTRATIONS_PATH],
    [{ method: "view", domain: DOMAIN_NAME }, REGISTRATION_PATH],
  ] as const) {
    const { tool } = toolFor({
      method: "GET",
      path,
      reply: fail(403, [{ code: 10000, message: "Authentication error" }]),
    })
    const error = errorOf(await rejection(invoke(tool, args, CTX)))
    expect(error.code).toBe("forbidden")
    expect(error.message).toContain("Authentication error. The token needs Account → Registrar Domains → Read.")
  }
})

test("invalid pagination cursors get actionable guidance regardless of HTTP error mapping", async () => {
  for (const status of [400, 403, 500]) {
    const { tool } = toolFor({
      method: "GET",
      path: REGISTRATIONS_PATH,
      reply: fail(status, [{ code: 10000, message: "Invalid pagination cursor" }]),
    })
    const error = errorOf(await rejection(invoke(tool, { method: "list", cursor: "invalid" }, CTX)))
    expect(error.code).toBe("invalid_argument")
    expect(error.message).toBe("The cursor is not one this list gave; start again without it.")
  }
})

test("other errors sharing code 10000 are not mistaken for cursor errors", async () => {
  const { tool } = toolFor({
    method: "GET",
    path: REGISTRATIONS_PATH,
    reply: fail(400, [{ code: 10000, message: "Another error" }]),
  })
  const error = errorOf(await rejection(invoke(tool, { method: "list", cursor: "previous" }, CTX)))
  expect(error.code).toBe("invalid_argument")
  expect(error.message).toBe("10000: Another error")
})

test("unexpected list and registration shapes are upstream errors", async () => {
  for (const raw of [null, {}, "bad", 1]) {
    const { tool } = toolFor({ method: "GET", path: REGISTRATIONS_PATH, reply: ok(raw) })
    const error = errorOf(await rejection(invoke(tool, { method: "list" }, CTX)))
    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe("Cloudflare returned an unexpected registrations response.")
  }
  for (const raw of [null, [], "bad", {}, { name: DOMAIN_NAME }, { domain_name: 1 }]) {
    const { tool } = toolFor({ method: "GET", path: REGISTRATION_PATH, reply: ok(raw) })
    const error = errorOf(await rejection(invoke(tool, { method: "view", domain: DOMAIN_NAME }, CTX)))
    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe("Cloudflare returned an unexpected registration response.")
  }
})
