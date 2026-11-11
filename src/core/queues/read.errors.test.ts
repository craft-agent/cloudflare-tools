import { expect, test } from "bun:test"
import { rejection } from "../cloudflare/client.fixtures"
import { fail, ok } from "../cloudflare/testing"
import { invoke } from "../tool"
import { CTX, QUEUE, QUEUE_ID, QUEUE_PATH, QUEUES_PATH, errorOf, toolFor } from "./fixtures"

test("forbidden reads carry a sentence and the permission hint on every request path", async () => {
  const forbidden = fail(403, [{ code: 10000, message: "Authentication error" }])
  for (const [args, routes] of [
    [{ method: "list" }, [{ method: "GET", path: QUEUES_PATH, reply: forbidden }]],
    [{ method: "view", queue: QUEUE_ID }, [{ method: "GET", path: QUEUE_PATH, reply: forbidden }]],
    [{ method: "view", queue: "mail-jobs" }, [{ method: "GET", path: QUEUES_PATH, reply: forbidden }]],
    [
      { method: "view", queue: "mail-jobs" },
      [
        { method: "GET", path: QUEUES_PATH, reply: ok([QUEUE]) },
        { method: "GET", path: QUEUE_PATH, reply: forbidden },
      ],
    ],
  ] as const) {
    const { tool } = toolFor(...routes)
    const error = errorOf(await rejection(invoke(tool, args, CTX)))
    expect(error.code).toBe("forbidden")
    expect(error.message).toContain("Authentication error. The token needs Account → Queues → Read.")
  }
})

test("unexpected list and queue shapes are upstream errors", async () => {
  for (const raw of [null, {}, "bad", 1]) {
    const { tool } = toolFor({ method: "GET", path: QUEUES_PATH, reply: ok(raw) })
    for (const args of [{ method: "list" }, { method: "view", queue: "mail-jobs" }]) {
      const error = errorOf(await rejection(invoke(tool, args, CTX)))
      expect(error.code).toBe("upstream_error")
      expect(error.message).toBe("Cloudflare returned an unexpected queues response.")
    }
  }
  for (const raw of [null, [], "bad", {}, { queue_id: QUEUE_ID }, { queue_id: 1, queue_name: "bad" }]) {
    const { tool } = toolFor({ method: "GET", path: QUEUE_PATH, reply: ok(raw) })
    const error = errorOf(await rejection(invoke(tool, { method: "view", queue: QUEUE_ID }, CTX)))
    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe("Cloudflare returned an unexpected queue response.")
  }
})
