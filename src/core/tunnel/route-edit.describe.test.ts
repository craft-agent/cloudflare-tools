import { describe, expect, test } from "bun:test"
import { fail, ok, type FakeRoute } from "../cloudflare/testing"
import { callDescription } from "../describe"
import { describing, refusing } from "../describe.fixtures"
import type { ErrorCode } from "../errors"
import {
  A_RECORD,
  ACCESS_PATH,
  accessRoute,
  API_RULE,
  CATCH_ALL,
  CONFIG,
  configRoute,
  CTX,
  editFor,
  HOSTNAME,
  PUBLISHED_CONFIG,
  publishedRoute,
  PUBLISHED_RULE,
  RECORDS_PATH,
  recordsRoute,
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

const NEW_SERVICE = "http://localhost:9090"
const ARGS = { tunnel: TUNNEL_ID, hostname: HOSTNAME, service: NEW_SERVICE, replaces: SERVICE }

const HEADLINE = {
  text: "About to change where the tunnel {tunnel} sends {hostname}",
  values: { hostname: HOSTNAME, tunnel: TUNNEL_NAME },
}
const ACCESS_NONE = {
  label: "Access",
  value: { text: "none: anyone on the internet can reach it unless something else stops them" },
}
const CHANGES = { label: "Changes", body: `service: ${SERVICE} → ${NEW_SERVICE}` }
const DNS_MISSING = { label: "DNS", value: { text: "the hostname does not reach the tunnel" } }

describe("cloudflareTunnelRouteEdit: describe", () => {
  test("states its intent", () => {
    expect(editFor().tool.intent).toBe("About to change where a tunnel sends a hostname")
  })

  test("names the hostname and the tunnel, says Access covers nothing and the service change, and writes nothing", async () => {
    const { tool, requests } = editFor()

    const { description, asked } = await describing(tool, ARGS)

    expect(description).toEqual({
      headline: HEADLINE,
      facts: [ACCESS_NONE],
      text: CHANGES,
      pins: { configuration: expect.any(String) },
    })
    expect(asked).toEqual([])
    expect(writes(requests)).toEqual([])
  })

  test("reads what execute reads before it asks, in the same order", async () => {
    const { tool, requests } = editFor()

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
    const { tool } = editFor()

    const { description } = await describing(tool, ARGS)

    expect(JSON.parse(description.pins!.configuration!)).toEqual({
      version: VERSION,
      config: { ...CONFIG, ingress: PUBLISHED_CONFIG.ingress },
    })
  })

  test("names the tunnel by its id when it has no name", async () => {
    const { tool } = editFor(tunnelRoute(ok({ ...TUNNEL_ENTRY, name: null })))

    const { description } = await describing(tool, { ...ARGS, hostname: ` ${HOSTNAME.toUpperCase()}. ` })

    expect(description.headline!.values).toEqual({ hostname: HOSTNAME, tunnel: TUNNEL_ID })
  })

  test("shows the path of the rule when there is one", async () => {
    const withPath = { hostname: HOSTNAME, path: "^/a", service: SERVICE }
    const { tool } = editFor(publishedRoute([API_RULE, withPath, CATCH_ALL]))

    const { description } = await describing(tool, { ...ARGS, path: "^/a" })

    expect(description.facts).toEqual([ACCESS_NONE, { label: "Path", value: "^/a" }])
  })

  test.each([
    ["no record", ok([])],
    ["another record", ok([A_RECORD])],
  ])("says the hostname does not reach the tunnel when it has %s", async (_what, records) => {
    const { tool } = editFor(recordsRoute(records))

    const { description } = await describing(tool, ARGS)

    expect(description.facts).toEqual([ACCESS_NONE, DNS_MISSING])
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
    const { tool } = editFor(route)

    const { description } = await describing(tool, ARGS)

    expect(description.facts).toEqual([{ label: "Access", value: { text } }])
  })

  test("pins change when the configuration changes elsewhere, though the prompt shows the same", async () => {
    const base = await describing(editFor().tool, ARGS)
    const otherRule = await describing(
      editFor(publishedRoute([{ ...API_RULE, service: "http://localhost:1" }, PUBLISHED_RULE, CATCH_ALL])).tool,
      ARGS,
    )
    const version = await describing(
      editFor(configRoute(ok({ version: VERSION + 1, config: PUBLISHED_CONFIG }))).tool,
      ARGS,
    )

    expect({ ...otherRule.description, pins: undefined }).toEqual({ ...base.description, pins: undefined })
    expect({ ...version.description, pins: undefined }).toEqual({ ...base.description, pins: undefined })
    expect(otherRule.description.pins).not.toEqual(base.description.pins)
    expect(version.description.pins).not.toEqual(base.description.pins)
  })

  test("gives the same description twice for the same state", async () => {
    const { tool } = editFor()

    const first = await describing(tool, ARGS)
    const second = await describing(tool, ARGS)

    expect(second.description).toEqual(first.description)
  })

  test("is accepted by the description check", async () => {
    const { tool } = editFor()

    const answer = await callDescription(tool, ARGS, CTX)

    expect(answer?.headline).toEqual(HEADLINE)
    expect(answer?.text).toEqual(CHANGES)
    expect(answer?.pins?.configuration).toBeDefined()
  })
})

describe("cloudflareTunnelRouteEdit: describe refuses where execute would", () => {
  test.each<[string, object, FakeRoute[], ErrorCode, string]>([
    [
      "a locally managed tunnel",
      ARGS,
      [tunnelRoute(ok({ ...TUNNEL_ENTRY, config_src: "local" }))],
      "invalid_argument",
      "is managed in a config file on the machine that runs it",
    ],
    ["a wildcard hostname", { ...ARGS, hostname: "*.example.com" }, [], "invalid_argument", "a wildcard `*`"],
    ["a hostname in no zone of the account", { ...ARGS, hostname: "app.other.net" }, [], "not_found", "No zone"],
    [
      "a rule the tunnel does not publish",
      { ...ARGS, hostname: "other.example.com" },
      [],
      "not_found",
      "This tunnel does not publish other.example.com",
    ],
    [
      "a rule that goes elsewhere than `replaces` says",
      { ...ARGS, replaces: "http://localhost:7000" },
      [],
      "stale",
      `now goes to ${SERVICE}, not http://localhost:7000`,
    ],
    [
      "the service the rule goes to already",
      { ...ARGS, service: SERVICE },
      [],
      "invalid_argument",
      `already goes to ${SERVICE}`,
    ],
  ])("throws for %s, and writes and asks nothing", async (_what, args, routes, code, message) => {
    const { tool, requests } = editFor(...routes)

    const { error, asked } = await refusing(tool, args)

    expect(error.code).toBe(code)
    expect(error.message).toContain(message)
    expect(asked).toEqual([])
    expect(writes(requests)).toEqual([])
  })

  test("gives nothing to the description check for a call execute would refuse", async () => {
    const { tool } = editFor()

    expect(await callDescription(tool, { ...ARGS, replaces: "http://localhost:7000" }, CTX)).toBeUndefined()
  })
})
