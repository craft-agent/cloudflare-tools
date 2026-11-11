import { expect, test } from "bun:test"
import { rejection } from "../cloudflare/client.fixtures"
import { fail, ok } from "../cloudflare/testing"
import { invoke } from "../tool"
import { CTX, errorOf, SITEKEY, toolFor, WIDGET_PATH, WIDGETS_PATH } from "./fixtures"

test("forbidden reads carry a sentence and the permission hint on every request path", async () => {
  const forbidden = fail(403, [{ code: 10000, message: "Authentication error" }])
  for (const [args, path] of [
    [{ method: "list" }, WIDGETS_PATH],
    [{ method: "view", sitekey: SITEKEY }, WIDGET_PATH],
  ] as const) {
    const { tool } = toolFor({ method: "GET", path, reply: forbidden })
    const error = errorOf(await rejection(invoke(tool, args, CTX)))
    expect(error.code).toBe("forbidden")
    expect(error.message).toContain("Authentication error. The token needs Account → Turnstile Sites → Read.")
  }
})

test("unexpected list and widget shapes are upstream errors", async () => {
  for (const raw of [null, {}, "bad", 1]) {
    const { tool } = toolFor({ method: "GET", path: WIDGETS_PATH, reply: ok(raw) })
    const error = errorOf(await rejection(invoke(tool, { method: "list" }, CTX)))
    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe("Cloudflare returned an unexpected widgets response.")
  }
  for (const raw of [null, [], "bad", {}, { name: "app" }, { sitekey: 1 }]) {
    const { tool } = toolFor({ method: "GET", path: WIDGET_PATH, reply: ok(raw) })
    const error = errorOf(await rejection(invoke(tool, { method: "view", sitekey: SITEKEY }, CTX)))
    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe("Cloudflare returned an unexpected widget response.")
  }
})
