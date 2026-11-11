import { expect, test } from "bun:test"
import { rejection } from "../cloudflare/client.fixtures"
import { fail, ok } from "../cloudflare/testing"
import { invoke } from "../tool"
import {
  CTX,
  INDEX,
  INDEX_NAME,
  INDEX_PATH,
  INDEXES_PATH,
  INFO_PATH,
  METADATA_PATH,
  errorOf,
  toolFor,
} from "./fixtures"

test("forbidden reads carry the permission hint on every request path", async () => {
  const forbidden = fail(403, [{ code: 10000, message: "Authentication error" }])
  for (const path of [INDEXES_PATH, INDEX_PATH, INFO_PATH, METADATA_PATH]) {
    const { tool } = toolFor(
      { method: "GET", path: INDEXES_PATH, reply: forbidden },
      { method: "GET", path: INDEX_PATH, reply: path === INDEX_PATH ? forbidden : ok(INDEX) },
      { method: "GET", path: INFO_PATH, reply: path === INFO_PATH ? forbidden : ok({}) },
      { method: "GET", path: METADATA_PATH, reply: path === METADATA_PATH ? forbidden : ok({ metadataIndexes: [] }) },
    )
    const args = path === INDEXES_PATH ? { method: "list" } : { method: "view", index: INDEX_NAME }
    const error = errorOf(await rejection(invoke(tool, args, CTX)))
    expect(error.code).toBe("forbidden")
    expect(error.message).toContain("Authentication error. The token needs Account → Vectorize → Read.")
  }
})

test("unexpected list, index, info and metadata shapes are upstream errors", async () => {
  for (const raw of [null, {}, "bad", 1]) {
    const { tool } = toolFor({ method: "GET", path: INDEXES_PATH, reply: ok(raw) })
    expect(errorOf(await rejection(invoke(tool, { method: "list" }, CTX))).code).toBe("upstream_error")
  }
  for (const [path, invalid] of [
    [INDEX_PATH, [null, [], "bad", {}, { name: 1 }]],
    [INFO_PATH, [null, [], "bad", 1]],
    [METADATA_PATH, [null, [], "bad", {}, { metadataIndexes: {} }]],
  ] as const) {
    for (const raw of invalid) {
      const { tool } = toolFor(
        { method: "GET", path: INDEX_PATH, reply: ok(path === INDEX_PATH ? raw : INDEX) },
        { method: "GET", path: INFO_PATH, reply: ok(path === INFO_PATH ? raw : {}) },
        { method: "GET", path: METADATA_PATH, reply: ok(path === METADATA_PATH ? raw : { metadataIndexes: [] }) },
      )
      expect(errorOf(await rejection(invoke(tool, { method: "view", index: INDEX_NAME }, CTX))).code).toBe(
        "upstream_error",
      )
    }
  }
})

test("view propagates not-found and other failures from each GET without partial results", async () => {
  for (const path of [INDEX_PATH, INFO_PATH, METADATA_PATH]) {
    for (const [status, code] of [
      [404, "not_found"],
      [429, "rate_limited"],
      [500, "upstream_error"],
    ] as const) {
      const failure = fail(status, [{ code: 10000, message: "Request failed" }])
      const { tool } = toolFor(
        { method: "GET", path: INDEX_PATH, reply: path === INDEX_PATH ? failure : ok(INDEX) },
        { method: "GET", path: INFO_PATH, reply: path === INFO_PATH ? failure : ok({}) },
        { method: "GET", path: METADATA_PATH, reply: path === METADATA_PATH ? failure : ok({ metadataIndexes: [] }) },
      )
      expect(errorOf(await rejection(invoke(tool, { method: "view", index: INDEX_NAME }, CTX))).code).toBe(code)
    }
  }
})
