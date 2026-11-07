import { expect, test } from "bun:test"
import { rejection } from "../cloudflare/client.fixtures"
import { ok } from "../cloudflare/testing"
import { annotations, invoke } from "../tool"
import {
  CTX,
  GRAPHQL_PATH,
  ZONE_NAME,
  errorOf,
  graphqlFailure,
  graphqlReply,
  graphqlRoute,
  refusalOf,
  toolFor,
} from "./fixtures"
import { cloudflareAnalyticsRead } from "./read"

test("publishes the analytics read contract and guidance", () => {
  expect(cloudflareAnalyticsRead.id).toBe("cloudflare_analytics_read")
  expect(cloudflareAnalyticsRead.toolset).toBe("analytics")
  expect(annotations(cloudflareAnalyticsRead)).toEqual({
    title: "Read Cloudflare analytics",
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: true,
  })
  for (const text of [
    "UTC dates",
    "whole days",
    "7 days by default",
    "at most 366 days",
    "names that limit",
    "Zone → Analytics → Read",
    "cannot be added up",
  ])
    expect(cloudflareAnalyticsRead.description).toContain(text)
})

test("refuses unknown, wrong-method and malformed arguments before sending anything", async () => {
  const { tool, requests } = toolFor()
  for (const [key, value] of [
    ["extra", "no"],
    ["account_id", "f".repeat(32)],
    ["limit", 5],
  ] as const) {
    expect(await refusalOf(invoke(tool, { method: "traffic", zone: ZONE_NAME, [key]: value }, CTX))).toContain(key)
  }
  expect(await refusalOf(invoke(tool, { method: "traffic" }, CTX))).toContain('Method "traffic" requires `zone`.')
  expect(await refusalOf(invoke(tool, { method: "bogus", zone: ZONE_NAME }, CTX))).toContain("method")
  expect(await refusalOf(invoke(tool, { method: "traffic", zone: ZONE_NAME, since: 5 }, CTX))).toContain("since")
  expect(requests).toEqual([])
})

test("an unknown zone is not_found from the lookup and no query is sent", async () => {
  const { tool, requests } = toolFor({ method: "GET", path: "/zones", reply: ok([]) })
  const error = errorOf(await rejection(invoke(tool, { method: "traffic", zone: "other.example.org" }, CTX)))

  expect(error.code).toBe("not_found")
  expect(requests.some((request) => request.path === GRAPHQL_PATH)).toBe(false)
})

test("a refused range sends no query", async () => {
  const { tool, requests } = toolFor(graphqlRoute(graphqlReply({})))
  const error = errorOf(
    await rejection(
      invoke(tool, { method: "traffic", zone: ZONE_NAME, since: "2026-11-09", until: "2026-11-08" }, CTX),
    ),
  )

  expect(error.code).toBe("invalid_argument")
  expect(requests.some((request) => request.path === GRAPHQL_PATH)).toBe(false)
})

test("a forbidden query says which permission the token needs", async () => {
  const { tool } = toolFor(graphqlRoute(graphqlFailure("Zone analytics denied", "authz")))
  const error = errorOf(await rejection(invoke(tool, { method: "traffic", zone: ZONE_NAME }, CTX)))

  expect(error.code).toBe("forbidden")
  expect(error.message).toEndWith("Zone analytics denied. The token needs Zone → Analytics → Read.")
})

test("an answer without the zone or the dataset is an upstream_error", async () => {
  for (const data of [
    {},
    { viewer: null },
    { viewer: { zones: [] } },
    { viewer: { zones: [{}] } },
    { viewer: { zones: [{ httpRequests1dGroups: {} }] } },
  ]) {
    const { tool } = toolFor(graphqlRoute(graphqlReply(data)))
    const error = errorOf(await rejection(invoke(tool, { method: "traffic", zone: ZONE_NAME }, CTX)))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe("Cloudflare returned an unexpected analytics response.")
  }
})
