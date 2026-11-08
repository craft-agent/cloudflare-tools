import { expect, test } from "bun:test"
import { cloudflareClient } from "../cloudflare/client"
import { ACCOUNT_ID, envFor } from "../cloudflare/client.fixtures"
import { fail, fakeCloudflare, ok, type FakeRoute } from "../cloudflare/testing"
import { coverageOf, readAccessApps, type AccessApps } from "./access"

const ACCESS_PATH = `/accounts/${ACCOUNT_ID}/access/apps`
const HOST = "app.example.com"

function clientFor(reply: FakeRoute["reply"]) {
  const { fetch, requests } = fakeCloudflare([{ method: "GET", path: ACCESS_PATH, reply }])
  return { client: cloudflareClient(undefined, { fetch, env: envFor() }), requests }
}

async function projected(...rows: unknown[]) {
  return readAccessApps(clientFor(ok(rows)).client)
}

test("exact matches cover the hostname and preserve application order and the first destination", () => {
  const apps: AccessApps = {
    apps: [
      {
        id: "one",
        name: "First",
        destinations: [
          { host: HOST, path: "/admin" },
          { host: HOST, path: "" },
        ],
      },
      { id: "two", name: null, destinations: [{ host: HOST, path: "" }] },
    ],
  }
  expect(coverageOf(HOST.toUpperCase(), apps)).toEqual({
    status: "covered",
    apps: [
      { id: "one", name: "First", destination: `${HOST}/admin` },
      { id: "two", name: null, destination: HOST },
    ],
  })
})

test("wildcards match one label, not the apex or nested labels", async () => {
  const apps = await projected({ id: "wildcard", type: "self_hosted", domain: "*.example.com" })
  expect(coverageOf("a.example.com", apps).status).toBe("covered")
  expect(coverageOf("example.com", apps)).toEqual({ status: "none", apps: [] })
  expect(coverageOf("a.b.example.com", apps).status).toBe("none")
})

test("path-only matches are partial and trailing slashes or wildcards cover the whole host", async () => {
  const partial = await projected({ id: "path", type: "self_hosted", domain: `${HOST}/admin/*` })
  expect(coverageOf(HOST, partial)).toEqual({
    status: "partial",
    apps: [{ id: "path", name: null, destination: `${HOST}/admin` }],
  })
  for (const suffix of ["/", "/*"]) {
    const apps = await projected({ id: "whole", type: "self_hosted", domain: HOST + suffix })
    expect(coverageOf(HOST, apps).status).toBe("covered")
  }
})

test("public destinations take precedence and private destinations do not fall back", async () => {
  const apps = await projected(
    {
      id: "public",
      type: "self_hosted",
      destinations: [{ type: "public", uri: `${HOST}/admin` }],
      self_hosted_domains: [HOST],
      domain: HOST,
    },
    { id: "private", type: "self_hosted", destinations: [{ type: "private", uri: HOST }], domain: HOST },
  )
  expect(coverageOf(HOST, apps)).toEqual({
    status: "partial",
    apps: [{ id: "public", name: null, destination: `${HOST}/admin` }],
  })
})

test("legacy domains fall back in order and uppercase hosts and ports are normalized", async () => {
  const apps = await projected(
    {
      id: "domains",
      type: "ssh",
      self_hosted_domains: [` ${HOST.toUpperCase()}:443/ `, null, "/empty"],
      domain: "ignored.example.com",
    },
    { id: "domain", type: "vnc", self_hosted_domains: [], domain: HOST },
    { id: "empty-destinations", type: "rdp", destinations: [], domain: HOST },
  )
  expect(coverageOf(HOST, apps).apps.map((app) => app.destination)).toEqual([HOST, HOST, HOST])
  expect(coverageOf("ignored.example.com", apps).status).toBe("none")
})

test("unrelated application types and malformed rows are ignored; credentials and policies never survive projection", async () => {
  const apps = await projected(
    null,
    "invalid",
    {},
    { type: "self_hosted", domain: HOST },
    { id: "bookmark", type: "bookmark", domain: HOST },
    { id: "saas", type: "saas", domain: HOST },
    {
      id: "safe",
      name: "Safe",
      type: "self_hosted",
      domain: HOST,
      scim_config: { secret: "fake-scim" },
      policies: ["made-up-policy"],
      saas_app: { client_secret: "fake-client" },
    },
  )
  const coverage = coverageOf(HOST, apps)
  expect(coverage.apps).toEqual([{ id: "safe", name: "Safe", destination: HOST }])
  for (const value of ["fake-scim", "made-up-policy", "fake-client", "scim_config", "policies", "saas_app"]) {
    expect(JSON.stringify(coverage)).not.toContain(value)
    expect(JSON.stringify(apps)).not.toContain(value)
  }
})

test("paging follows total_pages even for short pages", async () => {
  const { client, requests } = clientFor((request) =>
    ok([{ id: `app-${request.query.get("page")}`, type: "self_hosted", domain: HOST }], { total_pages: 2 }),
  )
  const apps = await readAccessApps(client)
  expect(coverageOf(HOST, apps).apps.map((app) => app.id)).toEqual(["app-1", "app-2"])
  expect(requests.map((request) => Object.fromEntries(request.query))).toEqual([
    { page: "1", per_page: "1000" },
    { page: "2", per_page: "1000" },
  ])
})

test("without paging metadata a full page is followed by the next page", async () => {
  const { client, requests } = clientFor((request) =>
    ok(request.query.get("page") === "1" ? Array(1000).fill(null) : []),
  )
  expect(await readAccessApps(client)).toEqual({ apps: [] })
  expect(requests).toHaveLength(2)
})

test("paging stops at five pages with unknown when more applications remain", async () => {
  for (const info of [undefined, { total_pages: 6 }]) {
    const { client, requests } = clientFor(ok(Array(1000).fill(null), info))
    expect(await readAccessApps(client)).toEqual({
      unknown: "The account has more Access applications than this tool reads.",
    })
    expect(requests).toHaveLength(5)
  }
  const { client, requests } = clientFor(ok([], { total_pages: 5 }))
  expect(await readAccessApps(client)).toEqual({ apps: [] })
  expect(requests).toHaveLength(5)
})

test("forbidden and malformed responses yield unknown coverage", async () => {
  const { client } = clientFor(fail(403, [{ code: 10000, message: "Forbidden" }]))
  expect(coverageOf(HOST, await readAccessApps(client))).toEqual({
    status: "unknown",
    apps: [],
    reason: "The token needs Account → Access: Apps and Policies → Read to tell.",
  })
  expect(await readAccessApps(clientFor(ok({})).client)).toEqual({
    unknown: "Cloudflare returned an unexpected Access applications response.",
  })
})

test("other tool errors become unknown while cancellation is rethrown", async () => {
  const { client } = clientFor(fail(500, [{ code: 10000, message: "Made-up failure" }]))
  expect(await readAccessApps(client)).toEqual({
    unknown: "The Access applications could not be read: Cloudflare answered HTTP 500: 10000: Made-up failure",
  })
  const controller = new AbortController()
  controller.abort()
  const fake = fakeCloudflare([])
  const cancelled = cloudflareClient(undefined, { fetch: fake.fetch, env: envFor(), signal: controller.signal })
  await expect(readAccessApps(cancelled)).rejects.toMatchObject({ name: "AbortError" })
})
