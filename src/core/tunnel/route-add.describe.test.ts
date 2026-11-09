import { describe, expect, test } from "bun:test"
import { fail, ok, type FakeRoute } from "../cloudflare/testing"
import { callDescription } from "../describe"
import { describing, refusing } from "../describe.fixtures"
import type { ErrorCode } from "../errors"
import {
  A_RECORD,
  ACCESS_PATH,
  accessRoute,
  ARGS,
  CATCH_ALL,
  CONFIG,
  configRoute,
  CTX,
  HOSTNAME,
  OWN_CNAME,
  recordsRoute,
  routeFor,
  SERVICE,
  TUNNEL_CONFIG_PATH,
  TUNNEL_ENTRY,
  TUNNEL_ID,
  TUNNEL_NAME,
  TUNNEL_PATH,
  tunnelRoute,
  VERSION,
  writes,
  ZONE_PATH,
  RECORDS_PATH,
} from "./route.fixtures"

const HEADLINE = {
  text: "About to publish {hostname} through the tunnel {tunnel}",
  values: { hostname: HOSTNAME, tunnel: TUNNEL_NAME },
}
const ACCESS_NONE = {
  label: "Access",
  value: { text: "none: anyone on the internet can reach it unless something else stops them" },
}
const SERVICE_FACT = { label: "Service", value: SERVICE }
const DNS_CREATE = { label: "DNS", value: { text: "adds a proxied CNAME to the tunnel" } }

function configWith(...ingress: object[]) {
  return configRoute(ok({ version: VERSION, config: { ingress: [...ingress, CATCH_ALL] } }))
}

describe("cloudflareTunnelRouteAdd: describe", () => {
  test("states its intent", () => {
    expect(routeFor().tool.intent).toBe("About to publish a hostname through a tunnel")
  })

  test("names the hostname and the tunnel, says Access covers nothing, the service and the CNAME it adds, and writes nothing", async () => {
    const { tool, requests } = routeFor()

    const { description, asked } = await describing(tool, ARGS)

    expect(description).toEqual({
      headline: HEADLINE,
      facts: [ACCESS_NONE, SERVICE_FACT, DNS_CREATE],
      pins: { configuration: expect.any(String) },
    })
    expect(asked).toEqual([])
    expect(writes(requests)).toEqual([])
  })

  test("reads what execute reads before it asks, in the same order", async () => {
    const { tool, requests } = routeFor()

    await describing(tool, ARGS)

    expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      `GET ${TUNNEL_PATH}`,
      "GET /zones",
      "GET /zones",
      `GET ${TUNNEL_CONFIG_PATH}`,
      `GET ${ZONE_PATH}`,
      `GET ${RECORDS_PATH}`,
      `GET ${ACCESS_PATH}`,
    ])
  })

  test("pins the configuration as read, version included", async () => {
    const { tool } = routeFor()

    const { description } = await describing(tool, ARGS)

    expect(JSON.parse(description.pins!.configuration!)).toEqual({ version: VERSION, config: CONFIG })
  })

  test("names the hostname as it is normalized and the tunnel by its id when it has no name", async () => {
    const { tool } = routeFor(tunnelRoute(ok({ ...TUNNEL_ENTRY, name: null })))

    const { description } = await describing(tool, { ...ARGS, hostname: ` App.EXAMPLE.com. ` })

    expect(description.headline!.values).toEqual({ hostname: HOSTNAME, tunnel: TUNNEL_ID })
  })

  test("shows the path between the service and the CNAME when there is one", async () => {
    const { tool } = routeFor()

    const { description } = await describing(tool, { ...ARGS, path: "^/admin" })

    expect(description.facts).toEqual([ACCESS_NONE, SERVICE_FACT, { label: "Path", value: "^/admin" }, DNS_CREATE])
  })

  test("keeps the proxied CNAME to the tunnel that is already there", async () => {
    const { tool } = routeFor(recordsRoute(ok([OWN_CNAME])))

    const { description } = await describing(tool, ARGS)

    expect(description.facts.at(-1)).toEqual({
      label: "DNS",
      value: { text: "keeps the CNAME to the tunnel already there" },
    })
  })

  test.each<[string, FakeRoute, string]>([
    [
      "covered",
      accessRoute([{ id: "app-1", name: "Internal", type: "self_hosted", domain: HOSTNAME }]),
      "covered: an Access application covers every path",
    ],
    [
      "partial",
      accessRoute([{ id: "app-1", name: "Internal", type: "self_hosted", domain: `${HOSTNAME}/admin` }]),
      "partial: an Access application covers some paths",
    ],
    [
      "none",
      accessRoute([{ id: "app-1", name: "Elsewhere", type: "self_hosted", domain: "other.example.com" }]),
      "none: anyone on the internet can reach it unless something else stops them",
    ],
    [
      "unknown",
      { method: "GET", path: ACCESS_PATH, reply: fail(403, [{ code: 10000, message: "Authentication error" }]) },
      "unknown: the Access applications could not be read",
    ],
  ])("says Access coverage is %s", async (_status, route, text) => {
    const { tool } = routeFor(route)

    const { description } = await describing(tool, ARGS)

    expect(description.facts[0]).toEqual({ label: "Access", value: { text } })
  })

  test("pins change when the configuration changes elsewhere, though the prompt shows the same", async () => {
    const base = await describing(routeFor().tool, ARGS)
    const otherRule = await describing(
      routeFor(configWith({ hostname: "api.example.com", service: "http://localhost:3000" })).tool,
      ARGS,
    )
    const version = await describing(routeFor(configRoute(ok({ version: VERSION + 1, config: CONFIG }))).tool, ARGS)

    expect({ ...otherRule.description, pins: undefined }).toEqual({ ...base.description, pins: undefined })
    expect({ ...version.description, pins: undefined }).toEqual({ ...base.description, pins: undefined })
    expect(otherRule.description.pins).not.toEqual(base.description.pins)
    expect(version.description.pins).not.toEqual(base.description.pins)
  })

  test("gives the same description twice for the same state", async () => {
    const { tool } = routeFor()

    const first = await describing(tool, ARGS)
    const second = await describing(tool, ARGS)

    expect(second.description).toEqual(first.description)
  })

  test("is accepted by the description check", async () => {
    const { tool } = routeFor()

    const answer = await callDescription(tool, ARGS, CTX)

    expect(answer?.headline).toEqual(HEADLINE)
    expect(answer?.facts).toHaveLength(3)
    expect(answer?.pins?.configuration).toBeDefined()
  })
})

describe("cloudflareTunnelRouteAdd: describe refuses where execute would", () => {
  const EXISTING = { hostname: HOSTNAME, service: "http://localhost:9" }

  test.each<[string, object, FakeRoute[], ErrorCode, string]>([
    [
      "a locally managed tunnel",
      ARGS,
      [tunnelRoute(ok({ ...TUNNEL_ENTRY, config_src: "local" }))],
      "invalid_argument",
      "is managed in a config file on the machine that runs it",
    ],
    [
      "a tunnel that does not exist",
      ARGS,
      [tunnelRoute(fail(404, [{ code: 1003, message: "Tunnel not found" }]))],
      "not_found",
      "Tunnel not found",
    ],
    ["a wildcard hostname", { ...ARGS, hostname: "*.example.com" }, [], "invalid_argument", "a wildcard `*`"],
    ["a hostname in no zone of the account", { ...ARGS, hostname: "app.other.net" }, [], "not_found", "No zone"],
    ["a rule that is already there", ARGS, [configWith(EXISTING)], "invalid_argument", "is already published"],
    [
      "a rule hidden by an earlier rule without a path",
      { ...ARGS, path: "^/a" },
      [configWith(EXISTING)],
      "invalid_argument",
      "without a path comes first",
    ],
    [
      "a hostname with another DNS record",
      ARGS,
      [recordsRoute(ok([A_RECORD]))],
      "invalid_argument",
      `${HOSTNAME} already has DNS records`,
    ],
  ])("throws for %s, and writes and asks nothing", async (_what, args, routes, code, message) => {
    const { tool, requests } = routeFor(...routes)

    const { error, asked } = await refusing(tool, args)

    expect(error.code).toBe(code)
    expect(error.message).toContain(message)
    expect(asked).toEqual([])
    expect(writes(requests)).toEqual([])
  })

  test("gives nothing to the description check for a call execute would refuse", async () => {
    const { tool } = routeFor(configWith(EXISTING))

    expect(await callDescription(tool, ARGS, CTX)).toBeUndefined()
  })
})
