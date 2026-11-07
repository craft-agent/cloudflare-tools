import { expect, test } from "bun:test"
import { rejection } from "../cloudflare/client.fixtures"
import { invoke } from "../tool"
import { MAX_TEXT_LENGTH } from "../workers/shape"
import {
  CTX,
  GRAPHQL_PATH,
  ZONE_ID,
  ZONE_NAME,
  errorOf,
  graphqlFailure,
  graphqlReply,
  graphqlRoute,
  refusalOf,
  toolFor,
  zoneData,
} from "./fixtures"
import { SECURITY_EVENTS_QUERY, SECURITY_QUERY } from "./queries"

const GROUPS = "firewallEventsAdaptiveGroups"
const EVENTS = "firewallEventsAdaptive"

function toolWith(dataset: string, ...rows: unknown[]) {
  return toolFor(graphqlRoute(graphqlReply(zoneData(dataset, rows))))
}

test("each method sends its own fixed query with only the zone tag and the time range", async () => {
  for (const [method, query, dataset] of [
    ["security", SECURITY_QUERY, GROUPS],
    ["security_events", SECURITY_EVENTS_QUERY, EVENTS],
  ] as const) {
    const { tool, requests } = toolWith(dataset)
    await invoke(tool, { method, zone: ZONE_NAME, since: "2026-11-01", until: "2026-11-02T06:30:00Z" }, CTX)

    expect(requests.find((request) => request.path === GRAPHQL_PATH)?.body).toEqual({
      query,
      variables: { zoneTag: ZONE_ID, since: "2026-11-01T00:00:00Z", until: "2026-11-02T06:30:00Z" },
    })
  }
})

test("the queries select no visitor address, user agent, query string, referrer or ray id", () => {
  for (const query of [SECURITY_QUERY, SECURITY_EVENTS_QUERY]) {
    expect(query).not.toMatch(/clientIP|userAgent|queryString|referer|rayName|clientAsn|requestHeaders/i)
    expect(query).toContain("limit: 25")
  }
  expect(SECURITY_EVENTS_QUERY).toContain("{ datetime action source clientCountryName clientRequestPath }")
})

test("security shapes action, source and count and keeps Cloudflare's order", async () => {
  const { tool } = toolWith(
    GROUPS,
    { count: 40, dimensions: { action: "block", source: "waf" } },
    { count: 7, dimensions: { action: "log", source: null } },
    { count: 3, dimensions: { source: "ratelimit" } },
  )

  expect(await invoke(tool, { method: "security", zone: ZONE_NAME }, CTX)).toEqual({
    label: "default",
    zone: ZONE_NAME,
    since: "2026-11-06T15:42:09Z",
    until: "2026-11-07T15:42:09Z",
    groups: [
      { action: "block", source: "waf", count: 40 },
      { action: "log", source: null, count: 7 },
      { action: null, source: "ratelimit", count: 3 },
    ],
  })
})

test("a security group with neither action nor source is dropped and a missing count is null", async () => {
  const { tool } = toolWith(
    GROUPS,
    { count: 1, dimensions: {} },
    { count: 1, dimensions: { action: 5, source: null } },
    { count: 1 },
    { dimensions: { action: "block", source: "waf" } },
  )

  expect((await invoke(tool, { method: "security", zone: ZONE_NAME }, CTX)).groups).toEqual([
    { action: "block", source: "waf", count: null },
  ])
})

test("security_events shapes time, action, source, country and path and clips a long path", async () => {
  const long = `/${"p".repeat(MAX_TEXT_LENGTH + 50)}`
  const { tool } = toolWith(
    EVENTS,
    {
      datetime: "2026-11-07T15:00:00Z",
      action: "block",
      source: "waf",
      clientCountryName: "JP",
      clientRequestPath: "/login",
      clientIP: "203.0.113.9",
      userAgent: "agent",
    },
    { datetime: "2026-11-07T14:00:00Z", action: "challenge", clientRequestPath: long },
  )
  const result = await invoke(tool, { method: "security_events", zone: ZONE_NAME }, CTX)

  expect(result.events).toEqual([
    { at: "2026-11-07T15:00:00Z", action: "block", source: "waf", country: "JP", path: "/login" },
    {
      at: "2026-11-07T14:00:00Z",
      action: "challenge",
      source: null,
      country: null,
      path: `${long.slice(0, MAX_TEXT_LENGTH)}…`,
    },
  ])
})

test("a security event without a time is dropped", async () => {
  const { tool } = toolWith(EVENTS, { action: "block" }, { datetime: 5, action: "block" })

  expect((await invoke(tool, { method: "security_events", zone: ZONE_NAME }, CTX)).events).toEqual([])
})

test("without a range both methods read the last 24 hours up to the clock", async () => {
  for (const [method, dataset] of [
    ["security", GROUPS],
    ["security_events", EVENTS],
  ] as const) {
    const { tool, requests } = toolWith(dataset)
    await invoke(tool, { method, zone: ZONE_ID }, CTX)

    expect(requests.find((request) => request.path === GRAPHQL_PATH)?.body).toMatchObject({
      variables: { since: "2026-11-06T15:42:09Z", until: "2026-11-07T15:42:09Z" },
    })
  }
})

test("a range over 31 days is refused and a missing zone or wrong dataset is refused", async () => {
  const { tool, requests } = toolWith(GROUPS)
  const error = errorOf(
    await rejection(invoke(tool, { method: "security", zone: ZONE_NAME, since: "2026-09-01" }, CTX)),
  )

  expect(error.message).toBe("this report reads at most 31 days at once.")
  expect(await refusalOf(invoke(tool, { method: "security_events" }, CTX))).toContain(
    'Method "security_events" requires `zone`.',
  )
  expect(await refusalOf(invoke(tool, { method: "security", zone: ZONE_NAME, limit: 5 }, CTX))).toContain("limit")
  expect(requests.some((request) => request.path === GRAPHQL_PATH)).toBe(false)

  const wrong = toolWith(GROUPS)
  expect(errorOf(await rejection(invoke(wrong.tool, { method: "security_events", zone: ZONE_NAME }, CTX))).code).toBe(
    "upstream_error",
  )
})

test("a forbidden query says which permission the token needs", async () => {
  for (const method of ["security", "security_events"] as const) {
    const { tool } = toolFor(graphqlRoute(graphqlFailure("Zone analytics denied", "authz")))
    const error = errorOf(await rejection(invoke(tool, { method, zone: ZONE_NAME }, CTX)))

    expect(error.code).toBe("forbidden")
    expect(error.message).toEndWith(" The token needs Zone → Analytics → Read.")
  }
})
