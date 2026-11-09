import { describe, expect, test } from "bun:test"
import { fail, ok, type FakeRoute } from "../cloudflare/testing"
import { callDescription } from "../describe"
import { describing, refusing } from "../describe.fixtures"
import type { ErrorCode } from "../errors"
import {
  A_RECORD,
  ACCESS_PATH,
  API_RULE,
  CATCH_ALL,
  CONFIG,
  configRoute,
  CTX,
  HOSTNAME,
  PUBLISHED_CONFIG,
  publishedRoute,
  PUBLISHED_RULE,
  RECORDS_PATH,
  recordsRoute,
  removeFor,
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
} from "./route.fixtures"

const ARGS = { tunnel: TUNNEL_ID, hostname: HOSTNAME }
const OTHER_PATH_RULE = { hostname: HOSTNAME, path: "^/a", service: "http://localhost:2" }

const HEADLINE = {
  text: "About to withdraw {hostname} from the tunnel {tunnel}",
  values: { hostname: HOSTNAME, tunnel: TUNNEL_NAME },
}
const SERVICE_FACT = { label: "Service", value: SERVICE }
const EFFECT = { label: "Effect", value: { text: "visitors stop reaching the service at once" } }

/** The DNS fact with its value. */
function dns(text: string) {
  return { label: "DNS", value: { text } }
}

describe("cloudflareTunnelRouteRemove: describe", () => {
  test("states its intent", () => {
    expect(removeFor().tool.intent).toBe("About to withdraw a hostname from a tunnel")
  })

  test("names the hostname and the tunnel, the service it sent to and the CNAME it deletes, and writes nothing", async () => {
    const { tool, requests } = removeFor()

    const { description, asked } = await describing(tool, ARGS)

    expect(description).toEqual({
      headline: HEADLINE,
      facts: [SERVICE_FACT, dns("deletes the proxied CNAME to the tunnel"), EFFECT],
      pins: { configuration: expect.any(String) },
    })
    expect(asked).toEqual([])
    expect(writes(requests)).toEqual([])
  })

  test("reads what execute reads before it asks, in the same order, and no Access application", async () => {
    const { tool, requests } = removeFor()

    await describing(tool, ARGS)

    expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      `GET ${TUNNEL_PATH}`,
      "GET /zones",
      "GET /zones",
      `GET ${TUNNEL_CONFIG_PATH}`,
      `GET ${ZONE_PATH}`,
      `GET ${RECORDS_PATH}`,
    ])
    expect(requests.some((request) => request.path === ACCESS_PATH)).toBe(false)
  })

  test("pins the configuration as read, version included", async () => {
    const { tool } = removeFor()

    const { description } = await describing(tool, ARGS)

    expect(JSON.parse(description.pins!.configuration!)).toEqual({
      version: VERSION,
      config: { ...CONFIG, ingress: PUBLISHED_CONFIG.ingress },
    })
  })

  test("names the tunnel by its id when it has no name", async () => {
    const { tool } = removeFor(tunnelRoute(ok({ ...TUNNEL_ENTRY, name: null })))

    const { description } = await describing(tool, { ...ARGS, hostname: ` ${HOSTNAME.toUpperCase()}. ` })

    expect(description.headline!.values).toEqual({ hostname: HOSTNAME, tunnel: TUNNEL_ID })
  })

  test("shows the path of the rule when there is one, between the service and the CNAME", async () => {
    const { tool } = removeFor(publishedRoute([PUBLISHED_RULE, OTHER_PATH_RULE, CATCH_ALL]))

    const { description } = await describing(tool, { ...ARGS, path: "^/a" })

    expect(description.facts).toEqual([
      { label: "Service", value: "http://localhost:2" },
      { label: "Path", value: "^/a" },
      dns("keeps the CNAME: another rule still uses the hostname"),
      EFFECT,
    ])
  })

  test("leaves out the service of a rule that has none", async () => {
    const { tool } = removeFor(publishedRoute([API_RULE, { hostname: HOSTNAME }, CATCH_ALL]))

    const { description } = await describing(tool, ARGS)

    expect(description.facts.map((fact) => fact.label)).toEqual(["DNS", "Effect"])
  })

  test.each([
    ["the rule without a path stays", { ...ARGS, path: "^/a" }, [PUBLISHED_RULE, OTHER_PATH_RULE]],
    ["a rule with a path stays", ARGS, [PUBLISHED_RULE, OTHER_PATH_RULE]],
  ])("keeps the CNAME when %s", async (_what, args, rules) => {
    const { tool } = removeFor(publishedRoute([...rules, CATCH_ALL]))

    const { description } = await describing(tool, args)

    expect(description.facts.find((fact) => fact.label === "DNS")).toEqual(
      dns("keeps the CNAME: another rule still uses the hostname"),
    )
  })

  test.each([
    ["no record", ok([])],
    ["another record", ok([A_RECORD])],
  ])("leaves the records alone when the hostname has %s", async (_what, records) => {
    const { tool } = removeFor(recordsRoute(records))

    const { description } = await describing(tool, ARGS)

    expect(description.facts).toEqual([SERVICE_FACT, dns("leaves the hostname's records as they are"), EFFECT])
  })

  test("pins change when the configuration changes elsewhere, though the prompt shows the same", async () => {
    const base = await describing(removeFor().tool, ARGS)
    const otherRule = await describing(
      removeFor(publishedRoute([{ ...API_RULE, service: "http://localhost:1" }, PUBLISHED_RULE, CATCH_ALL])).tool,
      ARGS,
    )
    const version = await describing(
      removeFor(configRoute(ok({ version: VERSION + 1, config: PUBLISHED_CONFIG }))).tool,
      ARGS,
    )

    expect({ ...otherRule.description, pins: undefined }).toEqual({ ...base.description, pins: undefined })
    expect({ ...version.description, pins: undefined }).toEqual({ ...base.description, pins: undefined })
    expect(otherRule.description.pins).not.toEqual(base.description.pins)
    expect(version.description.pins).not.toEqual(base.description.pins)
  })

  test("gives the same description twice for the same state", async () => {
    const { tool } = removeFor()

    const first = await describing(tool, ARGS)
    const second = await describing(tool, ARGS)

    expect(second.description).toEqual(first.description)
  })

  test("is accepted by the description check", async () => {
    const { tool } = removeFor()

    const answer = await callDescription(tool, ARGS, CTX)

    expect(answer?.headline).toEqual(HEADLINE)
    expect(answer?.facts).toHaveLength(3)
    expect(answer?.pins?.configuration).toBeDefined()
  })
})

describe("cloudflareTunnelRouteRemove: describe refuses where execute would", () => {
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
    [
      "a rule the tunnel does not publish",
      { ...ARGS, path: "^/a" },
      [],
      "not_found",
      `This tunnel does not publish ${HOSTNAME} (path ^/a)`,
    ],
  ])("throws for %s, and writes and asks nothing", async (_what, args, routes, code, message) => {
    const { tool, requests } = removeFor(...routes)

    const { error, asked } = await refusing(tool, args)

    expect(error.code).toBe(code)
    expect(error.message).toContain(message)
    expect(asked).toEqual([])
    expect(writes(requests)).toEqual([])
  })

  test("gives nothing to the description check for a call execute would refuse", async () => {
    const { tool } = removeFor()

    expect(await callDescription(tool, { ...ARGS, hostname: "other.example.com" }, CTX)).toBeUndefined()
  })
})
