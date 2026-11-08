import { describe, expect, test } from "bun:test"
import { ok } from "../cloudflare/testing"
import { writeTargets } from "../targets"
import { annotations, invoke, REQUIRES_USER_INTERACTION, toolMeta, type ConfirmRequest } from "../tool"
import { cloudflareTunnelRouteRemove } from "./route-remove"
import {
  A_RECORD,
  ACCESS_PATH,
  API_RULE,
  ARGS as ADD_ARGS,
  BATCH_PATH,
  CATCH_ALL,
  CONFIG,
  CTX,
  DNS_TARGET,
  HOSTNAME,
  OWN_CNAME,
  PUBLISHED_RULE,
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
  publishedRoute,
  recordsRoute,
  removeFor,
  sent,
  tunnelRoute,
  writes,
} from "./route.fixtures"

const ARGS = { tunnel: ADD_ARGS.tunnel, hostname: HOSTNAME }
const OTHER_PATH_RULE = { hostname: HOSTNAME, path: "^/a", service: "http://localhost:2" }

/** The ingress the PUT sent. */
function putIngress(requests: Parameters<typeof sent>[0]): unknown[] {
  return (sent(requests, "PUT")[0]!.body as { config: { ingress: unknown[] } }).config.ingress
}

describe("cloudflareTunnelRouteRemove", () => {
  test("is an administrative tool of the tunnels toolset that needs the person's attention", () => {
    expect(cloudflareTunnelRouteRemove.id).toBe("cloudflare_tunnel_route_remove")
    expect(cloudflareTunnelRouteRemove.toolset).toBe("tunnels")
    expect(annotations(cloudflareTunnelRouteRemove)).toEqual({
      title: "Withdraw a hostname from a Cloudflare Tunnel",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    })
    expect(toolMeta(cloudflareTunnelRouteRemove)).toEqual({ [REQUIRES_USER_INTERACTION]: true })
    for (const text of [
      "another rule",
      "never touched",
      "`other`",
      "`missing`",
      "always ends with a catch-all",
      "locally managed tunnel is refused",
      "sent back whole",
      "nothing is undone",
      "cloudflare_dns_record_delete call",
      "Account → Cloudflare Tunnel → Edit and Zone → DNS → Edit",
    ]) {
      expect(cloudflareTunnelRouteRemove.description).toContain(text)
    }
  })

  test("writes the configuration first, then deletes the CNAME, and reads no Access application", async () => {
    const { tool, requests } = removeFor()

    const result = await invoke(tool, ARGS, CTX)

    expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      `GET ${TUNNEL_PATH}`,
      "GET /zones",
      "GET /zones",
      `GET ${TUNNEL_CONFIG_PATH}`,
      `GET ${ZONE_PATH}`,
      `GET ${RECORDS_PATH}`,
      `PUT ${TUNNEL_CONFIG_PATH}`,
      `POST ${BATCH_PATH}`,
    ])
    expect(requests.some((request) => request.path === ACCESS_PATH)).toBe(false)
    expect(sent(requests, "POST")[0]!.body).toEqual({ deletes: [{ id: OWN_CNAME.id }] })
    expect(result).toEqual({
      label: "default",
      tunnel: { id: TUNNEL_ID, name: TUNNEL_NAME },
      zone: { id: ZONE_ID, name: "example.com" },
      rule: { before: { hostname: HOSTNAME, path: null, service: SERVICE }, after: null },
      dns: { deleted: SHAPED_OWN_CNAME },
    })
  })

  test("drops exactly that rule and keeps every other rule and setting", async () => {
    const { tool, requests } = removeFor()

    await invoke(tool, ARGS, CTX)

    expect(sent(requests, "PUT")[0]!.body).toEqual({ config: { ...CONFIG, ingress: [API_RULE, CATCH_ALL] } })
  })

  test("finds the rule by its path, whatever the case of the hostname, and names the path in the result", async () => {
    const upper = { ...OTHER_PATH_RULE, hostname: HOSTNAME.toUpperCase() }
    const { tool, requests } = removeFor(publishedRoute([PUBLISHED_RULE, upper, CATCH_ALL]))

    const result = await invoke(tool, { ...ARGS, path: "^/a" }, CTX)

    expect(putIngress(requests)).toEqual([PUBLISHED_RULE, CATCH_ALL])
    expect(result.rule.before).toEqual({ hostname: HOSTNAME, path: "^/a", service: "http://localhost:2" })
    expect(sent(requests, "POST")).toHaveLength(0)
  })
})

describe("cloudflareTunnelRouteRemove: the DNS", () => {
  test.each([
    ["with a path, while the rule without a path remains", { ...ARGS, path: "^/a" }, [PUBLISHED_RULE, OTHER_PATH_RULE]],
    ["without a path, while a rule with a path remains", ARGS, [PUBLISHED_RULE, OTHER_PATH_RULE]],
  ])("keeps the CNAME when the rule goes %s", async (_what, args, rules) => {
    const { tool, requests } = removeFor(publishedRoute([...rules, CATCH_ALL]))

    const result = await invoke(tool, args, CTX)

    expect(result.dns).toEqual({ kept: SHAPED_OWN_CNAME })
    expect(sent(requests, "POST")).toHaveLength(0)
    expect(sent(requests, "PUT")).toHaveLength(1)
  })

  test("leaves a hostname without a DNS record alone and says so", async () => {
    const { tool, requests } = removeFor(recordsRoute(ok([])))

    const result = await invoke(tool, ARGS, CTX)

    expect(result.dns).toEqual({ missing: true })
    expect(sent(requests, "POST")).toHaveLength(0)
    expect(sent(requests, "PUT")).toHaveLength(1)
  })

  test.each([
    ["a record of another kind", [A_RECORD]],
    ["a CNAME to the tunnel that is not proxied", [{ ...OWN_CNAME, proxied: false }]],
    ["a CNAME elsewhere", [{ ...OWN_CNAME, content: "elsewhere.example.net" }]],
    ["several records", [OWN_CNAME, A_RECORD]],
  ])("never touches %s, and lists it", async (_what, records) => {
    const { tool, requests } = removeFor(recordsRoute(ok(records)))

    const result = await invoke(tool, ARGS, CTX)

    expect(result.dns.other).toHaveLength(records.length)
    expect(result.dns.deleted).toBeUndefined()
    expect(sent(requests, "POST")).toHaveLength(0)
    expect(sent(requests, "PUT")).toHaveLength(1)
  })

  test("lists five records at most", async () => {
    const records = Array.from({ length: 7 }, (_, index) => ({ ...A_RECORD, id: `${index}`.repeat(32) }))
    const { tool } = removeFor(recordsRoute(ok(records)))

    expect((await invoke(tool, ARGS, CTX)).dns.other).toHaveLength(5)
  })
})

describe("cloudflareTunnelRouteRemove: what remains of the ingress", () => {
  test.each([
    ["only the catch-all is left", [PUBLISHED_RULE, CATCH_ALL], [CATCH_ALL]],
    ["nothing is left, there being no catch-all", [PUBLISHED_RULE], [CATCH_ALL]],
    ["the last rule has a hostname and a path", [API_RULE, PUBLISHED_RULE], [API_RULE, CATCH_ALL]],
    ["a rule and the catch-all are left", [PUBLISHED_RULE, API_RULE, CATCH_ALL], [API_RULE, CATCH_ALL]],
  ])("ends with a catch-all when %s", async (_what, ingress, expected) => {
    const { tool, requests } = removeFor(publishedRoute(ingress))

    await invoke(tool, ARGS, CTX)

    expect(putIngress(requests)).toEqual(expected)
  })

  test("keeps a catch-all of its own when it has a service other than 404", async () => {
    const ownCatchAll = { service: "http://localhost:3000" }
    const { tool, requests } = removeFor(publishedRoute([PUBLISHED_RULE, ownCatchAll]))

    await invoke(tool, ARGS, CTX)

    expect(putIngress(requests)).toEqual([ownCatchAll])
  })
})

describe("cloudflareTunnelRouteRemove: confirmation and targets", () => {
  async function asked(tool: ReturnType<typeof removeFor>["tool"], args: object): Promise<ConfirmRequest[]> {
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

  test("says in plain words what is withdrawn and which CNAME is deleted", async () => {
    const { tool } = removeFor()

    expect(await asked(tool, ARGS)).toEqual([
      {
        tool: "cloudflare_tunnel_route_remove",
        message: `Withdraw ${HOSTNAME} from tunnel ${TUNNEL_NAME} (it sent it to ${SERVICE}), and delete the CNAME ${HOSTNAME} → ${TARGET}.`,
      },
    ])
  })

  test("leaves out the CNAME clause when none is deleted, and names the path and a nameless tunnel by id", async () => {
    const { tool } = removeFor(
      recordsRoute(ok([])),
      publishedRoute([OTHER_PATH_RULE, CATCH_ALL]),
      tunnelRoute(ok({ ...TUNNEL_ENTRY, name: null })),
    )

    const [request] = await asked(tool, { ...ARGS, path: "^/a" })

    expect(request!.message).toBe(
      `Withdraw ${HOSTNAME} (path ^/a) from tunnel ${TUNNEL_ID} (it sent it to http://localhost:2).`,
    )
  })

  test("targets name the hostname under the tunnel and the DNS record after finding the zone only", async () => {
    const { tool, requests } = removeFor()

    expect(await writeTargets(tool, { ...ARGS, hostname: `${HOSTNAME.toUpperCase()}.` }, CTX)).toEqual(
      [ROUTE_TARGET, DNS_TARGET].sort(),
    )
    expect(requests.map((request) => request.path)).toEqual(["/zones", "/zones"])
    expect(writes(requests)).toEqual([])
  })

  test.each([
    ["a wildcard", { ...ARGS, hostname: "*.example.com" }],
    ["a bad tunnel id", { ...ARGS, tunnel: "nope" }],
    ["a hostname in no zone of the account", { ...ARGS, hostname: "app.other.net" }],
    ["an unknown argument", { ...ARGS, service: SERVICE }],
  ])("targets are `*` for %s", async (_what, args) => {
    const { tool } = removeFor()

    expect(await writeTargets(tool, args, CTX)).toEqual(["*"])
  })

  test("targets are `*` when the zone lookup fails", async () => {
    const { tool } = removeFor({ method: "GET", path: "/zones", reply: { status: 500, body: "down" } })

    expect(await writeTargets(tool, ARGS, CTX)).toEqual(["*"])
  })
})
