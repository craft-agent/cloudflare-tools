import { describe, expect, test } from "bun:test"
import { clientFor, rejection, toolError, VERIFY_USER_PATH, ZONE_ID } from "../cloudflare/client.fixtures"
import { fail, ok, type FakeReply } from "../cloudflare/testing"
import { isAbortError } from "../errors"
import { sendBatch } from "./batch"
import { A_RECORD, A_RECORD_ID, MX_RECORD, SHAPED_A_RECORD } from "./fixtures"

const BATCH_PATH = `/zones/${ZONE_ID}/dns_records/batch`
const POST = { type: "A", name: "www.example.com", content: "192.0.2.1", ttl: 1 }

function batchClient(reply: FakeReply) {
  return clientFor([{ method: "POST", path: BATCH_PATH, reply }])
}

describe("sendBatch: request", () => {
  test("sends one POST holding only the non-empty lists", async () => {
    const { client, requests } = batchClient(ok({}))

    await sendBatch(client, ZONE_ID, { deletes: [], patches: undefined, posts: [POST] })

    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ method: "POST", path: BATCH_PATH, body: { posts: [POST] } })
    expect(Object.keys(requests[0]!.body as object)).toEqual(["posts"])
  })

  test("names the three lists deletes, patches and posts", async () => {
    const { client, requests } = batchClient(ok({}))
    const ops = { deletes: [{ id: A_RECORD_ID }], patches: [{ id: A_RECORD_ID, ttl: 300 }], posts: [POST] }

    await sendBatch(client, ZONE_ID, ops)

    expect(requests[0]!.body).toEqual(ops)
  })
})

describe("sendBatch: result", () => {
  test("shapes the records of each list and ignores puts", async () => {
    const { client } = batchClient(
      ok({ deletes: [{ id: A_RECORD_ID }], patches: [MX_RECORD], posts: [A_RECORD], puts: [A_RECORD] }),
    )

    const result = await sendBatch(client, ZONE_ID, { posts: [POST] })

    expect(Object.keys(result)).toEqual(["deletes", "patches", "posts"])
    expect(result.posts).toEqual([SHAPED_A_RECORD])
    expect(result.patches[0]).toMatchObject({ id: MX_RECORD.id, type: "MX", priority: 10 })
    expect(result.deletes).toEqual([expect.objectContaining({ id: A_RECORD_ID, type: "" })])
  })

  test("returns an empty list for an array Cloudflare leaves out", async () => {
    const { client } = batchClient(ok({ posts: [A_RECORD] }))

    expect(await sendBatch(client, ZONE_ID, { posts: [POST] })).toEqual({
      deletes: [],
      patches: [],
      posts: [SHAPED_A_RECORD],
    })
  })

  test("refuses a result that is not an object as upstream_error that may have been applied", async () => {
    for (const result of [null, [A_RECORD], "done"]) {
      const { client } = batchClient(ok(result))

      const error = await toolError(sendBatch(client, ZONE_ID, { posts: [POST] }))

      expect(error.code).toBe("upstream_error")
      expect(error.message).toContain("may or may not have applied the whole batch")
    }
  })
})

describe("sendBatch: failures", () => {
  test.each([
    [400, "invalid_argument"],
    [404, "not_found"],
    [429, "rate_limited"],
  ] as const)("a %d means nothing was applied and says so as %s", async (status, code) => {
    const { client } = batchClient(fail(status, [{ code: 1004, message: "DNS Validation Error" }]))

    const error = await toolError(sendBatch(client, ZONE_ID, { posts: [POST] }))

    expect(error.code).toBe(code)
    expect(error.message).toContain("DNS Validation Error")
    expect(error.message).toEndWith(" Nothing was changed.")
  })

  test("a rejected token means nothing was applied", async () => {
    const { client } = clientFor([
      { method: "POST", path: BATCH_PATH, reply: fail(401, [{ code: 9109, message: "Invalid access token" }]) },
      { method: "GET", path: VERIFY_USER_PATH, reply: fail(401, [{ code: 1000, message: "Invalid" }]) },
    ])

    const error = await toolError(sendBatch(client, ZONE_ID, { posts: [POST] }))

    expect(error.code).toBe("unauthenticated")
    expect(error.message).toEndWith(" Nothing was changed.")
  })

  test("a 500 does not tell, so the caller is sent to read the records first", async () => {
    const { client } = batchClient(fail(500, [{ code: 1000, message: "Internal error" }]))

    const error = await toolError(sendBatch(client, ZONE_ID, { posts: [POST] }))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toContain("Internal error")
    expect(error.message).toEndWith(
      " Cloudflare may or may not have applied the whole batch; read the records with cloudflare_dns_read before sending it again.",
    )
    expect(error.message).not.toContain("Nothing was changed.")
  })

  test("a network failure does not tell either", async () => {
    const { client } = clientFor([], {
      fetch: async () => {
        throw new Error("socket hang up")
      },
    })

    const error = await toolError(sendBatch(client, ZONE_ID, { posts: [POST] }))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toContain("socket hang up")
    expect(error.message).toContain("may or may not have applied")
  })

  test("a cancellation is passed on untouched", async () => {
    const controller = new AbortController()
    controller.abort()
    const { client } = clientFor([{ method: "POST", path: BATCH_PATH, reply: ok({}) }], { signal: controller.signal })

    const error = await rejection(sendBatch(client, ZONE_ID, { posts: [POST] }))

    expect(isAbortError(error)).toBe(true)
  })
})
