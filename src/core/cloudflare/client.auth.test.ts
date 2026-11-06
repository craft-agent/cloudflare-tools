import { describe, expect, test } from "bun:test"
import {
  ACCOUNT_TOKEN,
  AUDIT_PATH,
  VERIFY_ACCOUNT_PATH,
  VERIFY_USER_PATH,
  clientFor,
  toolError,
  verifyRoute,
} from "./client.fixtures"
import { ROUTES } from "./routes"
import { fail, type FakeRoute } from "./testing"

const DENIED = { code: 10000, message: "Authentication error" }

function auditFailing(status: number): FakeRoute {
  return { method: "GET", path: AUDIT_PATH, reply: fail(status, [DENIED]) }
}

const paths = (requests: Array<{ path: string }>) => requests.map((request) => request.path)

describe("CloudflareClient 401 and 403", () => {
  for (const status of [401, 403]) {
    test(`${status} with an active token is forbidden and says a permission is missing`, async () => {
      const { client, requests } = clientFor([auditFailing(status), verifyRoute(VERIFY_USER_PATH, "active")])
      const error = await toolError(client.request(ROUTES.auditLogs))

      expect(error.code).toBe("forbidden")
      expect(error.message).toContain("10000: Authentication error")
      expect(error.message).toContain("lacks a permission")
      expect(paths(requests)).toEqual([AUDIT_PATH, VERIFY_USER_PATH])
    })

    for (const tokenState of ["disabled", "expired"]) {
      test(`${status} with a ${tokenState} token is unauthenticated`, async () => {
        const { client } = clientFor([auditFailing(status), verifyRoute(VERIFY_USER_PATH, tokenState)])
        const error = await toolError(client.request(ROUTES.auditLogs))

        expect(error.code).toBe("unauthenticated")
        expect(error.message).toContain(tokenState)
        expect(error.message).toMatch(/re-enable or replace/)
      })
    }

    test(`${status} when the verify endpoint answers 401 is unauthenticated`, async () => {
      const { client, requests } = clientFor([
        auditFailing(status),
        { method: "GET", path: VERIFY_USER_PATH, reply: fail(401, [{ code: 1000, message: "Invalid API Token" }]) },
      ])
      const error = await toolError(client.request(ROUTES.auditLogs))

      expect(error.code).toBe("unauthenticated")
      expect(error.message).toBe("Cloudflare does not accept the token")
      expect(paths(requests)).toEqual([AUDIT_PATH, VERIFY_USER_PATH])
    })

    test(`${status} when the verify endpoint fails otherwise is forbidden with the original message`, async () => {
      const { client } = clientFor([
        auditFailing(status),
        { method: "GET", path: VERIFY_USER_PATH, reply: fail(500, [{ code: 1, message: "boom" }]) },
      ])
      const error = await toolError(client.request(ROUTES.auditLogs))

      expect(error.code).toBe("forbidden")
      expect(error.message).toBe("10000: Authentication error")
    })
  }

  test("an account token verifies through the account endpoint", async () => {
    const { client, requests } = clientFor([auditFailing(403), verifyRoute(VERIFY_ACCOUNT_PATH, "active")], {
      token: ACCOUNT_TOKEN,
    })
    const error = await toolError(client.request(ROUTES.auditLogs))

    expect(error.code).toBe("forbidden")
    expect(paths(requests)).toEqual([AUDIT_PATH, VERIFY_ACCOUNT_PATH])
  })

  test("verification happens once, never recursively", async () => {
    const { client, requests } = clientFor([auditFailing(403), { ...auditFailing(403), path: VERIFY_USER_PATH }])
    const error = await toolError(client.request(ROUTES.auditLogs))

    expect(error.code).toBe("forbidden")
    expect(paths(requests)).toEqual([AUDIT_PATH, VERIFY_USER_PATH])
  })

  test("a 401 from verifyToken itself is unauthenticated without another verify", async () => {
    const { client, requests } = clientFor([
      { method: "GET", path: VERIFY_USER_PATH, reply: fail(401, [{ code: 1000, message: "Invalid" }]) },
    ])
    const error = await toolError(client.verifyToken())

    expect(error.code).toBe("unauthenticated")
    expect(error.message).toBe("Cloudflare does not accept the token")
    expect(paths(requests)).toEqual([VERIFY_USER_PATH])
  })

  test("a legacy token rejected by both verify endpoints is unauthenticated", async () => {
    const rejected = fail(401, [{ code: 1000, message: "Invalid" }])
    const { client, requests } = clientFor(
      [
        auditFailing(401),
        { method: "GET", path: VERIFY_USER_PATH, reply: rejected },
        { method: "GET", path: VERIFY_ACCOUNT_PATH, reply: rejected },
      ],
      { token: "L".repeat(40) },
    )
    const error = await toolError(client.request(ROUTES.auditLogs))

    expect(error.code).toBe("unauthenticated")
    expect(paths(requests)).toEqual([AUDIT_PATH, VERIFY_USER_PATH, VERIFY_ACCOUNT_PATH])
  })
})
