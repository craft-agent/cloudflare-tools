import { describe, expect, test } from "bun:test"
import { ACCOUNT_ID, envFor, tokenStatus, toolError, USER_TOKEN, VERIFY_USER_PATH } from "../cloudflare/client.fixtures"
import { fakeCloudflare, ok } from "../cloudflare/testing"
import { annotations, invoke } from "../tool"
import { cloudflareAccountRead, defineAccountRead } from "./read"

const CTX = { cwd: process.cwd() }
const ACCOUNT_PATH = `/accounts/${ACCOUNT_ID}`
const OTHER_ACCOUNT_ID = "1".repeat(32)
const OTHER_TOKEN = "cfut_" + "c3".repeat(20)

describe("cloudflareAccountRead: annotations", () => {
  test("publishes read class annotations", () => {
    expect(annotations(cloudflareAccountRead)).toEqual({
      title: "Read Cloudflare accounts",
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: true,
    })
  })
})

describe("cloudflareAccountRead: list", () => {
  test("lists credentials with default, labels, and problems without sending requests", async () => {
    const env = {
      CLOUDFLARE_API_TOKEN: USER_TOKEN,
      CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID,
      CLOUDFLARE_API_TOKEN_PROD: OTHER_TOKEN,
      CLOUDFLARE_ACCOUNT_ID_PROD: OTHER_ACCOUNT_ID,
      CLOUDFLARE_API_TOKEN_BROKEN: "not-a-token",
      CLOUDFLARE_ACCOUNT_ID_BROKEN: "not-an-id",
    }
    const { fetch, requests } = fakeCloudflare([])
    const tool = defineAccountRead({ fetch, env })

    const result = await invoke(tool, { method: "list" }, CTX)

    expect(requests).toHaveLength(0)
    expect(result.accounts).toEqual([
      {
        label: "default",
        account_id: ACCOUNT_ID,
        token_kind: "user",
        default: true,
        problem: null,
      },
      {
        label: "broken",
        account_id: null,
        token_kind: null,
        default: false,
        problem: "CLOUDFLARE_ACCOUNT_ID_BROKEN is not a 32-character account id",
      },
      {
        label: "prod",
        account_id: OTHER_ACCOUNT_ID,
        token_kind: "user",
        default: false,
        problem: null,
      },
    ])
    expect(result.problems).toEqual([])
  })
})

describe("cloudflareAccountRead: view", () => {
  test("happy path verifies token and reads account details", async () => {
    const { fetch, requests } = fakeCloudflare([
      { method: "GET", path: VERIFY_USER_PATH, reply: tokenStatus("active") },
      {
        method: "GET",
        path: ACCOUNT_PATH,
        reply: ok({
          id: ACCOUNT_ID,
          name: "Test Account",
          type: "standard",
          created_on: "2024-01-01T00:00:00Z",
        }),
      },
    ])
    const tool = defineAccountRead({ fetch, env: envFor() })

    const result = await invoke(tool, { method: "view" }, CTX)

    expect(requests).toHaveLength(2)
    expect(requests[0]!.path).toBe(VERIFY_USER_PATH)
    expect(requests[1]!.path).toBe(ACCOUNT_PATH)
    expect(result).toEqual({
      token: {
        id: "token-id",
        status: "active",
        expires_on: null,
        not_before: null,
      },
      account: {
        label: "default",
        account_id: ACCOUNT_ID,
        name: "Test Account",
        type: "standard",
        created_on: "2024-01-01T00:00:00Z",
      },
    })
  })

  test("returns account_error when account request is forbidden", async () => {
    const { fetch, requests } = fakeCloudflare([
      { method: "GET", path: VERIFY_USER_PATH, reply: tokenStatus("active") },
      {
        method: "GET",
        path: ACCOUNT_PATH,
        reply: {
          status: 403,
          body: { success: false, errors: [{ code: 10000, message: "Authentication error" }], messages: [] },
        },
      },
    ])
    const tool = defineAccountRead({ fetch, env: envFor() })

    const result = await invoke(tool, { method: "view" }, CTX)

    expect(requests).toHaveLength(3) // verify, account -> 403 triggers verify on auth failure
    expect(result.token).toEqual({
      id: "token-id",
      status: "active",
      expires_on: null,
      not_before: null,
    })
    expect(result.account).toEqual({
      label: "default",
      account_id: ACCOUNT_ID,
      name: null,
      type: null,
      created_on: null,
    })
    expect(result.account_error).toContain("forbidden")
  })

  test("returns account_error when account request is not_found", async () => {
    const { fetch } = fakeCloudflare([
      { method: "GET", path: VERIFY_USER_PATH, reply: tokenStatus("active") },
      {
        method: "GET",
        path: ACCOUNT_PATH,
        reply: {
          status: 404,
          body: { success: false, errors: [{ code: 7003, message: "Account not found" }], messages: [] },
        },
      },
    ])
    const tool = defineAccountRead({ fetch, env: envFor() })

    const result = await invoke(tool, { method: "view" }, CTX)

    expect(result.token).toBeDefined()
    expect(result.account).toEqual({
      label: "default",
      account_id: ACCOUNT_ID,
      name: null,
      type: null,
      created_on: null,
    })
    expect(result.account_error).toContain("not_found")
  })
})

describe("cloudflareAccountRead: cross-method validation", () => {
  test("refuses account argument on list", async () => {
    const { fetch } = fakeCloudflare([])
    const tool = defineAccountRead({ fetch, env: envFor() })

    const error = await toolError(invoke(tool, { method: "list", account: "default" }, CTX))
    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain('Method "list" takes no `account`')
  })

  test("refuses audit arguments on view", async () => {
    const { fetch } = fakeCloudflare([])
    const tool = defineAccountRead({ fetch, env: envFor() })

    const error = await toolError(invoke(tool, { method: "view", limit: 10 }, CTX))
    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain('Method "view" takes no `limit`')
  })

  test("refuses unknown arguments", async () => {
    const { fetch } = fakeCloudflare([])
    const tool = defineAccountRead({ fetch, env: envFor() })

    const error = await toolError(invoke(tool, { method: "list", extra: true }, CTX))
    expect(error.code).toBe("invalid_argument")
  })
})

describe("cloudflareAccountRead: account picking", () => {
  test("passes through error when requested account label is unknown", async () => {
    const { fetch } = fakeCloudflare([])
    const tool = defineAccountRead({ fetch, env: envFor() })

    const error = await toolError(invoke(tool, { method: "view", account: "unknown_label" }, CTX))
    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain('No Cloudflare account "unknown_label" is set')
  })

  test("passes through error when several accounts are set without default and account is omitted", async () => {
    const env = {
      CLOUDFLARE_API_TOKEN_ONE: USER_TOKEN,
      CLOUDFLARE_ACCOUNT_ID_ONE: ACCOUNT_ID,
      CLOUDFLARE_API_TOKEN_TWO: OTHER_TOKEN,
      CLOUDFLARE_ACCOUNT_ID_TWO: OTHER_ACCOUNT_ID,
    }
    const { fetch } = fakeCloudflare([])
    const tool = defineAccountRead({ fetch, env })

    const error = await toolError(invoke(tool, { method: "view" }, CTX))
    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("Several Cloudflare accounts are set")
  })
})

describe("cloudflareAccountRead: token masking", () => {
  test("no token value appears in view or list results", async () => {
    const env = {
      CLOUDFLARE_API_TOKEN: USER_TOKEN,
      CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID,
      CLOUDFLARE_API_TOKEN_PROD: OTHER_TOKEN,
      CLOUDFLARE_ACCOUNT_ID_PROD: OTHER_ACCOUNT_ID,
    }
    const { fetch } = fakeCloudflare([
      { method: "GET", path: VERIFY_USER_PATH, reply: tokenStatus("active") },
      {
        method: "GET",
        path: ACCOUNT_PATH,
        reply: ok({ id: ACCOUNT_ID, name: "Safe Account" }),
      },
    ])
    const tool = defineAccountRead({ fetch, env })

    const listResult = await invoke(tool, { method: "list" }, CTX)
    const viewResult = await invoke(tool, { method: "view" }, CTX)

    const serializedList = JSON.stringify(listResult)
    const serializedView = JSON.stringify(viewResult)

    expect(serializedList).not.toContain(USER_TOKEN)
    expect(serializedList).not.toContain(OTHER_TOKEN)
    expect(serializedView).not.toContain(USER_TOKEN)
    expect(serializedView).not.toContain(OTHER_TOKEN)
  })
})
