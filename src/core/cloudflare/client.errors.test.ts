import { describe, expect, test } from "bun:test"
import { AUDIT_PATH, OTHER_TOKEN, USER_TOKEN, clientFor, toolError } from "./client.fixtures"
import { MASK } from "./mask"
import { ROUTES } from "./routes"
import { fail, type FakeReply } from "./testing"

async function failureOf(reply: FakeReply) {
  const { client } = clientFor([{ method: "GET", path: AUDIT_PATH, reply }])
  return toolError(client.request(ROUTES.auditLogs))
}

describe("CloudflareClient failures", () => {
  test("400 is invalid_argument with Cloudflare's errors joined", async () => {
    const error = await failureOf(
      fail(400, [
        { code: 1001, message: "bad page" },
        { code: 1002, message: "bad sort" },
      ]),
    )

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toBe("1001: bad page; 1002: bad sort")
  })

  test("404 is not_found", async () => {
    const error = await failureOf(fail(404, [{ code: 7003, message: "No route for that URI" }]))

    expect(error.code).toBe("not_found")
    expect(error.message).toBe("7003: No route for that URI")
  })

  test("a route the fake does not know answers not_found", async () => {
    const { client, requests } = clientFor([])
    const error = await toolError(client.request(ROUTES.auditLogs))

    expect(error.code).toBe("not_found")
    expect(requests).toHaveLength(1)
  })

  test("429 is rate_limited and says when to retry", async () => {
    const error = await failureOf(fail(429, [{ code: 971, message: "slow down" }], { "Retry-After": "17" }))

    expect(error.code).toBe("rate_limited")
    expect(error.message).toContain("971: slow down")
    expect(error.message).toContain("retry after 17 s")
  })

  test("429 without Retry-After has no retry hint", async () => {
    const error = await failureOf(fail(429, [{ code: 971, message: "slow down" }]))

    expect(error.code).toBe("rate_limited")
    expect(error.message).toBe("971: slow down")
  })

  test("5xx is upstream_error with the status and message", async () => {
    const error = await failureOf(fail(503, [{ code: 9000, message: "unavailable" }]))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toContain("503")
    expect(error.message).toContain("9000: unavailable")
  })

  test("another 4xx is upstream_error", async () => {
    const error = await failureOf(fail(409, [{ code: 1, message: "conflict" }]))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toContain("409")
  })

  test("a failure without errors uses the HTTP status text", async () => {
    const error = await failureOf({ status: 500, body: { success: false, errors: [] } })

    expect(error.code).toBe("upstream_error")
    expect(error.message).toContain("HTTP 500")
  })

  test("success false on a 200 is upstream_error", async () => {
    const error = await failureOf({
      status: 200,
      body: { success: false, errors: [{ code: 5, message: "nope" }], result: null },
    })

    expect(error.code).toBe("upstream_error")
    expect(error.message).toContain("200")
    expect(error.message).toContain("5: nope")
  })

  test("a body that is not JSON is upstream_error naming the status", async () => {
    const error = await failureOf({ status: 502, body: "<html>Bad gateway</html>" })

    expect(error.code).toBe("upstream_error")
    expect(error.message).toContain("502")
  })

  test("a 200 with a body that is not JSON is upstream_error", async () => {
    const error = await failureOf({ status: 200, body: "plain text" })

    expect(error.code).toBe("upstream_error")
    expect(error.message).toContain("200")
  })

  test("a JSON body that is not an object is upstream_error", async () => {
    const error = await failureOf({ status: 200, body: [1, 2] })

    expect(error.code).toBe("upstream_error")
  })

  test("a redirect is upstream_error and is not followed", async () => {
    const { client, requests } = clientFor([
      { method: "GET", path: AUDIT_PATH, reply: { status: 302, headers: { Location: "https://evil.example/x" } } },
    ])
    const error = await toolError(client.request(ROUTES.auditLogs))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toContain("redirect")
    expect(requests).toHaveLength(1)
  })

  test("a token echoed in an error message is masked", async () => {
    const error = await failureOf(fail(400, [{ code: 1, message: `bad token ${USER_TOKEN}, Bearer ${OTHER_TOKEN}` }]))

    expect(error.message).toBe(`1: bad token ${MASK}, Bearer ${MASK}`)
    expect(error.message).not.toContain(USER_TOKEN)
  })

  test("a token echoed in an upstream_error message is masked", async () => {
    const error = await failureOf(fail(500, [{ code: 2, message: `oops ${USER_TOKEN}` }]))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toContain(`oops ${MASK}`)
    expect(error.message).not.toContain(USER_TOKEN)
  })
})
