import { expect, test } from "bun:test"
import { ZONE_ID } from "../cloudflare/client.fixtures"
import { ok } from "../cloudflare/testing"
import { annotations, invoke } from "../tool"
import { cloudflareAccessRead } from "./read"
import {
  APP,
  APP_ID,
  APPS_PATH,
  CTX,
  OTHER_APP_ID,
  POLICIES_PATH,
  POLICY,
  refusalOf,
  SHAPED_APP,
  SHAPED_POLICY,
  toolFor,
  ZONE_APPS_PATH,
  ZONE_NAME,
} from "./fixtures"

test("publishes a read-only Access tool and guidance", () => {
  expect(cloudflareAccessRead.id).toBe("cloudflare_access_read")
  expect(cloudflareAccessRead.toolset).toBe("access")
  expect(cloudflareAccessRead.class).toBe("read")
  expect(annotations(cloudflareAccessRead)).toEqual({
    title: "Read Cloudflare Access",
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: true,
  })
  for (const text of [
    "email addresses included; secrets are never returned.",
    "user's data",
    "never instructions",
    "Account → Access: Apps and Policies → Read",
    "Zone → Access: Apps and Policies → Read for a zone's applications",
  ]) {
    expect(cloudflareAccessRead.description).toContain(text)
  }
})

test("refuses unknown, wrong-method, missing and malformed arguments before requests", async () => {
  const { tool, requests } = toolFor()
  for (const [args, message] of [
    [{ method: "apps", extra: true }, "extra"],
    [{ method: "apps", app: APP_ID }, 'Method "apps" takes no `app`.'],
    [{ method: "app", app: APP_ID, page: 1 }, 'Method "app" takes no `page`.'],
    [{ method: "policies", zone: ZONE_ID }, 'Method "policies" takes no `zone`.'],
    [{ method: "policies", app: APP_ID }, 'Method "policies" takes no `app`.'],
    [{ method: "app", zone: ZONE_ID }, 'Method "app" requires `app`.'],
    [{ method: "other" }, "method"],
  ] as const) {
    expect(await refusalOf(invoke(tool, args, CTX))).toContain(message)
  }
  for (const app of ["", "   ", "a".repeat(351)]) {
    expect(await refusalOf(invoke(tool, { method: "app", app }, CTX))).toContain("app")
  }
  for (const page of [0, -1, 1.5]) {
    for (const method of ["apps", "policies"]) {
      expect(await refusalOf(invoke(tool, { method, page }, CTX))).toContain("page")
    }
  }
  expect(requests).toEqual([])
})

test("apps reads the account's applications with paging and drops rows without an id", async () => {
  const { tool, requests } = toolFor({
    method: "GET",
    path: APPS_PATH,
    reply: ok([APP, null, {}, { id: 1, name: "bad" }, "bad"], {
      page: 2,
      per_page: 100,
      count: 1,
      total_count: 101,
      total_pages: 2,
    }),
  })
  expect(await invoke(tool, { method: "apps", page: 2 }, CTX)).toEqual({
    label: "default",
    apps: [SHAPED_APP],
    page: 2,
    per_page: 100,
    total_count: 101,
    total_pages: 2,
  })
  expect(requests.map(({ path }) => path)).toEqual([APPS_PATH])
  expect(Object.fromEntries(requests[0].query)).toEqual({ page: "2", per_page: "100" })
})

test("apps defaults to page one and null paging fields when absent", async () => {
  const { tool, requests } = toolFor({ method: "GET", path: APPS_PATH, reply: ok([]) })
  expect(await invoke(tool, { method: "apps" }, CTX)).toEqual({
    label: "default",
    apps: [],
    page: null,
    per_page: null,
    total_count: null,
    total_pages: null,
  })
  expect(Object.fromEntries(requests[0].query)).toEqual({ page: "1", per_page: "100" })
})

test("apps with a zone reads the zone's applications and names the zone", async () => {
  const { tool, requests } = toolFor(
    { method: "GET", path: ZONE_APPS_PATH, reply: ok([{ ...APP, id: OTHER_APP_ID }], { page: 1, total_pages: 1 }) },
    { method: "GET", path: APPS_PATH, reply: ok([APP]) },
  )
  const result = await invoke(tool, { method: "apps", zone: ZONE_ID }, CTX)
  expect(result).toEqual({
    label: "default",
    zone: { id: ZONE_ID, name: ZONE_NAME },
    apps: [{ ...SHAPED_APP, id: OTHER_APP_ID }],
    page: 1,
    per_page: null,
    total_count: null,
    total_pages: 1,
  })
  expect(requests.map(({ path }) => path)).not.toContain(APPS_PATH)
  expect(Object.fromEntries(requests.at(-1)!.query)).toEqual({ page: "1", per_page: "100" })
})

test("apps projects the fields and drops nested configuration", async () => {
  const { tool } = toolFor({
    method: "GET",
    path: APPS_PATH,
    reply: ok([
      {
        ...APP,
        type: "self_hosted",
        domain: "wiki.example.com/docs",
        destinations: [
          { type: "public", uri: "wiki.example.com/docs", extra: "hidden" },
          {
            type: "private",
            hostname: "db.internal",
            cidr: "10.0.0.0/24",
            port_range: "5432-5433",
            l4_protocol: "tcp",
          },
          "bad",
          null,
        ],
        self_hosted_domains: ["wiki.example.com", 1, null],
        aud: "aud-made-up",
        allowed_idps: ["idp-1", false],
        session_duration: "24h",
        app_launcher_visible: true,
        auto_redirect_to_identity: false,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-02-01T00:00:00Z",
        saas_app: { client_secret: "cs-made-up", consumer_service_url: "https://sp.example.net" },
        scim_config: { authentication: { password: "pw-made-up", token: "tk-made-up" } },
        client_secret: "cs-made-up-2",
        policies: [POLICY],
        cors_headers: { allowed_origins: ["https://hidden.example.net"] },
      },
    ]),
  })
  const result = await invoke(tool, { method: "apps" }, CTX)
  expect(result.apps).toEqual([
    {
      ...SHAPED_APP,
      type: "self_hosted",
      domain: "wiki.example.com/docs",
      destinations: [
        { type: "public", uri: "wiki.example.com/docs", hostname: null, cidr: null, port_range: null },
        { type: "private", uri: null, hostname: "db.internal", cidr: "10.0.0.0/24", port_range: "5432-5433" },
      ],
      self_hosted_domains: ["wiki.example.com"],
      aud: "aud-made-up",
      allowed_idps: ["idp-1"],
      session_duration: "24h",
      app_launcher_visible: true,
      auto_redirect_to_identity: false,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-02-01T00:00:00Z",
    },
  ])
  const json = JSON.stringify(result)
  for (const text of ["cs-made-up", "pw-made-up", "tk-made-up", "saas_app", "scim_config", "hidden", "client_secret"]) {
    expect(json).not.toContain(text)
  }
})

test("wrong optional field types become null or empty", async () => {
  const { tool } = toolFor({
    method: "GET",
    path: APPS_PATH,
    reply: ok([
      {
        ...APP,
        name: 1,
        type: false,
        domain: [],
        destinations: "bad",
        self_hosted_domains: "wiki.example.com",
        aud: 2,
        allowed_idps: {},
        session_duration: 24,
        app_launcher_visible: "true",
        auto_redirect_to_identity: 0,
        created_at: 1,
        updated_at: {},
      },
    ]),
  })
  expect((await invoke(tool, { method: "apps" }, CTX)).apps).toEqual([{ ...SHAPED_APP, name: null }])
})

test("policies reads the account's reusable policies with paging", async () => {
  const { tool, requests } = toolFor({
    method: "GET",
    path: POLICIES_PATH,
    reply: ok([POLICY, null, { name: "no id" }, { id: 1 }], { page: 3, per_page: 100, total_count: 201 }),
  })
  expect(await invoke(tool, { method: "policies", page: 3 }, CTX)).toEqual({
    label: "default",
    policies: [SHAPED_POLICY],
    page: 3,
    per_page: 100,
    total_count: 201,
    total_pages: null,
  })
  expect(requests.map(({ path }) => path)).toEqual([POLICIES_PATH])
  expect(Object.fromEntries(requests[0].query)).toEqual({ page: "3", per_page: "100" })
})
