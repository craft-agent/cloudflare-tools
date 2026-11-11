import { expect, test } from "bun:test"
import { rejection } from "../cloudflare/client.fixtures"
import { fail, ok } from "../cloudflare/testing"
import { invoke } from "../tool"
import { CONFIG, CONFIG_ID, CONFIG_PATH, CONFIGS_PATH, CTX, errorOf, toolFor } from "./fixtures"

test("forbidden reads carry a sentence and the permission hint on every request path", async () => {
  const forbidden = fail(403, [{ code: 10000, message: "Authentication error" }])
  for (const [args, routes] of [
    [{ method: "list" }, [{ method: "GET", path: CONFIGS_PATH, reply: forbidden }]],
    [{ method: "view", config: CONFIG_ID }, [{ method: "GET", path: CONFIG_PATH, reply: forbidden }]],
    [{ method: "view", config: "app-db" }, [{ method: "GET", path: CONFIGS_PATH, reply: forbidden }]],
    [
      { method: "view", config: "app-db" },
      [
        { method: "GET", path: CONFIGS_PATH, reply: ok([CONFIG]) },
        { method: "GET", path: CONFIG_PATH, reply: forbidden },
      ],
    ],
  ] as const) {
    const { tool } = toolFor(...routes)
    const error = errorOf(await rejection(invoke(tool, args, CTX)))
    expect(error.code).toBe("forbidden")
    expect(error.message).toContain("Authentication error. The token needs Account → Hyperdrive → Read.")
  }
})

test("unexpected list and configuration shapes are upstream errors", async () => {
  for (const raw of [null, {}, "bad", 1]) {
    const { tool } = toolFor({ method: "GET", path: CONFIGS_PATH, reply: ok(raw) })
    for (const args of [{ method: "list" }, { method: "view", config: "app-db" }]) {
      const error = errorOf(await rejection(invoke(tool, args, CTX)))
      expect(error.code).toBe("upstream_error")
      expect(error.message).toBe("Cloudflare returned an unexpected configurations response.")
    }
  }
  for (const raw of [null, [], "bad", {}, { id: CONFIG_ID }, { id: 1, name: "bad" }]) {
    const { tool } = toolFor({ method: "GET", path: CONFIG_PATH, reply: ok(raw) })
    const error = errorOf(await rejection(invoke(tool, { method: "view", config: CONFIG_ID }, CTX)))
    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe("Cloudflare returned an unexpected configuration response.")
  }
})
