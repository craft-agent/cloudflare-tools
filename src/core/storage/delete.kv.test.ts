import { describe, expect, test } from "bun:test"
import { tokenStatus, toolError, VERIFY_USER_PATH } from "../cloudflare/client.fixtures"
import { fail, ok, type FakeRequest, type FakeReply } from "../cloudflare/testing"
import { invoke } from "../tool"
import {
  CTX,
  DELETE_ARGS,
  KEYS_PATH,
  NAMESPACE_ID,
  NAMESPACE_PATH,
  NAMESPACE_TITLE,
  deleteFor,
  sent,
} from "./write.fixtures"

const MAX_PAGES = 20

/** A key listing of `pages` pages: page n is reached by the cursor `c<n-1>`, holds nothing unless `keyOn` is n, and points on until the last. */
function listing(pages: number, keyOn?: number) {
  return (request: FakeRequest): FakeReply => {
    const page = Number(request.query.get("cursor")?.slice(1) ?? 0) + 1
    const keys = page === keyOn ? [{ name: "a" }] : []
    return ok(keys, { cursor: page < pages ? `c${page}` : "" })
  }
}

function keyRequests(requests: FakeRequest[]): FakeRequest[] {
  return requests.filter((request) => request.path === KEYS_PATH)
}

describe("cloudflareStorageDelete: a KV namespace", () => {
  test("lists a page of 1000 keys, with no prefix, to prove it empty", async () => {
    const { tool, requests } = deleteFor()

    await invoke(tool, DELETE_ARGS.kv, CTX)

    expect(keyRequests(requests)).toHaveLength(1)
    expect(Object.fromEntries(keyRequests(requests)[0]!.query)).toEqual({ limit: "1000" })
  })

  test("follows the cursor of each empty page and deletes after the last", async () => {
    const { tool, requests } = deleteFor({ method: "GET", path: KEYS_PATH, reply: listing(3) })

    const result = await invoke(tool, DELETE_ARGS.kv, CTX)

    expect(result.deleted.id).toBe(NAMESPACE_ID)
    expect(keyRequests(requests).map((request) => Object.fromEntries(request.query))).toEqual([
      { limit: "1000" },
      { limit: "1000", cursor: "c1" },
      { limit: "1000", cursor: "c2" },
    ])
    expect(sent(requests, "DELETE")).toHaveLength(1)
  })

  test("stops at the first key of the first page", async () => {
    const { tool, requests } = deleteFor({
      method: "GET",
      path: KEYS_PATH,
      reply: ok([{ name: "a" }], { cursor: "c1" }),
    })

    const error = await toolError(invoke(tool, DELETE_ARGS.kv, CTX))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toBe(
      `KV namespace ${NAMESPACE_TITLE} (${NAMESPACE_ID}) still holds keys: only an empty namespace is deleted here; empty it first.`,
    )
    expect(keyRequests(requests)).toHaveLength(1)
    expect(sent(requests, "DELETE")).toHaveLength(0)
  })

  test("stops at the first key of a later page, reading no further", async () => {
    const { tool, requests } = deleteFor({ method: "GET", path: KEYS_PATH, reply: listing(10, 3) })

    const error = await toolError(invoke(tool, DELETE_ARGS.kv, CTX))

    expect(error.message).toContain("still holds keys")
    expect(keyRequests(requests)).toHaveLength(3)
    expect(sent(requests, "DELETE")).toHaveLength(0)
  })

  test("proves a namespace empty whose twentieth page is the last", async () => {
    const { tool, requests } = deleteFor({ method: "GET", path: KEYS_PATH, reply: listing(MAX_PAGES) })

    await invoke(tool, DELETE_ARGS.kv, CTX)

    expect(keyRequests(requests)).toHaveLength(MAX_PAGES)
    expect(sent(requests, "DELETE")).toHaveLength(1)
  })

  test("refuses, as not proven empty, a listing that still goes on after twenty empty pages", async () => {
    const { tool, requests } = deleteFor({ method: "GET", path: KEYS_PATH, reply: listing(MAX_PAGES + 1) })

    const error = await toolError(invoke(tool, DELETE_ARGS.kv, CTX))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toBe(
      `KV namespace ${NAMESPACE_TITLE} (${NAMESPACE_ID}): its key listing goes on past 20 pages without a key, so it is not proven empty; nothing was deleted.`,
    )
    expect(keyRequests(requests)).toHaveLength(MAX_PAGES)
    expect(sent(requests, "DELETE")).toHaveLength(0)
  })

  test("a key on the twentieth page still counts as a key", async () => {
    const { tool } = deleteFor({ method: "GET", path: KEYS_PATH, reply: listing(MAX_PAGES + 1, MAX_PAGES) })

    expect((await toolError(invoke(tool, DELETE_ARGS.kv, CTX))).message).toContain("still holds keys")
  })

  test("a namespace without a title is named by its id", async () => {
    const { tool } = deleteFor(
      { method: "GET", path: NAMESPACE_PATH, reply: ok({ id: NAMESPACE_ID }) },
      { method: "GET", path: KEYS_PATH, reply: ok([{ name: "a" }]) },
    )

    expect((await toolError(invoke(tool, DELETE_ARGS.kv, CTX))).message).toStartWith(
      `KV namespace ${NAMESPACE_ID} (${NAMESPACE_ID}) still holds keys`,
    )
  })

  test.each([ok(null), ok({}), ok("x")])("refuses a listing that is not an array", async (reply) => {
    const { tool, requests } = deleteFor({ method: "GET", path: KEYS_PATH, reply })

    expect((await toolError(invoke(tool, DELETE_ARGS.kv, CTX))).code).toBe("upstream_error")
    expect(sent(requests, "DELETE")).toHaveLength(0)
  })

  test("a failed page is thrown as it is, with no write note", async () => {
    const { tool, requests } = deleteFor({
      method: "GET",
      path: KEYS_PATH,
      reply: fail(500, [{ code: 1000, message: "Boom" }]),
    })

    const error = await toolError(invoke(tool, DELETE_ARGS.kv, CTX))

    expect(error.message).toBe("Cloudflare answered HTTP 500: 1000: Boom")
    expect(sent(requests, "DELETE")).toHaveLength(0)
  })

  test("a forbidden listing names the Edit permission", async () => {
    const { tool } = deleteFor(
      { method: "GET", path: VERIFY_USER_PATH, reply: tokenStatus("active") },
      { method: "GET", path: KEYS_PATH, reply: fail(403, [{ code: 10000, message: "Denied" }]) },
    )

    const error = await toolError(invoke(tool, DELETE_ARGS.kv, CTX))

    expect(error.code).toBe("forbidden")
    expect(error.message).toEndWith("The token needs Account → Workers KV Storage → Edit.")
  })

  test("proves it empty again after the person answers, and refuses a key written meanwhile", async () => {
    let listings = 0
    const { tool, requests } = deleteFor({
      method: "GET",
      path: KEYS_PATH,
      reply: () => (++listings === 1 ? ok([], { cursor: "" }) : ok([{ name: "a" }], { cursor: "" })),
    })

    const error = await toolError(invoke(tool, DELETE_ARGS.kv, { ...CTX, confirm: async () => true }))

    expect(error.code).toBe("invalid_argument")
    expect(keyRequests(requests)).toHaveLength(2)
    expect(sent(requests, "DELETE")).toHaveLength(0)
  })

  test("proves it empty once when the harness, not the tool, asks", async () => {
    const { tool, requests } = deleteFor()

    await invoke(tool, DELETE_ARGS.kv, CTX)

    expect(keyRequests(requests)).toHaveLength(1)
  })
})
