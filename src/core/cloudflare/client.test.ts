import { describe, expect, test } from "bun:test"
import { ToolError } from "../errors"
import { cloudflareClient } from "./client"
import {
  ACCOUNT_ID,
  ACCOUNT_TOKEN,
  AUDIT_PATH,
  LEGACY_TOKEN,
  OTHER_TOKEN,
  USER_TOKEN,
  VERIFY_ACCOUNT_PATH,
  VERIFY_USER_PATH,
  ZONE_ID,
  clientFor,
  envFor,
  toolError,
  verifyRoute,
} from "./client.fixtures"
import { MASK } from "./mask"
import { ROUTES } from "./routes"
import { fakeCloudflare, ok } from "./testing"
import { BASE_URL } from "./url"

describe("CloudflareClient.request", () => {
  test("sends the method, URL, headers and body, and nothing else", async () => {
    const { client, requests } = clientFor([{ method: "GET", path: AUDIT_PATH, reply: ok([]) }])
    await client.request(ROUTES.auditLogs)

    expect(requests).toHaveLength(1)
    expect(requests[0]!.method).toBe("GET")
    expect(requests[0]!.path).toBe(AUDIT_PATH)
    expect(requests[0]!.headers).toEqual({ authorization: `Bearer ${USER_TOKEN}`, accept: "application/json" })
    expect(requests[0]!.body).toBeUndefined()
  })

  test("calls the base URL without following redirects and sends the body as JSON text", async () => {
    const calls: unknown[] = []
    const { fetch } = fakeCloudflare([{ method: "GET", path: AUDIT_PATH, reply: ok(null) }])
    const client = cloudflareClient(undefined, {
      env: envFor(),
      fetch: (url, init) => (calls.push({ url, redirect: init.redirect, body: init.body }), fetch(url, init)),
    })
    await client.request(ROUTES.auditLogs, { body: { name: "a" } })

    expect(calls).toEqual([{ url: `${BASE_URL}${AUDIT_PATH}`, redirect: "manual", body: '{"name":"a"}' }])
  })

  test("labels the body as JSON", async () => {
    const { client, requests } = clientFor([{ method: "GET", path: AUDIT_PATH, reply: ok(null) }])
    await client.request(ROUTES.auditLogs, { body: { name: "a" } })

    expect(requests[0]!.headers["content-type"]).toBe("application/json")
    expect(requests[0]!.body).toEqual({ name: "a" })
  })

  test("fills account_id from the credential", async () => {
    const { client, requests } = clientFor([{ method: "GET", path: `/accounts/${ACCOUNT_ID}`, reply: ok({ id: 1 }) }])
    await client.request(ROUTES.account)

    expect(requests[0]!.path).toBe(`/accounts/${ACCOUNT_ID}`)
    expect(client.accountId).toBe(ACCOUNT_ID)
    expect(client.label).toBe("default")
  })

  test("refuses an account_id from a caller", async () => {
    const { client, requests } = clientFor([])
    const error = await toolError(client.request(ROUTES.account, { path: { account_id: "1".repeat(32) } }))

    expect(error.code).toBe("internal_error")
    expect(requests).toEqual([])
  })

  test("refuses a path parameter the route does not use", async () => {
    const { client, requests } = clientFor([])
    const error = await toolError(client.request(ROUTES.account, { path: { zone_id: ZONE_ID } }))

    expect(error.code).toBe("internal_error")
    expect(requests).toEqual([])
  })

  test("refuses a route that is not in the allowlist", async () => {
    const { client, requests } = clientFor([])
    const error = await toolError(client.request({ method: "DELETE", path: "/accounts/{account_id}" }))

    expect(error.code).toBe("internal_error")
    expect(requests).toEqual([])
  })

  test("accepts a hand-made copy of a listed route", async () => {
    const { client } = clientFor([{ method: "GET", path: AUDIT_PATH, reply: ok("fine") }])
    const { result } = await client.request({ method: "GET", path: "/accounts/{account_id}/logs/audit" })

    expect(result).toBe("fine")
  })

  test("includes the query in the request URL", async () => {
    const { client, requests } = clientFor([{ method: "GET", path: AUDIT_PATH, reply: ok([]) }])
    await client.request(ROUTES.auditLogs, { query: { page: 2 } })

    expect(requests[0]!.query.get("page")).toBe("2")
  })

  test("returns the result and result_info", async () => {
    const info = { page: 1, per_page: 25, count: 1, total_count: 1, total_pages: 1 }
    const { client } = clientFor([{ method: "GET", path: AUDIT_PATH, reply: ok([{ id: "x" }], info) }])
    const reply = await client.request<Array<{ id: string }>>(ROUTES.auditLogs)

    expect(reply).toEqual({ result: [{ id: "x" }], resultInfo: info })
  })

  test("leaves resultInfo undefined when Cloudflare sent none", async () => {
    const { client } = clientFor([{ method: "GET", path: AUDIT_PATH, reply: ok({ id: "x" }) }])

    expect((await client.request(ROUTES.auditLogs)).resultInfo).toBeUndefined()
  })

  test("masks every string in the result and the result info", async () => {
    const echoed = {
      note: `token ${USER_TOKEN} and ${OTHER_TOKEN}`,
      list: [`Bearer ${LEGACY_TOKEN}`, 7, null, { deep: `x ${OTHER_TOKEN}` }],
      count: 3,
    }
    const { client } = clientFor([{ method: "GET", path: AUDIT_PATH, reply: ok(echoed, { cursor: USER_TOKEN }) }])
    const reply = await client.request<typeof echoed>(ROUTES.auditLogs)

    expect(reply.result).toEqual({
      note: `token ${MASK} and ${MASK}`,
      list: [`Bearer ${MASK}`, 7, null, { deep: `x ${MASK}` }],
      count: 3,
    })
    expect(reply.resultInfo).toEqual({ cursor: MASK })
    expect(JSON.stringify(reply)).not.toContain(USER_TOKEN)
  })

  test("masks a token of another label that the environment holds", async () => {
    const env = {
      ...envFor(),
      CLOUDFLARE_API_TOKEN_OTHER: LEGACY_TOKEN,
      CLOUDFLARE_ACCOUNT_ID_OTHER: ACCOUNT_ID,
    }
    const { fetch } = fakeCloudflare([{ method: "GET", path: AUDIT_PATH, reply: ok(`seen ${LEGACY_TOKEN}`) }])
    const client = cloudflareClient(undefined, { env, fetch })

    expect((await client.request(ROUTES.auditLogs)).result).toBe(`seen ${MASK}`)
  })
})

describe("CloudflareClient.verifyToken", () => {
  test("a user token uses the user verify endpoint", async () => {
    const { client, requests } = clientFor([verifyRoute(VERIFY_USER_PATH, "active")])

    expect(await client.verifyToken()).toEqual({ id: "token-id", status: "active", expires_on: null, not_before: null })
    expect(requests.map((r) => r.path)).toEqual([VERIFY_USER_PATH])
  })

  test("an account token uses the account verify endpoint", async () => {
    const { client, requests } = clientFor([verifyRoute(VERIFY_ACCOUNT_PATH, "active")], { token: ACCOUNT_TOKEN })

    expect((await client.verifyToken()).status).toBe("active")
    expect(requests.map((r) => r.path)).toEqual([VERIFY_ACCOUNT_PATH])
  })

  test("a legacy token tries the user endpoint and falls back to the account one on 401", async () => {
    const unauthorized = { code: 1000, message: "Invalid API Token" }
    const { client, requests } = clientFor(
      [
        {
          method: "GET",
          path: VERIFY_USER_PATH,
          reply: { status: 401, body: { success: false, errors: [unauthorized] } },
        },
        {
          method: "GET",
          path: VERIFY_ACCOUNT_PATH,
          reply: ok({
            id: "t",
            status: "active",
            expires_on: "2030-01-01T00:00:00Z",
            not_before: "2020-01-01T00:00:00Z",
          }),
        },
      ],
      { token: LEGACY_TOKEN },
    )

    expect(await client.verifyToken()).toEqual({
      id: "t",
      status: "active",
      expires_on: "2030-01-01T00:00:00Z",
      not_before: "2020-01-01T00:00:00Z",
    })
    expect(requests.map((r) => r.path)).toEqual([VERIFY_USER_PATH, VERIFY_ACCOUNT_PATH])
  })

  test("a legacy token the user endpoint accepts is not checked twice", async () => {
    const { client, requests } = clientFor([verifyRoute(VERIFY_USER_PATH, "active")], { token: LEGACY_TOKEN })
    await client.verifyToken()

    expect(requests.map((r) => r.path)).toEqual([VERIFY_USER_PATH])
  })

  test("a reply without a status is an upstream_error", async () => {
    const { client } = clientFor([{ method: "GET", path: VERIFY_USER_PATH, reply: ok({ id: "t" }) }])

    expect((await toolError(client.verifyToken())).code).toBe("upstream_error")
  })
})
