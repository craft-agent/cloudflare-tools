import { expect, test } from "bun:test"
import { invoke } from "../tool"
import { CTX, GRAPHQL_PATH, ZONE_ID, ZONE_NAME, graphqlReply, graphqlRoute, toolFor, zoneData } from "./fixtures"
import { TRAFFIC_QUERY } from "./queries"

const DAY_ONE = {
  dimensions: { date: "2026-11-05" },
  sum: { requests: 100, bytes: 2000, cachedRequests: 60, cachedBytes: 1500, threats: 3, pageViews: 40 },
  uniq: { uniques: 25 },
}
const DAY_TWO = {
  dimensions: { date: "2026-11-06" },
  sum: { requests: 50, bytes: 1000, cachedRequests: 10, cachedBytes: 500, threats: 0, pageViews: 20 },
  uniq: { uniques: 15 },
}
const SPARSE_DAY = { dimensions: { date: "2026-11-07" }, sum: { requests: 7, bytes: "many" }, uniq: {} }

function trafficTool(...groups: unknown[]) {
  return toolFor(graphqlRoute(graphqlReply(zoneData("httpRequests1dGroups", groups))))
}

function graphqlRequest(requests: ReturnType<typeof trafficTool>["requests"]) {
  return requests.find((request) => request.path === GRAPHQL_PATH)
}

test("traffic sends the fixed query with only the zone tag and the range", async () => {
  const { tool, requests } = trafficTool()
  await invoke(tool, { method: "traffic", zone: ZONE_NAME, since: "2026-11-01", until: "2026-11-06" }, CTX)

  expect(graphqlRequest(requests)?.body).toEqual({
    query: TRAFFIC_QUERY,
    variables: { zoneTag: ZONE_ID, since: "2026-11-01", until: "2026-11-06" },
  })
})

test("traffic shapes each day and sums the totals", async () => {
  const { tool } = trafficTool(DAY_ONE, DAY_TWO)

  expect(await invoke(tool, { method: "traffic", zone: ZONE_NAME }, CTX)).toEqual({
    label: "default",
    zone: ZONE_NAME,
    since: "2026-11-01",
    until: "2026-11-07",
    days: [
      {
        date: "2026-11-05",
        requests: 100,
        cached_requests: 60,
        bytes: 2000,
        cached_bytes: 1500,
        threats: 3,
        page_views: 40,
        uniques: 25,
      },
      {
        date: "2026-11-06",
        requests: 50,
        cached_requests: 10,
        bytes: 1000,
        cached_bytes: 500,
        threats: 0,
        page_views: 20,
        uniques: 15,
      },
    ],
    totals: { requests: 150, cached_requests: 70, bytes: 3000, cached_bytes: 2000, threats: 3, page_views: 60 },
  })
})

test("a number Cloudflare did not send is null and adds nothing to the totals", async () => {
  const { tool } = trafficTool(SPARSE_DAY, { dimensions: { date: "2026-11-08" } }, { sum: { requests: 9 } })
  const result = await invoke(tool, { method: "traffic", zone: ZONE_NAME }, CTX)

  expect(result.days).toEqual([
    {
      date: "2026-11-07",
      requests: 7,
      cached_requests: null,
      bytes: null,
      cached_bytes: null,
      threats: null,
      page_views: null,
      uniques: null,
    },
    {
      date: "2026-11-08",
      requests: null,
      cached_requests: null,
      bytes: null,
      cached_bytes: null,
      threats: null,
      page_views: null,
      uniques: null,
    },
  ])
  expect(result.totals).toEqual({
    requests: 7,
    cached_requests: 0,
    bytes: 0,
    cached_bytes: 0,
    threats: 0,
    page_views: 0,
  })
})

test("no days give zero totals", async () => {
  const { tool } = trafficTool()
  const result = await invoke(tool, { method: "traffic", zone: ZONE_NAME }, CTX)

  expect(result.days).toEqual([])
  expect(result.totals).toEqual({
    requests: 0,
    cached_requests: 0,
    bytes: 0,
    cached_bytes: 0,
    threats: 0,
    page_views: 0,
  })
})

test("without a range traffic reads the last seven UTC days up to the clock's day", async () => {
  const { tool, requests } = trafficTool()
  const result = await invoke(tool, { method: "traffic", zone: ZONE_ID }, CTX)

  expect(graphqlRequest(requests)?.body).toMatchObject({ variables: { since: "2026-11-01", until: "2026-11-07" } })
  expect(result).toMatchObject({ since: "2026-11-01", until: "2026-11-07" })
})

test("a time is refused because traffic counts whole days", async () => {
  const { tool } = trafficTool()

  await expect(
    invoke(tool, { method: "traffic", zone: ZONE_NAME, since: "2026-11-01T09:00:00Z" }, CTX),
  ).rejects.toThrow("`since` must be a date (2026-11-01): traffic counts whole UTC days.")
})
