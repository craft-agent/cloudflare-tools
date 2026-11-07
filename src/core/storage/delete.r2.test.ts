import { describe, expect, test } from "bun:test"
import { tokenStatus, toolError, VERIFY_USER_PATH } from "../cloudflare/client.fixtures"
import { fail, ok } from "../cloudflare/testing"
import { invoke } from "../tool"
import { BUCKET_NAME, BUCKET_PATH, CTX, DELETE_ARGS, OBJECTS_PATH, calls, deleteFor, sent } from "./write.fixtures"

describe("cloudflareStorageDelete: an R2 bucket", () => {
  test("lists one object, with no delimiter and no prefix, to prove it empty", async () => {
    const { tool, requests } = deleteFor()

    await invoke(tool, DELETE_ARGS.r2, CTX)

    const listing = requests.find((request) => request.path === OBJECTS_PATH)!
    expect(Object.fromEntries(listing.query)).toEqual({ per_page: "1" })
  })

  test("is empty only when the listing is an empty array, whatever else the reply says", async () => {
    const { tool } = deleteFor({
      method: "GET",
      path: OBJECTS_PATH,
      reply: ok([], { is_truncated: true, cursor: "more", delimited: ["folder/"] }),
    })

    const result = await invoke(tool, DELETE_ARGS.r2, CTX)

    expect(result.deleted.id).toBe(BUCKET_NAME)
  })

  test("a bucket holding an object is refused with what it holds, and nothing is deleted", async () => {
    const { tool, requests } = deleteFor({
      method: "GET",
      path: OBJECTS_PATH,
      reply: ok([{ key: "a.txt", size: 1 }], { is_truncated: false }),
    })

    const error = await toolError(invoke(tool, DELETE_ARGS.r2, CTX))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toBe(
      `R2 bucket ${BUCKET_NAME} still holds objects: only an empty bucket is deleted here; empty it first.`,
    )
    expect(calls(requests)).toEqual([`GET ${BUCKET_PATH}`, `GET ${OBJECTS_PATH}`])
  })

  test("never asks the person about a bucket that is not empty", async () => {
    const { tool } = deleteFor({ method: "GET", path: OBJECTS_PATH, reply: ok([{ key: "a.txt" }]) })
    let asked = 0

    await toolError(
      invoke(tool, DELETE_ARGS.r2, {
        ...CTX,
        confirm: async () => (asked++, true),
      }),
    )

    expect(asked).toBe(0)
  })

  test.each([ok(null), ok({}), ok("x")])("refuses a listing that is not an array", async (reply) => {
    const { tool, requests } = deleteFor({ method: "GET", path: OBJECTS_PATH, reply })

    expect((await toolError(invoke(tool, DELETE_ARGS.r2, CTX))).code).toBe("upstream_error")
    expect(sent(requests, "DELETE")).toHaveLength(0)
  })

  test("a failed listing is thrown as it is, with no write note", async () => {
    const { tool, requests } = deleteFor({
      method: "GET",
      path: OBJECTS_PATH,
      reply: fail(500, [{ code: 1000, message: "Boom" }]),
    })

    const error = await toolError(invoke(tool, DELETE_ARGS.r2, CTX))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe("Cloudflare answered HTTP 500: 1000: Boom")
    expect(sent(requests, "DELETE")).toHaveLength(0)
  })

  test("a forbidden listing names the Edit permission", async () => {
    const { tool } = deleteFor(
      { method: "GET", path: VERIFY_USER_PATH, reply: tokenStatus("active") },
      { method: "GET", path: OBJECTS_PATH, reply: fail(403, [{ code: 10000, message: "Denied" }]) },
    )

    const error = await toolError(invoke(tool, DELETE_ARGS.r2, CTX))

    expect(error.code).toBe("forbidden")
    expect(error.message).toEndWith("The token needs Account → Workers R2 Storage → Edit.")
  })
})
