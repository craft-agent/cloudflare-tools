import { envFor } from "../cloudflare/client.fixtures"
import { fakeCloudflare, ok, type FakeReply, type FakeRoute } from "../cloudflare/testing"
import { SAMPLE_ZONE, ZONE_ROUTE } from "../zone/fixtures"
import { defineAnalyticsRead } from "./read"

export { errorOf, refusalOf } from "../workers/fixtures"

export { CTX, ZONE_NAME, ZONE_ROUTE } from "../zone/fixtures"

export { ACCOUNT_ID, ZONE_ID } from "../cloudflare/client.fixtures"

export const GRAPHQL_PATH = "/graphql"

/** The clock every analytics test reads. */
export const NOW = new Date("2026-11-07T15:42:09.789Z")

/** A GraphQL answer carrying `data`. */
export function graphqlReply(data: unknown): FakeReply {
  return { status: 200, body: { data, errors: null } }
}

/** A GraphQL answer that fails with one error on HTTP 200. */
export function graphqlFailure(message: string, code: string): FakeReply {
  return { status: 200, body: { data: null, errors: [{ message, path: null, extensions: { code } }] } }
}

/** The GraphQL route answering with `reply`. */
export function graphqlRoute(reply: FakeReply): FakeRoute {
  return { method: "POST", path: GRAPHQL_PATH, reply }
}

/** The `data` of a query answered with the given dataset of a single zone. */
export function zoneData(dataset: string, groups: unknown): unknown {
  return { viewer: { zones: [{ [dataset]: groups }] } }
}

/** The `data` of a query answered with the given dataset of a single account. */
export function accountData(dataset: string, rows: unknown): unknown {
  return { viewer: { accounts: [{ [dataset]: rows }] } }
}

const ZONES_ROUTE: FakeRoute = { method: "GET", path: "/zones", reply: ok([SAMPLE_ZONE]) }

/**
 * The read tool with a fake Cloudflare answering the zone lookup (by id or by name, unless a given route answers
 * first) and only these routes, at the fixed clock.
 */
export function toolFor(...routes: FakeRoute[]) {
  const { fetch, requests } = fakeCloudflare([ZONE_ROUTE, ...routes, ZONES_ROUTE])
  return { tool: defineAnalyticsRead({ fetch, env: envFor(), now: () => NOW }), requests }
}
