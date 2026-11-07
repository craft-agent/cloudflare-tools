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
  graphqlReply,
  graphqlRoute,
  toolFor,
  zoneData,
} from "./fixtures"
import { COUNTRIES_QUERY, PATHS_QUERY, STATUSES_QUERY, TOP_DIMENSIONS } from "./queries"

const METHODS = [
  ["paths", PATHS_QUERY, TOP_DIMENSIONS.paths],
  ["countries", COUNTRIES_QUERY, TOP_DIMENSIONS.countries],
  ["statuses", STATUSES_QUERY, TOP_DIMENSIONS.statuses],
] as const

function topTool(...groups: unknown[]) {
  return toolFor(graphqlRoute(graphqlReply(zoneData("httpRequestsAdaptiveGroups", groups))))
}

test("each method sends its own fixed query with only the zone tag and the time range", async () => {
  for (const [method, query, dimension] of METHODS) {
    const { tool, requests } = topTool()
    await invoke(tool, { method, zone: ZONE_NAME, since: "2026-11-01", until: "2026-11-02T06:30:00Z" }, CTX)
    const sent = requests.find((request) => request.path === GRAPHQL_PATH)

    expect(sent?.body).toEqual({
      query,
      variables: { zoneTag: ZONE_ID, since: "2026-11-01T00:00:00Z", until: "2026-11-02T06:30:00Z" },
    })
    expect(query).toContain(`dimensions { ${dimension} }`)
    expect(query).toContain('requestSource: "eyeball"')
    expect(query).toContain("limit: 25")
  }
})

test("the queries differ only in their dimension", () => {
  for (const [, query, dimension] of METHODS) {
    expect(query.replace(dimension, "DIMENSION")).toBe(PATHS_QUERY.replace(TOP_DIMENSIONS.paths, "DIMENSION"))
  }
})

test("without a range the report reads the last 24 hours up to the clock", async () => {
  for (const [method] of METHODS) {
    const { tool, requests } = topTool()
    const result = await invoke(tool, { method, zone: ZONE_ID }, CTX)

    expect(requests.find((request) => request.path === GRAPHQL_PATH)?.body).toMatchObject({
      variables: { since: "2026-11-06T15:42:09Z", until: "2026-11-07T15:42:09Z" },
    })
    expect(result).toEqual({
      label: "default",
      zone: ZONE_NAME,
      since: "2026-11-06T15:42:09Z",
      until: "2026-11-07T15:42:09Z",
      top: [],
    })
  }
})

test("paths keep Cloudflare's order and clip a long path", async () => {
  const long = `/${"a".repeat(MAX_TEXT_LENGTH + 50)}`
  const { tool } = topTool(
    { count: 90, dimensions: { clientRequestPath: "/" } },
    { count: 10, dimensions: { clientRequestPath: long } },
  )
  const result = await invoke(tool, { method: "paths", zone: ZONE_NAME }, CTX)

  expect(result.top).toEqual([
    { value: "/", count: 90 },
    { value: `${long.slice(0, MAX_TEXT_LENGTH)}…`, count: 10 },
  ])
})

test("countries keep their names; statuses keep the number Cloudflare sends", async () => {
  const countries = topTool({ count: 5, dimensions: { clientCountryName: "JP" } })
  expect((await invoke(countries.tool, { method: "countries", zone: ZONE_NAME }, CTX)).top).toEqual([
    { value: "JP", count: 5 },
  ])
  const statuses = topTool(
    { count: 8, dimensions: { edgeResponseStatus: 200 } },
    { count: 2, dimensions: { edgeResponseStatus: "404" } },
  )
  expect((await invoke(statuses.tool, { method: "statuses", zone: ZONE_NAME }, CTX)).top).toEqual([
    { value: 200, count: 8 },
    { value: "404", count: 2 },
  ])
})

test("an entry without a usable value is dropped and a missing count is null", async () => {
  const { tool } = topTool(
    { count: 1, dimensions: {} },
    { count: 1, dimensions: { clientCountryName: null } },
    { count: 1 },
    { dimensions: { clientCountryName: "US" } },
  )

  expect((await invoke(tool, { method: "countries", zone: ZONE_NAME }, CTX)).top).toEqual([
    { value: "US", count: null },
  ])
})

test("a day-long span reads a date as until as the end of that day, and 31 days is the limit", async () => {
  const { tool } = topTool()
  const result = await invoke(tool, { method: "paths", zone: ZONE_NAME, since: "2026-10-01", until: "2026-10-31" }, CTX)

  expect(result).toMatchObject({ since: "2026-10-01T00:00:00Z", until: "2026-11-01T00:00:00Z" })
  const error = errorOf(
    await rejection(invoke(tool, { method: "paths", zone: ZONE_NAME, since: "2026-10-01", until: "2026-11-01" }, CTX)),
  )
  expect(error.code).toBe("invalid_argument")
  expect(error.message).toBe("this report reads at most 31 days at once.")
})

test("a missing dataset is an unexpected response", async () => {
  const { tool } = toolFor(graphqlRoute(graphqlReply({ viewer: { zones: [{ httpRequests1dGroups: [] }] } })))
  const error = errorOf(await rejection(invoke(tool, { method: "statuses", zone: ZONE_NAME }, CTX)))

  expect(error.code).toBe("upstream_error")
})
