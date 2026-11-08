import { describe, expect, test } from "bun:test"
import { ok } from "../cloudflare/testing"
import { writeTargets } from "../targets"
import { annotations, invoke, REQUIRES_USER_INTERACTION, toolMeta, type ConfirmRequest } from "../tool"
import { cloudflareTunnelRouteEdit } from "./route-edit"
import {
  A_RECORD,
  ACCESS_PATH,
  API_RULE,
  CATCH_ALL,
  CONFIG,
  CTX,
  HOSTNAME,
  OWN_CNAME,
  PUBLISHED_RULE,
  ROUTE_TARGET,
  SERVICE,
  SHAPED_OWN_CNAME,
  TUNNEL_CONFIG_PATH,
  TUNNEL_ENTRY,
  TUNNEL_ID,
  TUNNEL_NAME,
  TUNNEL_PATH,
  ZONE_ID,
  ZONE_PATH,
  RECORDS_PATH,
  accessRoute,
  editFor,
  publishedRoute,
  recordsRoute,
  sent,
  tunnelRoute,
  writes,
} from "./route.fixtures"

const NEW_SERVICE = "http://localhost:9090"
const ARGS = { tunnel: TUNNEL_ID, hostname: HOSTNAME, service: NEW_SERVICE, replaces: SERVICE }

describe("cloudflareTunnelRouteEdit", () => {
  test("is an administrative tool of the tunnels toolset that needs the person's attention", () => {
    expect(cloudflareTunnelRouteEdit.id).toBe("cloudflare_tunnel_route_edit")
    expect(cloudflareTunnelRouteEdit.toolset).toBe("tunnels")
    expect(annotations(cloudflareTunnelRouteEdit)).toEqual({
      title: "Change where a tunnel sends a hostname",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    })
    expect(toolMeta(cloudflareTunnelRouteEdit)).toEqual({ [REQUIRES_USER_INTERACTION]: true })
    for (const text of [
      "`replaces`",
      "refused as stale",
      "Only the rule's service changes",
      "never refuses on DNS",
      "`missing` or `other` does not reach the tunnel",
      "ask who should reach it first",
      "sent back whole",
      "Account → Cloudflare One Connector: cloudflared → Edit, and DNS read access",
    ]) {
      expect(cloudflareTunnelRouteEdit.description).toContain(text)
    }
  })

  test("reads the tunnel, the zone, the configuration and the DNS, then writes only the configuration", async () => {
    const { tool, requests } = editFor()

    const result = await invoke(tool, ARGS, CTX)

    expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      `GET ${TUNNEL_PATH}`,
      "GET /zones",
      "GET /zones",
      `GET ${TUNNEL_CONFIG_PATH}`,
      `GET ${ZONE_PATH}`,
      `GET ${RECORDS_PATH}`,
      `GET ${ACCESS_PATH}`,
      `PUT ${TUNNEL_CONFIG_PATH}`,
    ])
    expect(result).toEqual({
      label: "default",
      tunnel: { id: TUNNEL_ID, name: TUNNEL_NAME },
      zone: { id: ZONE_ID, name: "example.com" },
      rule: {
        before: { hostname: HOSTNAME, path: null, service: SERVICE },
        after: { hostname: HOSTNAME, path: null, service: NEW_SERVICE },
      },
      dns: { kept: SHAPED_OWN_CNAME },
      access: { status: "none", apps: [] },
    })
  })

  test("replaces only the service: every other key of the rule, every other rule and setting stay", async () => {
    const { tool, requests } = editFor()

    await invoke(tool, ARGS, CTX)

    expect(sent(requests, "PUT")[0]!.body).toEqual({
      config: { ...CONFIG, ingress: [API_RULE, { ...PUBLISHED_RULE, service: NEW_SERVICE }, CATCH_ALL] },
    })
  })

  test("finds the rule by its path, and a rule without a path when none is given, whatever the case of the hostname", async () => {
    const withoutPath = { hostname: HOSTNAME.toUpperCase(), service: "http://localhost:1", originRequest: { a: 1 } }
    const withPath = { hostname: HOSTNAME, path: "^/a", service: "http://localhost:2", originRequest: { b: 2 } }
    const ingress = [withPath, withoutPath, CATCH_ALL]

    const byPath = editFor(publishedRoute(ingress))
    await invoke(byPath.tool, { ...ARGS, path: "^/a", replaces: "http://localhost:2" }, CTX)
    const plain = editFor(publishedRoute(ingress))
    const result = await invoke(plain.tool, { ...ARGS, replaces: "http://localhost:1" }, CTX)

    const putIngress = (requests: Parameters<typeof sent>[0]) =>
      (sent(requests, "PUT")[0]!.body as { config: { ingress: unknown[] } }).config.ingress
    expect(putIngress(byPath.requests)).toEqual([{ ...withPath, service: NEW_SERVICE }, withoutPath, CATCH_ALL])
    expect(putIngress(plain.requests)).toEqual([withPath, { ...withoutPath, service: NEW_SERVICE }, CATCH_ALL])
    expect(result.rule.after.path).toBeNull()
  })

  test("names the path in the result", async () => {
    const withPath = { hostname: HOSTNAME, path: "^/a", service: SERVICE }
    const { tool } = editFor(publishedRoute([withPath, CATCH_ALL]))

    const result = await invoke(tool, { ...ARGS, path: "^/a" }, CTX)

    expect(result.rule.before).toEqual({ hostname: HOSTNAME, path: "^/a", service: SERVICE })
    expect(result.rule.after).toEqual({ hostname: HOSTNAME, path: "^/a", service: NEW_SERVICE })
  })
})

describe("cloudflareTunnelRouteEdit: what it reports", () => {
  test("says the hostname has no DNS record, and still changes the rule", async () => {
    const { tool, requests } = editFor(recordsRoute(ok([])))

    const result = await invoke(tool, ARGS, CTX)

    expect(result.dns).toEqual({ missing: true })
    expect(sent(requests, "PUT")).toHaveLength(1)
  })

  test.each([
    ["a record of another kind", [A_RECORD]],
    ["a CNAME to the tunnel that is not proxied", [{ ...OWN_CNAME, proxied: false }]],
    ["several records", [OWN_CNAME, A_RECORD]],
  ])("lists the records when the hostname has %s, and still changes the rule", async (_what, records) => {
    const { tool, requests } = editFor(recordsRoute(ok(records)))

    const result = await invoke(tool, ARGS, CTX)

    expect(result.dns.other).toHaveLength(records.length)
    expect(result.dns.kept).toBeUndefined()
    expect(sent(requests, "PUT")).toHaveLength(1)
    expect(writes(requests)).toHaveLength(1)
  })

  test("lists five records at most", async () => {
    const records = Array.from({ length: 7 }, (_, index) => ({ ...A_RECORD, id: `${index}`.repeat(32) }))
    const { tool } = editFor(recordsRoute(ok(records)))

    const result = await invoke(tool, ARGS, CTX)

    expect(result.dns.other).toHaveLength(5)
  })

  test("reports the Access application that covers the hostname", async () => {
    const app = { id: "app-1", name: "Internal", type: "self_hosted", domain: HOSTNAME }
    const { tool } = editFor(accessRoute([app]))

    const result = await invoke(tool, ARGS, CTX)

    expect(result.access).toEqual({
      status: "covered",
      apps: [{ id: "app-1", name: "Internal", destination: HOSTNAME }],
    })
  })
})

describe("cloudflareTunnelRouteEdit: confirmation and targets", () => {
  async function asked(tool: ReturnType<typeof editFor>["tool"], args: object): Promise<ConfirmRequest[]> {
    const requests: ConfirmRequest[] = []
    await invoke(tool, args, {
      ...CTX,
      confirm: async (request) => {
        requests.push(request)
        return true
      },
    })
    return requests
  }

  test("says in plain words where the hostname goes now and before, and that no Access application covers it", async () => {
    const { tool } = editFor()

    expect(await asked(tool, ARGS)).toEqual([
      {
        tool: "cloudflare_tunnel_route_edit",
        message: `Send ${HOSTNAME} through tunnel ${TUNNEL_NAME} to ${NEW_SERVICE} instead of ${SERVICE}. Access coverage: none. Anyone on the internet can reach it unless something else stops them.`,
      },
    ])
  })

  test("names the path, and the tunnel by id when it has no name; says nothing of exposure when covered", async () => {
    const app = { id: "app-1", name: "Internal", type: "self_hosted", domain: HOSTNAME }
    const withPath = { hostname: HOSTNAME, path: "^/a", service: SERVICE }
    const { tool } = editFor(
      publishedRoute([withPath, CATCH_ALL]),
      accessRoute([app]),
      tunnelRoute(ok({ ...TUNNEL_ENTRY, name: null })),
    )

    const [request] = await asked(tool, { ...ARGS, path: "^/a" })

    expect(request!.message).toBe(
      `Send ${HOSTNAME} (path ^/a) through tunnel ${TUNNEL_ID} to ${NEW_SERVICE} instead of ${SERVICE}. Access coverage: covered.`,
    )
  })

  test("targets name the hostname under the tunnel only, with no request", async () => {
    const { tool, requests } = editFor()

    expect(await writeTargets(tool, { ...ARGS, hostname: `${HOSTNAME.toUpperCase()}.` }, CTX)).toEqual([ROUTE_TARGET])
    expect(requests).toEqual([])
  })

  test.each([
    ["a wildcard", { ...ARGS, hostname: "*.example.com" }],
    ["a name that is not a hostname", { ...ARGS, hostname: "nodot" }],
    ["a bad tunnel id", { ...ARGS, tunnel: "nope" }],
    ["a service that is not allowed", { ...ARGS, service: "hello_world" }],
  ])("targets are `*` for %s", async (_what, args) => {
    const { tool } = editFor()

    expect(await writeTargets(tool, args, CTX)).toEqual(["*"])
  })
})
