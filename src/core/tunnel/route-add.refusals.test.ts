import { describe, expect, test } from "bun:test"
import { toolError } from "../cloudflare/client.fixtures"
import { fail, ok } from "../cloudflare/testing"
import { invoke } from "../tool"
import { SAMPLE_ZONE } from "../zone/fixtures"
import {
  A_RECORD,
  ARGS,
  CATCH_ALL,
  CTX,
  HOSTNAME,
  OWN_CNAME,
  TUNNEL_ENTRY,
  TUNNEL_ID,
  TUNNEL_NAME,
  VERSION,
  ZONE_ID,
  configRoute,
  recordsRoute,
  refusalOf,
  routeFor,
  sent,
  tunnelRoute,
  writes,
  zonesRoute,
} from "./route.fixtures"
import { cloudflareTunnelRouteAdd } from "./route-add"

/** Calls the tool and returns the refusal it ends with, having sent no write. */
async function refusal(args: object, ...routes: Parameters<typeof routeFor>) {
  const { tool, requests } = routeFor(...routes)
  const error = await toolError(invoke(tool, args, CTX))
  expect(writes(requests)).toEqual([])
  return error
}

function configWith(...ingress: object[]) {
  return configRoute(ok({ version: VERSION, config: { ingress: [...ingress, CATCH_ALL] } }))
}

describe("route add refusals: the tunnel", () => {
  test.each([
    ["a locally managed", { ...TUNNEL_ENTRY, config_src: "local" }],
    ["a tunnel that does not say how it is managed", { id: TUNNEL_ID, name: TUNNEL_NAME }],
  ])("refuses %s tunnel, pointing at the machine that runs it", async (_what, entry) => {
    const error = await refusal(ARGS, tunnelRoute(ok(entry)))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toBe(
      `Tunnel ${TUNNEL_NAME} is managed in a config file on the machine that runs it; its hostnames change there, not here. Nothing was changed.`,
    )
  })

  test("refuses a deleted tunnel as not found", async () => {
    const error = await refusal(ARGS, tunnelRoute(ok({ ...TUNNEL_ENTRY, deleted_at: "2024-05-01T00:00:00Z" })))

    expect(error.code).toBe("not_found")
    expect(error.message).toBe(`Tunnel ${TUNNEL_ID} is deleted.`)
  })

  test("passes on not_found for a tunnel that does not exist", async () => {
    const error = await refusal(ARGS, tunnelRoute(fail(404, [{ code: 1003, message: "Tunnel not found" }])))

    expect(error.code).toBe("not_found")
    expect(error.message).toContain("Tunnel not found")
  })

  test("names the Read permission when the token may not read the tunnel", async () => {
    const error = await refusal(ARGS, tunnelRoute(fail(403, [{ code: 10000, message: "Authentication error" }])))

    expect(error.code).toBe("forbidden")
    expect(error.message).toEndWith("Authentication error. The token needs Account → Cloudflare Tunnel → Read.")
  })

  test("refuses a reply that is not a tunnel", async () => {
    const error = await refusal(ARGS, tunnelRoute(ok(["not", "a", "tunnel"])))

    expect(error.code).toBe("upstream_error")
  })
})

describe("route add refusals: the zone", () => {
  test("refuses a hostname in no zone of the account", async () => {
    const error = await refusal({ ...ARGS, hostname: "app.other.net" })

    expect(error.code).toBe("not_found")
    expect(error.message).toBe(
      "No zone of the Cloudflare account default holds app.other.net; cloudflare_zone_read list shows its zones. Nothing was changed.",
    )
  })

  test("looks at the hostname and each parent down to two labels, the longest first, and takes the first zone", async () => {
    const sub = { id: "e".repeat(32), name: "sub.example.com", account: SAMPLE_ZONE.account }
    const subZonePath = `/zones/${sub.id}`
    const { tool, requests } = routeFor(
      zonesRoute([SAMPLE_ZONE, sub]),
      { method: "GET", path: subZonePath, reply: ok(sub) },
      { method: "GET", path: `${subZonePath}/dns_records`, reply: ok([]) },
      { method: "POST", path: `${subZonePath}/dns_records/batch`, reply: ok({ posts: [OWN_CNAME] }) },
    )

    const result = await invoke(tool, { ...ARGS, hostname: "app.sub.example.com" }, CTX)

    expect(result.zone).toEqual({ id: sub.id, name: "sub.example.com" })
    expect(requests.filter((request) => request.path === "/zones").map((request) => request.query.get("name"))).toEqual(
      ["app.sub.example.com", "sub.example.com"],
    )
    expect(sent(requests, "POST")[0]!.path).toBe(`${subZonePath}/dns_records/batch`)
  })

  test("falls back to the parent zone when no longer name is a zone of the account", async () => {
    const { tool, requests } = routeFor()

    const result = await invoke(tool, { ...ARGS, hostname: "a.b.c.example.com" }, CTX)

    expect(result.zone).toEqual({ id: ZONE_ID, name: SAMPLE_ZONE.name })
    const names = requests.filter((request) => request.path === "/zones").map((request) => request.query.get("name"))
    expect(names).toEqual(["a.b.c.example.com", "b.c.example.com", "c.example.com", "example.com"])
  })

  test("looks at no more than ten names", async () => {
    const labels = Array.from({ length: 14 }, (_, index) => `l${index}`)
    const { tool, requests } = routeFor()

    const error = await toolError(invoke(tool, { ...ARGS, hostname: `${labels.join(".")}.example.com` }, CTX))

    expect(error.code).toBe("not_found")
    expect(requests.filter((request) => request.path === "/zones")).toHaveLength(10)
  })
})

describe("route add refusals: the rules", () => {
  test("refuses a rule that is already there, in any case, and names its service", async () => {
    const existing = { hostname: HOSTNAME.toUpperCase(), service: "http://localhost:9" }

    const error = await refusal(ARGS, configWith(existing))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toBe(
      `${HOSTNAME} is already published by this tunnel, to http://localhost:9; cloudflare_tunnel_route_edit changes it. Nothing was changed.`,
    )
  })

  test("refuses the same hostname and path, and allows another path or no path beside it", async () => {
    const existing = { hostname: HOSTNAME, path: "^/a", service: "http://localhost:9" }

    const error = await refusal({ ...ARGS, path: "^/a" }, configWith(existing))

    expect(error.message).toStartWith(
      `${HOSTNAME} (path ^/a) is already published by this tunnel, to http://localhost:9;`,
    )
    for (const path of ["^/b", undefined]) {
      const { tool, requests } = routeFor(configWith(existing))
      await invoke(tool, { ...ARGS, path }, CTX)
      expect(sent(requests, "PUT")).toHaveLength(1)
    }
  })

  test("refuses a rule with a path that a rule for the same hostname without a path would hide", async () => {
    const earlier = { hostname: HOSTNAME.toUpperCase(), service: "http://localhost:9" }

    const error = await refusal({ ...ARGS, path: "^/a" }, configWith(earlier))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toBe(
      `A rule for ${earlier.hostname} without a path comes first and takes every request to ${HOSTNAME}, so the new rule would never match. Nothing was changed.`,
    )
  })

  test.each([
    ["with or without a path", undefined],
    ["with a path", "^/a"],
  ])("refuses %s under a wildcard rule without a path that comes first", async (_what, path) => {
    const error = await refusal(
      { ...ARGS, path },
      configWith({ hostname: "*.example.com", service: "http://localhost:9" }),
    )

    expect(error.message).toStartWith("A rule for *.example.com without a path comes first and takes every request to ")
  })

  test("allows a hostname that no earlier rule takes", async () => {
    const earlier = [
      { hostname: "*.example.com", path: "^/only", service: "http://localhost:9" },
      { hostname: "*.sub.example.com", service: "http://localhost:9" },
      { hostname: "*.example.net", service: "http://localhost:9" },
      { hostname: "example.com", service: "http://localhost:9" },
      { path: "^/x", service: "http://localhost:9" },
    ]
    const { tool, requests } = routeFor(configWith(...earlier))

    await invoke(tool, ARGS, CTX)

    expect(sent(requests, "PUT")).toHaveLength(1)
  })
})

describe("route add refusals: the DNS records", () => {
  test.each([
    ["an A record", [A_RECORD], "A 192.0.2.10"],
    ["a CNAME elsewhere", [{ ...OWN_CNAME, content: "elsewhere.example.net" }], "CNAME elsewhere.example.net"],
    ["a CNAME to the tunnel that is not proxied", [{ ...OWN_CNAME, proxied: false }], `CNAME ${OWN_CNAME.content}`],
    ["a CNAME to another tunnel", [{ ...OWN_CNAME, content: `${"1".repeat(8)}.cfargotunnel.com` }], "CNAME 11111111"],
  ])("refuses a hostname with %s", async (_what, records, listed) => {
    const error = await refusal(ARGS, recordsRoute(ok(records)))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toStartWith(`${HOSTNAME} already has DNS records (${listed}`)
    expect(error.message).toEndWith("); change or delete them with the DNS tools first. Nothing was changed.")
  })

  test("refuses several records even when one is the CNAME to the tunnel", async () => {
    const error = await refusal(ARGS, recordsRoute(ok([OWN_CNAME, A_RECORD])))

    expect(error.message).toContain(`(CNAME ${OWN_CNAME.content}, A 192.0.2.10)`)
  })

  test("lists five records at most and clips a long content to 100 characters", async () => {
    const records = Array.from({ length: 7 }, (_, index) => ({
      ...A_RECORD,
      id: `${index}`.repeat(32),
      content: "x".repeat(150),
    }))

    const error = await refusal(ARGS, recordsRoute(ok(records)))

    expect(error.message).toContain(
      `(${Array(5)
        .fill(`A ${"x".repeat(100)}…`)
        .join(", ")}, and 2 more)`,
    )
  })
})

describe("route add refusals: the arguments", () => {
  test.each([
    "hello_world",
    "bastion",
    "ftp://localhost",
    "http://a b",
    "http://",
    "http_status:600",
    "http_status:99",
    "unix:",
    "localhost:8080",
    "",
  ])("refuses the service %p before any request", async (service) => {
    const { tool, requests } = routeFor()

    expect(await refusalOf(invoke(tool, { ...ARGS, service }, CTX))).toContain("service")
    expect(requests).toEqual([])
  })

  test.each([
    "http://localhost:8080",
    "https://example.net/base",
    "tcp://localhost:22",
    "ssh://localhost:22",
    "rdp://localhost:3389",
    "smb://localhost:445",
    "unix:/run/app.sock",
    "unix+tls:/run/app.sock",
    "http_status:404",
    "http_status:503",
  ])("accepts the service %p", (service) => {
    expect(cloudflareTunnelRouteAdd.input.safeParse({ ...ARGS, service }).success).toBe(true)
  })

  test.each([
    ["a wildcard", "*.example.com", "a wildcard `*` is not allowed here"],
    ["a name without a dot", "app", "it needs at least one dot, as in mail.example.com"],
    ["an empty name", "  ", "it is empty"],
    ["an invalid label", "-a.example.com", 'label "-a" starts or ends with `-`'],
  ])("refuses %s as the hostname before any request", async (_what, hostname, problem) => {
    const { tool, requests } = routeFor()

    expect(await refusalOf(invoke(tool, { ...ARGS, hostname }, CTX))).toBe(
      `\`hostname\` must be a hostname: ${problem}.`,
    )
    expect(requests).toEqual([])
  })

  test.each(["", "a\nb", "a\u0000b", "a\u007fb", "x".repeat(201)])(
    "refuses the path %p before any request",
    async (path) => {
      const { tool, requests } = routeFor()

      expect(await refusalOf(invoke(tool, { ...ARGS, path }, CTX))).toContain("path")
      expect(requests).toEqual([])
    },
  )

  test("accepts a path of 200 characters, sent unchanged", async () => {
    const path = `^/${"a.*".repeat(66)}$`.slice(0, 200)
    const { tool, requests } = routeFor()

    await invoke(tool, { ...ARGS, path }, CTX)

    expect(JSON.stringify(sent(requests, "PUT")[0]!.body)).toContain(JSON.stringify(path))
  })

  test("refuses a bad tunnel id, an unknown argument and a missing one before any request", async () => {
    const { tool, requests } = routeFor()

    expect(await refusalOf(invoke(tool, { ...ARGS, tunnel: "nope" }, CTX))).toContain("tunnel")
    expect(await refusalOf(invoke(tool, { ...ARGS, force: true }, CTX))).toContain("force: unknown argument")
    expect(await refusalOf(invoke(tool, { tunnel: TUNNEL_ID, hostname: HOSTNAME }, CTX))).toContain("service")
    expect(requests).toEqual([])
  })
})
