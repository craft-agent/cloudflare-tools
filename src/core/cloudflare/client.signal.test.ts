import { describe, expect, test } from "bun:test"
import { ToolError, isAbortError } from "../errors"
import { cloudflareClient } from "./client"
import { ACCOUNT_ID, AUDIT_PATH, USER_TOKEN, clientFor, envFor, rejection, toolError } from "./client.fixtures"
import { MASK } from "./mask"
import { ROUTES } from "./routes"
import { fakeCloudflare, ok } from "./testing"

const NEVER = () => new Promise<never>(() => {})
const SHORT_TIMEOUT_MS = 20

describe("CloudflareClient time limit and cancellation", () => {
  test("a reply that never comes ends in upstream_error after the time limit", async () => {
    const { client } = clientFor([{ method: "GET", path: AUDIT_PATH, reply: NEVER }], { timeoutMs: SHORT_TIMEOUT_MS })
    const error = await toolError(client.request(ROUTES.auditLogs))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe("Cloudflare did not answer within 0.02 s")
  })

  test("the caller's abort rejects with an AbortError, not a ToolError", async () => {
    const controller = new AbortController()
    const { client } = clientFor([{ method: "GET", path: AUDIT_PATH, reply: NEVER }], { signal: controller.signal })
    const pending = rejection(client.request(ROUTES.auditLogs))
    controller.abort()
    const error = await pending

    expect(error).not.toBeInstanceOf(ToolError)
    expect(isAbortError(error)).toBe(true)
  })

  test("a signal that was aborted already rejects with an AbortError", async () => {
    const { client, requests } = clientFor([{ method: "GET", path: AUDIT_PATH, reply: ok(null) }], {
      signal: AbortSignal.abort(),
    })
    const error = await rejection(client.request(ROUTES.auditLogs))

    expect(isAbortError(error)).toBe(true)
    expect(requests.length).toBeLessThanOrEqual(1)
  })

  test("the caller's abort while the token is being verified is still an AbortError", async () => {
    const controller = new AbortController()
    const { client } = clientFor(
      [
        { method: "GET", path: AUDIT_PATH, reply: { status: 403, body: { success: false, errors: [] } } },
        {
          method: "GET",
          path: "/user/tokens/verify",
          reply: () => (controller.abort(), NEVER()),
        },
      ],
      { signal: controller.signal },
    )
    const error = await rejection(client.request(ROUTES.auditLogs))

    expect(isAbortError(error)).toBe(true)
    expect(error).not.toBeInstanceOf(ToolError)
  })

  test("a network failure is upstream_error with the error's message", async () => {
    const client = cloudflareClient(undefined, {
      env: envFor(),
      fetch: () => Promise.reject(new TypeError("connect ECONNREFUSED")),
    })
    const error = await toolError(client.request(ROUTES.auditLogs))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toContain("connect ECONNREFUSED")
  })

  test("a token inside a network error message is masked", async () => {
    const client = cloudflareClient(undefined, {
      env: envFor(),
      fetch: () => Promise.reject(new Error(`failed with Bearer ${USER_TOKEN}`)),
    })
    const error = await toolError(client.request(ROUTES.auditLogs))

    expect(error.message).toContain(MASK)
    expect(error.message).not.toContain(USER_TOKEN)
  })
})

describe("cloudflareClient", () => {
  test("resolves the default pair from the environment", async () => {
    const { fetch, requests } = fakeCloudflare([{ method: "GET", path: AUDIT_PATH, reply: ok([]) }])
    const client = cloudflareClient(undefined, { env: envFor(), fetch })
    await client.request(ROUTES.auditLogs)

    expect(client.label).toBe("default")
    expect(client.accountId).toBe(ACCOUNT_ID)
    expect(requests[0]!.headers.authorization).toBe(`Bearer ${USER_TOKEN}`)
  })

  test("a missing credential fails before any call", () => {
    expect(() => cloudflareClient(undefined, { env: {}, fetch: NEVER })).toThrow(ToolError)
  })
})
