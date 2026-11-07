import { describe, expect, test } from "bun:test"
import { durationDays, graphqlFailure, scrubTokenIds } from "./graphql"

const TOKEN_HEX = "bdec60c7623ada9834752e91f84d5ce3"
const TOKEN_ID = `com.cloudflare.api.token.${TOKEN_HEX}`
const ACCOUNT = "c022dd8fafd9e3f3124074fdd076fdad"
const ZONE = "3f7501a91c6409f0705cac31c181b69d"

function entry(message: string, code?: string) {
  return { message, path: null, extensions: { ...(code ? { code } : {}), timestamp: "2026-01-01T00:00:00Z" } }
}

describe("scrubTokenIds", () => {
  test("names the acting token without its id", () => {
    expect(scrubTokenIds(`Actor '${TOKEN_ID}' does not have permission`)).toBe("The token does not have permission")
  })

  test("replaces any other token id", () => {
    expect(scrubTokenIds(`denied for ${TOKEN_ID} here`)).toBe("denied for the token here")
  })
})

describe("durationDays", () => {
  test("counts whole days", () => {
    expect(durationDays("12w6d")).toBe(90)
    expect(durationDays("4w4d")).toBe(32)
    expect(durationDays("2d12h")).toBe(2)
  })

  test("is undefined under a day or when not a duration", () => {
    for (const text of ["23h", "", "abc", "6d12w"]) expect(durationDays(text)).toBeUndefined()
  })
})

describe("graphqlFailure", () => {
  test("authz is forbidden, with the token id scrubbed", () => {
    const failure = graphqlFailure([
      entry(
        `Actor '${TOKEN_ID}' does not have permission 'com.cloudflare.api.account.zone.analytics.read' for zone ${ZONE}`,
        "authz",
      ),
    ])

    expect(failure.code).toBe("forbidden")
    expect(failure.message).toStartWith("The token does not have permission")
    expect(failure.message).not.toContain(TOKEN_HEX)
  })

  test("a missing zone is forbidden", () => {
    expect(graphqlFailure([entry("Zone not found", "authz")])).toEqual({ code: "forbidden", message: "Zone not found" })
  })

  test("a quota on data age is invalid_argument with the days back", () => {
    const failure = graphqlFailure([
      entry(
        `account "${ACCOUNT}" cannot request data older than 12w6d, but your query requests data from 17w1d1s ago`,
        "quota",
      ),
    ])

    expect(failure.code).toBe("invalid_argument")
    expect(failure.message).toEndWith("17w1d1s ago. That is 90 days back: choose a more recent range.")
  })

  test("a quota on range width is invalid_argument with the days", () => {
    const failure = graphqlFailure([
      entry(
        `zone "${ZONE}" cannot request a time range wider than 4w4d, but your query time range spans 5w5d`,
        "quota",
      ),
    ])

    expect(failure.code).toBe("invalid_argument")
    expect(failure.message).toEndWith("spans 5w5d. That is 32 days: choose a shorter range.")
  })

  test("another quota has no note", () => {
    const message = `'limit' must be positive number and not greater than 10000 for account "${ACCOUNT}"`

    expect(graphqlFailure([entry(message, "quota")])).toEqual({ code: "invalid_argument", message })
  })

  test("the rate limiter is rate_limited whatever the code", () => {
    const message = "rate limiter budget depleted, try again after 5 minutes"

    expect(graphqlFailure([entry(message)])).toEqual({ code: "rate_limited", message })
    expect(graphqlFailure([entry(message, "other")]).code).toBe("rate_limited")
  })

  test("an unknown field is upstream_error", () => {
    expect(graphqlFailure([entry('unknown field "nope"')])).toEqual({
      code: "upstream_error",
      message: `Cloudflare's analytics query failed: unknown field "nope"`,
    })
  })

  test("joins at most three messages", () => {
    const failure = graphqlFailure(["a", "b", "c", "d"].map((message) => entry(message)))

    expect(failure.message).toBe("Cloudflare's analytics query failed: a; b; c")
  })

  test("skips unreadable entries and fails when none is readable", () => {
    expect(graphqlFailure([null, "x", { message: 1 }, entry("boom")]).message).toBe(
      "Cloudflare's analytics query failed: boom",
    )
    expect(graphqlFailure([null, 7])).toEqual({
      code: "upstream_error",
      message: "Cloudflare's analytics query failed without a readable error.",
    })
  })
})
