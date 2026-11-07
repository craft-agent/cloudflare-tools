import { expect, test } from "bun:test"
import { ACCOUNT_ID, rejection, tokenStatus, VERIFY_USER_PATH } from "../cloudflare/client.fixtures"
import { ok } from "../cloudflare/testing"
import { invoke } from "../tool"
import { MAX_TEXT_LENGTH } from "../workers/shape"
import { CTX, errorOf, refusalOf, toolFor } from "./fixtures"

const NAMESPACE = "a".repeat(32)
const NAMESPACES_PATH = `/accounts/${ACCOUNT_ID}/storage/kv/namespaces`
const KEYS_PATH = `${NAMESPACES_PATH}/${NAMESPACE}/keys`
const LONG_NAME = "x".repeat(MAX_TEXT_LENGTH + 1)
const CLIPPED_NAME = `${"x".repeat(MAX_TEXT_LENGTH)}…`

test("namespaces: exact path, fixed page size, paging and shaped titles", async () => {
  const paging = { page: 2, per_page: 100, total_count: 101, total_pages: 2 }
  const { tool, requests } = toolFor({
    method: "GET",
    path: NAMESPACES_PATH,
    reply: ok([{ id: NAMESPACE, title: LONG_NAME }, { id: "other" }, { title: "dropped" }, null], paging),
  })
  expect(await invoke(tool, { method: "namespaces", page: 2 }, CTX)).toEqual({
    label: "default",
    namespaces: [
      { id: NAMESPACE, title: CLIPPED_NAME },
      { id: "other", title: null },
    ],
    ...paging,
  })
  expect(Object.fromEntries(requests[0]!.query)).toEqual({ page: "2", per_page: "100" })
  await invoke(tool, { method: "namespaces" }, CTX)
  expect(Object.fromEntries(requests[1]!.query)).toEqual({ page: "1", per_page: "100" })
})

test("keys: names and UTC expiration only, exact query and cursor paging", async () => {
  const { tool, requests } = toolFor({
    method: "GET",
    path: KEYS_PATH,
    reply: ok(
      [
        { name: LONG_NAME, expiration: 1704067200, metadata: { secret: "never returned" } },
        { name: "permanent" },
        { name: "epoch", expiration: 0 },
        { name: "invalid", expiration: "tomorrow" },
        { expiration: 1 },
        null,
      ],
      { cursor: "next" },
    ),
  })
  const result = await invoke(tool, { method: "keys", namespace: NAMESPACE, prefix: "dir/", cursor: "previous" }, CTX)
  expect(result).toEqual({
    label: "default",
    namespace: NAMESPACE,
    prefix: "dir/",
    keys: [
      { name: CLIPPED_NAME, expires: "2024-01-01T00:00:00.000Z" },
      { name: "permanent", expires: null },
      { name: "epoch", expires: "1970-01-01T00:00:00.000Z" },
      { name: "invalid", expires: null },
    ],
    cursor: "next",
  })
  expect(Object.fromEntries(requests[0]!.query)).toEqual({ limit: "100", prefix: "dir/", cursor: "previous" })
  expect(JSON.stringify(result)).not.toContain("metadata")
  await invoke(tool, { method: "keys", namespace: NAMESPACE }, CTX)
  expect(Object.fromEntries(requests[1]!.query)).toEqual({ limit: "100" })
})

test("keys: empty or absent cursors mean the last page; missing paging fields are null", async () => {
  for (const info of [{ cursor: "" }, undefined]) {
    const { tool } = toolFor({ method: "GET", path: KEYS_PATH, reply: ok([], info) })
    expect(await invoke(tool, { method: "keys", namespace: NAMESPACE }, CTX)).toEqual({
      label: "default",
      namespace: NAMESPACE,
      keys: [],
      cursor: null,
    })
  }
  const { tool } = toolFor({ method: "GET", path: NAMESPACES_PATH, reply: ok([]) })
  expect(await invoke(tool, { method: "namespaces" }, CTX)).toEqual({
    label: "default",
    namespaces: [],
    page: null,
    per_page: null,
    total_count: null,
    total_pages: null,
  })
})

test("KV: refuses invalid identifiers, missing and wrong-method arguments before requests", async () => {
  const { tool, requests } = toolFor()
  for (const namespace of ["", "A".repeat(32), "a".repeat(31), "a".repeat(33), "../keys"]) {
    expect(await refusalOf(invoke(tool, { method: "keys", namespace }, CTX))).toContain("namespace")
  }
  expect(await refusalOf(invoke(tool, { method: "keys" }, CTX))).toContain("requires `namespace`")
  expect(await refusalOf(invoke(tool, { method: "keys", namespace: NAMESPACE, page: 1 }, CTX))).toContain(
    "takes no `page`",
  )
  expect(await refusalOf(invoke(tool, { method: "namespaces", namespace: NAMESPACE }, CTX))).toContain(
    "takes no `namespace`",
  )
  expect(await refusalOf(invoke(tool, { method: "namespaces", cursor: "next" }, CTX))).toContain("takes no `cursor`")
  for (const page of [0, -1, 1.5]) {
    expect(await refusalOf(invoke(tool, { method: "namespaces", page }, CTX))).toContain("page")
  }
  expect(requests).toEqual([])
})

test("KV: unexpected listings fail and forbidden replies name the store permission", async () => {
  for (const [method, path] of [
    ["namespaces", NAMESPACES_PATH],
    ["keys", KEYS_PATH],
  ] as const) {
    const args = method === "keys" ? { method, namespace: NAMESPACE } : { method }
    for (const result of [null, {}, "wrong"]) {
      const { tool } = toolFor({ method: "GET", path, reply: ok(result) })
      expect(errorOf(await rejection(invoke(tool, args, CTX))).code).toBe("upstream_error")
    }
    const { tool } = toolFor(
      { method: "GET", path: VERIFY_USER_PATH, reply: tokenStatus("active") },
      { method: "GET", path, reply: { status: 403, body: { success: false, errors: [{ message: "Denied" }] } } },
    )
    const error = errorOf(await rejection(invoke(tool, args, CTX)))
    expect(error.code).toBe("forbidden")
    expect(error.message).toEndWith("The token needs Account → Workers KV Storage → Read.")
  }
})
