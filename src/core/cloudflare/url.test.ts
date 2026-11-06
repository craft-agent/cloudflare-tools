import { describe, expect, test } from "bun:test"
import { ToolError } from "../errors"
import { ROUTES } from "./routes"
import { BASE_URL, TEMPLATE_PARAM_PATTERN, buildQuery, fillPath } from "./url"

const ACCOUNT_ID = "0".repeat(31) + "a"
const ZONE_ID = "f".repeat(32)

describe("url", () => {
  describe("BASE_URL", () => {
    test("points to Cloudflare v4 API", () => {
      expect(BASE_URL).toBe("https://api.cloudflare.com/client/v4")
    })
  })

  describe("TEMPLATE_PARAM_PATTERN", () => {
    test("matches braced parameter names", () => {
      const matches = [...ROUTES.auditLogs.path.matchAll(TEMPLATE_PARAM_PATTERN)].map((match) => match[1])
      expect(matches).toEqual(["account_id"])
    })
  })

  describe("buildQuery", () => {
    test("encodes the query: skips undefined, stringifies, repeats arrays in order", () => {
      const query = buildQuery({
        page: 2,
        dry_run: false,
        skipped: undefined,
        action: ["a b", "c&d"],
        since: "2026-01-01T00:00:00Z",
      })

      const params = new URLSearchParams(query)
      expect([...params.entries()]).toEqual([
        ["page", "2"],
        ["dry_run", "false"],
        ["action", "a b"],
        ["action", "c&d"],
        ["since", "2026-01-01T00:00:00Z"],
      ])
    })

    test("sends no query string when nothing is left of the query", () => {
      expect(buildQuery({ a: undefined, b: [] })).toBe("")
      expect(buildQuery({})).toBe("")
    })
  })

  describe("fillPath", () => {
    test("fills account_id from the credential and a given zone_id", () => {
      const route = { method: "GET", path: "/accounts/{account_id}/zones/{zone_id}" } as const

      expect(fillPath(route, ACCOUNT_ID, { zone_id: ZONE_ID })).toBe(`/accounts/${ACCOUNT_ID}/zones/${ZONE_ID}`)
    })

    test("refuses an account_id in params from the caller", () => {
      expect(() => fillPath(ROUTES.account, ACCOUNT_ID, { account_id: "1".repeat(32) })).toThrow(
        "account_id is filled from the credential, never from the caller.",
      )
    })

    test("refuses a path parameter the route does not use", () => {
      expect(() => fillPath(ROUTES.account, ACCOUNT_ID, { zone_id: ZONE_ID })).toThrow(
        `Route ${ROUTES.account.path} has no path parameter "zone_id".`,
      )
    })

    test("refuses a missing or malformed value as invalid_argument naming the parameter", () => {
      const route = { method: "GET", path: "/zones/{zone_id}" } as const

      const cases: Array<Record<string, string>> = [
        {},
        { zone_id: "" },
        { zone_id: "../../etc" },
        { zone_id: ZONE_ID.toUpperCase() },
      ]
      for (const params of cases) {
        const error = (() => {
          try {
            fillPath(route, ACCOUNT_ID, params)
          } catch (thrown) {
            return thrown
          }
        })()
        expect(error).toBeInstanceOf(ToolError)
        expect((error as ToolError).code).toBe("invalid_argument")
        expect((error as ToolError).message).toContain('"zone_id"')
      }
    })

    test("refuses a template naming an unknown parameter", () => {
      expect(() => fillPath({ method: "GET", path: "/things/{thing_id}" }, ACCOUNT_ID)).toThrow(/thing_id/)
    })
  })
})
