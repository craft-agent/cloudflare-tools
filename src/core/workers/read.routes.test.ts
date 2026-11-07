import { describe, expect, test } from "bun:test"
import { ACCOUNT_ID, ZONE_ID, rejection } from "../cloudflare/client.fixtures"
import { ok } from "../cloudflare/testing"
import { invoke } from "../tool"
import { CTX, OTHER_ACCOUNT_ID, SAMPLE_ZONE, ZONE_NAME, ZONE_PATH, ZONE_ROUTE } from "../zone/fixtures"
import { SCRIPT, errorOf, refusalOf, toolFor } from "./fixtures"

const ROUTES_PATH = `${ZONE_PATH}/workers/routes`
const DOMAINS_PATH = `/accounts/${ACCOUNT_ID}/workers/domains`
const ROUTE_ID = "f".repeat(32)
const PATTERN = `${ZONE_NAME}/*`
const WORKER_ROUTES = [
  { id: ROUTE_ID, pattern: PATTERN, script: SCRIPT, extra: "not returned" },
  { id: "e".repeat(32), pattern: `${ZONE_NAME}/excluded/*`, script: null },
  { id: "d".repeat(32), pattern: `${ZONE_NAME}/other/*`, script: "other-worker" },
]

describe("cloudflareWorkersRead: routes", () => {
  test("reads the zone's routes, retaining excluded patterns and only the selected fields", async () => {
    const { tool, requests } = toolFor(ZONE_ROUTE, { method: "GET", path: ROUTES_PATH, reply: ok(WORKER_ROUTES) })
    const result = await invoke(tool, { method: "routes", zone: ZONE_ID }, CTX)

    expect(result).toEqual({
      label: "default",
      zone: { id: ZONE_ID, name: ZONE_NAME },
      routes: [
        { id: ROUTE_ID, pattern: PATTERN, script: SCRIPT },
        { id: "e".repeat(32), pattern: `${ZONE_NAME}/excluded/*`, script: null },
        { id: "d".repeat(32), pattern: `${ZONE_NAME}/other/*`, script: "other-worker" },
      ],
    })
    expect(requests.map((request) => request.path)).toEqual([ZONE_PATH, ROUTES_PATH])
    expect(Object.fromEntries(requests[1]!.query)).toEqual({})
  })

  test("filters by the trimmed script locally, never in the query", async () => {
    const { tool, requests } = toolFor(ZONE_ROUTE, { method: "GET", path: ROUTES_PATH, reply: ok(WORKER_ROUTES) })
    const result = await invoke(tool, { method: "routes", zone: ZONE_ID, script: ` ${SCRIPT} ` }, CTX)

    expect(result.routes).toEqual([{ id: ROUTE_ID, pattern: PATTERN, script: SCRIPT }])
    expect(Object.fromEntries(requests[1]!.query)).toEqual({})
  })

  test("resolves a zone name within the selected account", async () => {
    const { tool, requests } = toolFor(
      { method: "GET", path: "/zones", reply: ok([SAMPLE_ZONE]) },
      { method: "GET", path: ROUTES_PATH, reply: ok([]) },
    )
    await invoke(tool, { method: "routes", zone: ZONE_NAME }, CTX)

    expect(Object.fromEntries(requests[0]!.query)).toEqual({ name: ZONE_NAME, "account.id": ACCOUNT_ID, per_page: "5" })
  })

  test("fills missing or odd route fields", async () => {
    const { tool } = toolFor(ZONE_ROUTE, { method: "GET", path: ROUTES_PATH, reply: ok([null, { script: 2 }]) })
    const result = await invoke(tool, { method: "routes", zone: ZONE_ID }, CTX)

    expect(result.routes).toEqual([
      { id: "", pattern: "", script: null },
      { id: "", pattern: "", script: null },
    ])
  })

  test("requires zone and refuses arguments of other methods before requesting", async () => {
    const { tool, requests } = toolFor()
    expect(await refusalOf(invoke(tool, { method: "routes" }, CTX))).toBe('Method "routes" requires `zone`.')
    for (const extra of [{ hostname: "www.example.com" }, { page: 1 }, { per_page: 10 }]) {
      expect(await refusalOf(invoke(tool, { method: "routes", zone: ZONE_ID, ...extra }, CTX))).toContain("routes")
    }
    expect(requests).toHaveLength(0)
  })
})

describe("cloudflareWorkersRead: domains", () => {
  test("shapes custom domains without cert_id or environment and defaults the switches", async () => {
    const { tool, requests } = toolFor({
      method: "GET",
      path: DOMAINS_PATH,
      reply: ok([
        {
          id: ROUTE_ID,
          hostname: `www.${ZONE_NAME}`,
          service: SCRIPT,
          zone_id: ZONE_ID,
          zone_name: ZONE_NAME,
          cert_id: "private-certificate-id",
          environment: "production",
          previews_enabled: true,
        },
        { enabled: false, previews_enabled: "true" },
        null,
      ]),
    })
    const result = await invoke(tool, { method: "domains" }, CTX)

    expect(result).toEqual({
      label: "default",
      domains: [
        {
          id: ROUTE_ID,
          hostname: `www.${ZONE_NAME}`,
          script: SCRIPT,
          zone: { id: ZONE_ID, name: ZONE_NAME },
          enabled: true,
          previews_enabled: true,
        },
        { id: "", hostname: "", script: "", zone: { id: "", name: "" }, enabled: false, previews_enabled: false },
        { id: "", hostname: "", script: "", zone: { id: "", name: "" }, enabled: true, previews_enabled: false },
      ],
    })
    expect(Object.fromEntries(requests[0]!.query)).toEqual({})
  })

  test("sends only given filters, normalizing script and hostname and resolving zone", async () => {
    const { tool, requests } = toolFor(ZONE_ROUTE, { method: "GET", path: DOMAINS_PATH, reply: ok([]) })
    await invoke(tool, { method: "domains", script: ` ${SCRIPT} ` }, CTX)
    await invoke(tool, { method: "domains", hostname: " WWW.EXAMPLE.COM " }, CTX)
    await invoke(tool, { method: "domains", zone: ZONE_ID }, CTX)
    await invoke(tool, { method: "domains", script: SCRIPT, hostname: " WWW.EXAMPLE.COM ", zone: ZONE_ID }, CTX)

    const queries = requests
      .filter((request) => request.path === DOMAINS_PATH)
      .map((request) => Object.fromEntries(request.query))
    expect(queries).toEqual([
      { service: SCRIPT },
      { hostname: "www.example.com" },
      { zone_id: ZONE_ID },
      { service: SCRIPT, hostname: "www.example.com", zone_id: ZONE_ID },
    ])
  })

  test("refuses paging arguments", async () => {
    const { tool, requests } = toolFor()
    for (const extra of [{ page: 1 }, { per_page: 10 }]) {
      expect(await refusalOf(invoke(tool, { method: "domains", ...extra }, CTX))).toContain("domains")
    }
    expect(requests).toHaveLength(0)
  })
})

describe("cloudflareWorkersRead: route and domain errors", () => {
  for (const method of ["routes", "domains"] as const) {
    test(`${method}: refuses another account's zone before reading anything else`, async () => {
      const { tool, requests } = toolFor({
        method: "GET",
        path: ZONE_PATH,
        reply: ok({ ...SAMPLE_ZONE, account: { id: OTHER_ACCOUNT_ID } }),
      })
      expect(errorOf(await rejection(invoke(tool, { method, zone: ZONE_ID }, CTX)))).toEqual({
        code: "not_found",
        message: `Zone ${ZONE_ID} is not in the Cloudflare account default.`,
      })
      expect(requests).toHaveLength(1)
    })

    test(`${method}: a non-array result is upstream_error`, async () => {
      for (const result of [null, {}, "odd"]) {
        const { tool } = toolFor(ZONE_ROUTE, {
          method: "GET",
          path: method === "routes" ? ROUTES_PATH : DOMAINS_PATH,
          reply: ok(result),
        })
        expect(errorOf(await rejection(invoke(tool, { method, zone: ZONE_ID }, CTX))).code).toBe("upstream_error")
      }
    })

    test(`${method}: rejects an invalid script filter without requesting`, async () => {
      const { tool, requests } = toolFor()
      expect(await refusalOf(invoke(tool, { method, zone: ZONE_ID, script: "Invalid" }, CTX))).toContain("`script`")
      expect(requests).toHaveLength(0)
    })
  }
})
