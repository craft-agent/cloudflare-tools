import { describe, expect, test } from "bun:test"
import { fail, ok } from "../cloudflare/testing"
import { writeTargets } from "../targets"
import { annotations, invoke, REQUIRES_USER_INTERACTION, toolMeta, type ConfirmRequest } from "../tool"
import { SAMPLE_ZONE } from "../zone/fixtures"
import { cloudflareTunnelRouteAdd } from "./route-add"
import {
  ACCESS_PATH,
  API_RULE,
  ARGS,
  BATCH_PATH,
  CATCH_ALL,
  CONFIG,
  CTX,
  DNS_TARGET,
  HOSTNAME,
  NEW_RULE,
  OWN_CNAME,
  RECORDS_PATH,
  ROUTE_TARGET,
  SERVICE,
  SHAPED_OWN_CNAME,
  TARGET,
  TUNNEL_CONFIG_PATH,
  TUNNEL_ENTRY,
  TUNNEL_ID,
  TUNNEL_NAME,
  TUNNEL_PATH,
  ZONE_ID,
  ZONE_PATH,
  accessRoute,
  configRoute,
  recordsRoute,
  routeFor,
  sent,
  tunnelRoute,
} from "./route.fixtures"

describe("cloudflareTunnelRouteAdd", () => {
  test("is an administrative tool of the tunnels toolset that needs the person's attention", () => {
    expect(cloudflareTunnelRouteAdd.id).toBe("cloudflare_tunnel_route_add")
    expect(cloudflareTunnelRouteAdd.toolset).toBe("tunnels")
    expect(annotations(cloudflareTunnelRouteAdd)).toEqual({
      title: "Publish a hostname through a Cloudflare Tunnel",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    })
    expect(toolMeta(cloudflareTunnelRouteAdd)).toEqual({ [REQUIRES_USER_INTERACTION]: true })
    for (const text of [
      "just before its catch-all",
      "proxied CNAME",
      "locally managed tunnel",
      "hello_world works only on locally managed tunnels",
      "Zero Trust Access application",
      "ask who should reach it first",
      "sent back whole",
      "nothing is undone",
      "cloudflare_dns_record_add call",
      "Account → Cloudflare One Connector: cloudflared → Edit and Zone → DNS → Edit",
      "Access: Apps and Policies → Read",
    ]) {
      expect(cloudflareTunnelRouteAdd.description).toContain(text)
    }
  })

  test("reads everything first, then writes the configuration and adds the CNAME, in that order", async () => {
    const { tool, requests } = routeFor()

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
      `POST ${BATCH_PATH}`,
    ])
    expect(requests.slice(1, 3).map((request) => request.query.get("name"))).toEqual([HOSTNAME, "example.com"])
    expect(result).toEqual({
      label: "default",
      tunnel: { id: TUNNEL_ID, name: TUNNEL_NAME },
      zone: { id: ZONE_ID, name: SAMPLE_ZONE.name },
      rule: { before: null, after: { hostname: HOSTNAME, path: null, service: SERVICE } },
      dns: { created: SHAPED_OWN_CNAME },
      access: { status: "none", apps: [] },
    })
  })

  test("sends the configuration whole with the new rule just before the catch-all, and a proxied CNAME", async () => {
    const { tool, requests } = routeFor()

    await invoke(tool, ARGS, CTX)

    const [put] = sent(requests, "PUT")
    expect(put!.body).toEqual({ config: { ...CONFIG, ingress: [API_RULE, NEW_RULE, CATCH_ALL] } })
    const [post] = sent(requests, "POST")
    expect(post!.body).toEqual({
      posts: [{ type: "CNAME", name: HOSTNAME, content: TARGET, proxied: true, ttl: 1, comment: "Cloudflare Tunnel" }],
    })
  })

  test("sends the path when there is one, and the normalized hostname", async () => {
    const { tool, requests } = routeFor()

    const result = await invoke(tool, { ...ARGS, hostname: ` App.EXAMPLE.com. `, path: "^/admin" }, CTX)

    const [put] = sent(requests, "PUT")
    const rule = { ...NEW_RULE, path: "^/admin" }
    expect(put!.body).toEqual({ config: { ...CONFIG, ingress: [API_RULE, rule, CATCH_ALL] } })
    expect(result.rule.after).toEqual({ hostname: HOSTNAME, path: "^/admin", service: SERVICE })
  })

  test("appends the rule and a 404 catch-all when the configuration has no catch-all", async () => {
    const config = { ingress: [API_RULE] }
    const { tool, requests } = routeFor(configRoute(ok({ version: 3, config })))

    await invoke(tool, ARGS, CTX)

    expect(sent(requests, "PUT")[0]!.body).toEqual({ config: { ingress: [API_RULE, NEW_RULE, CATCH_ALL] } })
  })

  test.each([
    ["a tunnel without a configuration", () => fail(404, [{ code: 1000, message: "No configuration" }])],
    ["an empty configuration", () => ok({ version: 1, config: null })],
    ["a reply that is not an object", () => ok(null)],
  ])("starts from an empty configuration for %s", async (_what, reply) => {
    const { tool, requests } = routeFor(configRoute(reply))

    await invoke(tool, ARGS, CTX)

    expect(sent(requests, "PUT")[0]!.body).toEqual({ config: { ingress: [NEW_RULE, CATCH_ALL] } })
  })

  test("keeps a proxied CNAME to the tunnel that is already there, and adds no record", async () => {
    const { tool, requests } = routeFor(recordsRoute(ok([{ ...OWN_CNAME, content: `${TARGET.toUpperCase()}.` }])))

    const result = await invoke(tool, ARGS, CTX)

    expect(result.dns).toEqual({ kept: { ...SHAPED_OWN_CNAME, content: `${TARGET.toUpperCase()}.` } })
    expect(sent(requests, "POST")).toHaveLength(0)
    expect(sent(requests, "PUT")).toHaveLength(1)
  })

  test("reports the Access application that covers the hostname", async () => {
    const app = { id: "app-1", name: "Internal", type: "self_hosted", domain: HOSTNAME }
    const { tool } = routeFor(accessRoute([app]))

    const result = await invoke(tool, ARGS, CTX)

    expect(result.access).toEqual({
      status: "covered",
      apps: [{ id: "app-1", name: "Internal", destination: HOSTNAME }],
    })
  })

  test("publishes anyway when the Access applications cannot be read, and says the coverage is unknown", async () => {
    const { tool } = routeFor({
      method: "GET",
      path: ACCESS_PATH,
      reply: fail(403, [{ code: 10000, message: "Authentication error" }]),
    })

    const result = await invoke(tool, ARGS, CTX)

    expect(result.access.status).toBe("unknown")
    expect(result.rule.after.hostname).toBe(HOSTNAME)
  })
})

describe("cloudflareTunnelRouteAdd: confirmation", () => {
  async function asked(tool: ReturnType<typeof routeFor>["tool"], args: object): Promise<ConfirmRequest[]> {
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

  test("says in plain words what is published, the CNAME to add and that no Access application covers it", async () => {
    const { tool } = routeFor()

    expect(await asked(tool, ARGS)).toEqual([
      {
        tool: "cloudflare_tunnel_route_add",
        message: `Publish ${HOSTNAME} through tunnel ${TUNNEL_NAME} to ${SERVICE}, and add a proxied CNAME ${HOSTNAME} → ${TARGET}. Access coverage: none. Anyone on the internet can reach it unless something else stops them.`,
      },
    ])
  })

  test("leaves out the CNAME already there, names the path and the tunnel by id when it has no name", async () => {
    const app = { id: "app-1", name: "Internal", type: "self_hosted", domain: HOSTNAME }
    const { tool } = routeFor(
      recordsRoute(ok([OWN_CNAME])),
      accessRoute([app]),
      tunnelRoute(ok({ ...TUNNEL_ENTRY, name: null })),
    )

    const [request] = await asked(tool, { ...ARGS, path: "^/admin" })

    expect(request!.message).toBe(
      `Publish ${HOSTNAME} (path ^/admin) through tunnel ${TUNNEL_ID} to ${SERVICE}. Access coverage: covered.`,
    )
  })
})

describe("cloudflareTunnelRouteAdd: targets", () => {
  test("name the hostname under the tunnel and the DNS record, after finding the zone only", async () => {
    const { tool, requests } = routeFor()

    expect(await writeTargets(tool, { ...ARGS, hostname: `${HOSTNAME.toUpperCase()}.` }, CTX)).toEqual(
      [ROUTE_TARGET, DNS_TARGET].sort(),
    )
    expect(requests.map((request) => request.path)).toEqual(["/zones", "/zones"])
  })

  test.each([
    ["a wildcard", { ...ARGS, hostname: "*.example.com" }],
    ["a name that is not a hostname", { ...ARGS, hostname: "nodot" }],
    ["a hostname in no zone of the account", { ...ARGS, hostname: "app.other.net" }],
    ["a bad tunnel id", { ...ARGS, tunnel: "nope" }],
  ])("are `*` for %s", async (_what, args) => {
    const { tool } = routeFor()

    expect(await writeTargets(tool, args, CTX)).toEqual(["*"])
  })

  test("are `*` when the zone lookup fails", async () => {
    const { tool } = routeFor({ method: "GET", path: "/zones", reply: { status: 500, body: "down" } })

    expect(await writeTargets(tool, ARGS, CTX)).toEqual(["*"])
  })

  test("pass a cancellation on", async () => {
    const controller = new AbortController()
    const { tool } = routeFor({
      method: "GET",
      path: "/zones",
      reply: () => {
        controller.abort()
        return ok([])
      },
    })

    await expect(writeTargets(tool, ARGS, { ...CTX, signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    })
  })
})
