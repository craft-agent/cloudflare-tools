import { describe, expect, test } from "bun:test"
import { USER_TOKEN, VERIFY_USER_PATH, clientFor, toolError, verifyRoute } from "./client.fixtures"
import { MASK } from "./mask"
import { fail, type FakeReply, type FakeRoute } from "./testing"

const GRAPHQL_PATH = "/graphql"
const QUERY = "query ($zone: string) { viewer { zones(filter: {zoneTag: $zone}) { zoneTag } } }"
const VARIABLES = { zone: "z1" }
const TOKEN_HEX = "bdec60c7623ada9834752e91f84d5ce3"

function graphqlRoute(reply: FakeReply): FakeRoute {
  return { method: "POST", path: GRAPHQL_PATH, reply }
}

function failing(message: string, code?: string): FakeReply {
  return {
    status: 200,
    body: { data: null, errors: [{ message, path: null, extensions: { ...(code ? { code } : {}) } }] },
  }
}

const run = (reply: FakeReply) => {
  const { client, requests } = clientFor([graphqlRoute(reply), verifyRoute(VERIFY_USER_PATH, "active")])
  return { promise: client.requestGraphql(QUERY, VARIABLES), requests }
}

describe("CloudflareClient.requestGraphql", () => {
  test("posts the query and variables with the bearer header and returns data", async () => {
    const { promise, requests } = run({ status: 200, body: { data: { viewer: { zones: [] } }, errors: null } })

    expect(await promise).toEqual({ viewer: { zones: [] } })
    expect(requests).toHaveLength(1)
    expect(requests[0]?.method).toBe("POST")
    expect(requests[0]?.path).toBe(GRAPHQL_PATH)
    expect(requests[0]?.headers.authorization).toBe(`Bearer ${USER_TOKEN}`)
    expect(requests[0]?.body).toEqual({ query: QUERY, variables: VARIABLES })
  })

  test("masks the token when it appears in data", async () => {
    const { promise } = run({ status: 200, body: { data: { note: `seen ${USER_TOKEN}` }, errors: null } })

    expect(await promise).toEqual({ note: `seen ${MASK}` })
  })

  test("an authz error on HTTP 200 is forbidden without a token check, and the token id is scrubbed", async () => {
    const message = `Actor 'com.cloudflare.api.token.${TOKEN_HEX}' does not have permission 'x' for zone z1`
    const { promise, requests } = run(failing(message, "authz"))
    const error = await toolError(promise)

    expect(error.code).toBe("forbidden")
    expect(error.message).toStartWith("The token does not have permission")
    expect(error.message).not.toContain(TOKEN_HEX)
    expect(requests).toHaveLength(1)
  })

  test("a quota error is invalid_argument with the days note", async () => {
    const message = 'account "c022" cannot request data older than 12w6d, but your query requests data from 17w1d1s ago'
    const error = await toolError(run(failing(message, "quota")).promise)

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toEndWith("That is 90 days back: choose a more recent range.")
  })

  test("the rate limiter is rate_limited", async () => {
    const error = await toolError(run(failing("rate limiter budget depleted, try again after 5 minutes")).promise)

    expect(error.code).toBe("rate_limited")
  })

  test("an unknown field is upstream_error", async () => {
    const error = await toolError(run(failing('unknown field "nope"')).promise)

    expect(error.code).toBe("upstream_error")
    expect(error.message).toContain('unknown field "nope"')
  })

  test("a failure message is masked", async () => {
    const error = await toolError(run(failing(`bad ${USER_TOKEN}`)).promise)

    expect(error.message).not.toContain(USER_TOKEN)
  })

  test("data is returned when errors is an empty array", async () => {
    expect(await run({ status: 200, body: { data: { a: 1 }, errors: [] } }).promise).toEqual({ a: 1 })
  })

  test("null data without errors is upstream_error", async () => {
    const error = await toolError(run({ status: 200, body: { data: null, errors: null } }).promise)

    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe("Cloudflare answered the analytics query without data")
  })

  test("HTTP 403 follows the existing auth flow", async () => {
    const { client, requests } = clientFor([
      graphqlRoute(fail(403, [{ code: 10000, message: "Authentication error" }])),
      verifyRoute(VERIFY_USER_PATH, "active"),
    ])
    const error = await toolError(client.requestGraphql(QUERY, VARIABLES))

    expect(error.code).toBe("forbidden")
    expect(error.message).toContain("lacks a permission")
    expect(requests.map((request) => request.path)).toEqual([GRAPHQL_PATH, VERIFY_USER_PATH])
  })

  test("a redirect is upstream_error", async () => {
    const error = await toolError(run({ status: 302, headers: { location: "https://example.com/" } }).promise)

    expect(error.code).toBe("upstream_error")
    expect(error.message).toContain("redirect")
  })

  test("a body that is not JSON is upstream_error", async () => {
    const error = await toolError(run({ status: 200, body: "<html>" }).promise)

    expect(error.code).toBe("upstream_error")
    expect(error.message).toContain("not a JSON object")
  })
})
