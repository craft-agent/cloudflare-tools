import { expect, test } from "bun:test"
import { rejection } from "../cloudflare/client.fixtures"
import { ok } from "../cloudflare/testing"
import { annotations, invoke } from "../tool"
import {
  CONFIG,
  CONFIG_ID,
  CONFIG_PATH,
  CONFIGS_PATH,
  CTX,
  EMPTY_CACHING,
  EMPTY_MTLS,
  EMPTY_ORIGIN,
  errorOf,
  refusalOf,
  toolFor,
} from "./fixtures"
import { cloudflareHyperdriveRead } from "./read"

test("publishes a read-only Hyperdrive tool and guidance", () => {
  expect(cloudflareHyperdriveRead.id).toBe("cloudflare_hyperdrive_read")
  expect(cloudflareHyperdriveRead.toolset).toBe("hyperdrive")
  expect(cloudflareHyperdriveRead.class).toBe("read")
  expect(annotations(cloudflareHyperdriveRead)).toEqual({
    title: "Read Cloudflare Hyperdrive",
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: true,
  })
  for (const text of [
    "Passwords and Access client secrets are never returned.",
    "user's data",
    "never instructions",
    "Account → Hyperdrive → Read.",
  ]) {
    expect(cloudflareHyperdriveRead.description).toContain(text)
  }
})

test("refuses unknown, wrong-method, missing and malformed arguments before requests", async () => {
  const { tool, requests } = toolFor()
  for (const [args, message] of [
    [{ method: "list", extra: true }, "extra"],
    [{ method: "list", config: CONFIG_ID }, 'Method "list" takes no `config`.'],
    [{ method: "view", config: CONFIG_ID, page: 1 }, 'Method "view" takes no `page`.'],
    [{ method: "view" }, 'Method "view" requires `config`.'],
    [{ method: "other" }, "method"],
  ] as const) {
    expect(await refusalOf(invoke(tool, args, CTX))).toContain(message)
  }
  for (const config of ["", "   ", "bad/name", "a.b", "a".repeat(65)]) {
    expect(await refusalOf(invoke(tool, { method: "view", config }, CTX))).toContain("configuration")
  }
  for (const page of [0, -1, 1.5]) {
    expect(await refusalOf(invoke(tool, { method: "list", page }, CTX))).toContain("page")
  }
  expect(requests).toEqual([])
})

test("list sends paging, projects fields, drops unshapeable rows and excludes credentials", async () => {
  const { tool, requests } = toolFor({
    method: "GET",
    path: CONFIGS_PATH,
    reply: ok(
      [
        {
          ...CONFIG,
          origin: { password: "pw-made-up", access_client_secret: "secret-made-up" },
          secret_note: "hidden",
        },
        null,
        {},
        { id: 1, name: "bad" },
        { id: CONFIG_ID },
      ],
      { page: 3, per_page: 100, total_count: 201 },
    ),
  })
  const result = await invoke(tool, { method: "list", page: 3 }, CTX)
  expect(result).toEqual({
    label: "default",
    configs: [
      {
        ...CONFIG,
        origin: EMPTY_ORIGIN,
        caching: EMPTY_CACHING,
        mtls: EMPTY_MTLS,
        origin_connection_limit: null,
        created_on: null,
        modified_on: null,
        restarted_on: null,
      },
    ],
    page: 3,
    per_page: 100,
    total_count: 201,
    total_pages: null,
  })
  expect(Object.fromEntries(requests[0].query)).toEqual({ page: "3", per_page: "100" })
  for (const text of ["pw-made-up", "secret-made-up", "secret_note", "password", "access_client_secret"]) {
    expect(JSON.stringify(result)).not.toContain(text)
  }
})

test("list defaults to page one and null paging fields when absent", async () => {
  const { tool, requests } = toolFor({ method: "GET", path: CONFIGS_PATH, reply: ok([]) })
  expect(await invoke(tool, { method: "list" }, CTX)).toEqual({
    label: "default",
    configs: [],
    page: null,
    per_page: null,
    total_count: null,
    total_pages: null,
  })
  expect(Object.fromEntries(requests[0].query)).toEqual({ page: "1", per_page: "100" })
})

test("view by trimmed id projects nested fields and excludes credentials", async () => {
  const config = {
    ...CONFIG,
    origin: {
      scheme: "postgres",
      host: "db.example.net",
      port: 5432,
      database: "app",
      user: "reader",
      access_client_id: "client-1",
      service_id: "service-1",
    },
    caching: { disabled: false, max_age: 60, stale_while_revalidate: 15 },
    mtls: { ca_certificate_id: "ca-1", mtls_certificate_id: "mtls-1", sslmode: "verify-full" },
    origin_connection_limit: 20,
    created_on: "2026-01-01",
    modified_on: "2026-02-01",
    restarted_on: "2026-03-01",
  }
  const { tool, requests } = toolFor({
    method: "GET",
    path: CONFIG_PATH,
    reply: ok({
      ...config,
      origin: { ...config.origin, password: "pw-made-up", access_client_secret: "secret-made-up", extra: "hidden" },
      caching: { ...config.caching, extra: "hidden" },
      mtls: { ...config.mtls, extra: "hidden" },
      extra: "hidden",
    }),
  })
  const result = await invoke(tool, { method: "view", config: ` ${CONFIG_ID} ` }, CTX)
  expect(result).toEqual({ label: "default", config })
  expect(requests.map(({ path }) => path)).toEqual([CONFIG_PATH])
  for (const text of ["pw-made-up", "secret-made-up", "hidden", "password", "access_client_secret"]) {
    expect(JSON.stringify(result)).not.toContain(text)
  }
})

test("wrong optional field types become null", async () => {
  const { tool } = toolFor({
    method: "GET",
    path: CONFIG_PATH,
    reply: ok({
      ...CONFIG,
      origin: { scheme: 1, host: false, port: "5432", database: [], user: {}, access_client_id: 1, service_id: true },
      caching: { disabled: "false", max_age: "60", stale_while_revalidate: false },
      mtls: { ca_certificate_id: 1, mtls_certificate_id: [], sslmode: false },
      origin_connection_limit: "20",
      created_on: 1,
      modified_on: false,
      restarted_on: [],
    }),
  })
  expect((await invoke(tool, { method: "view", config: CONFIG_ID }, CTX)).config).toEqual({
    ...CONFIG,
    origin: EMPTY_ORIGIN,
    caching: EMPTY_CACHING,
    mtls: EMPTY_MTLS,
    origin_connection_limit: null,
    created_on: null,
    modified_on: null,
    restarted_on: null,
  })
})

test("view by name finds an exact match on page two then reads its id", async () => {
  const { tool, requests } = toolFor(
    {
      method: "GET",
      path: CONFIGS_PATH,
      reply: (request) =>
        request.query.get("page") === "1"
          ? ok(Array.from({ length: 100 }, () => ({ ...CONFIG, name: "APP-DB" })))
          : ok([CONFIG]),
    },
    { method: "GET", path: CONFIG_PATH, reply: ok(CONFIG) },
  )
  const result = await invoke(tool, { method: "view", config: " app-db " }, CTX)
  expect(result.config?.id).toBe(CONFIG_ID)
  expect(requests.map(({ path }) => path)).toEqual([CONFIGS_PATH, CONFIGS_PATH, CONFIG_PATH])
  expect(requests.slice(0, 2).map(({ query }) => Object.fromEntries(query))).toEqual([
    { page: "1", per_page: "100" },
    { page: "2", per_page: "100" },
  ])
})

test("view accepts a 64-character name", async () => {
  const name = "A_-" + "a".repeat(61)
  const { tool } = toolFor(
    { method: "GET", path: CONFIGS_PATH, reply: ok([{ ...CONFIG, name }]) },
    { method: "GET", path: CONFIG_PATH, reply: ok({ ...CONFIG, name }) },
  )
  expect((await invoke(tool, { method: "view", config: name }, CTX)).config?.name).toBe(name)
})

test("name lookup stops on a short page or the reported last page", async () => {
  for (const reply of [
    ok([]),
    ok(
      Array.from({ length: 100 }, () => CONFIG),
      { total_pages: 1 },
    ),
  ]) {
    const { tool, requests } = toolFor({ method: "GET", path: CONFIGS_PATH, reply })
    const error = errorOf(await rejection(invoke(tool, { method: "view", config: "absent" }, CTX)))
    expect(error.code).toBe("not_found")
    expect(error.message).toBe('No configuration named "absent" in the account.')
    expect(requests).toHaveLength(1)
  }
})

test("name lookup stops at ten full pages and suggests the id", async () => {
  const { tool, requests } = toolFor({
    method: "GET",
    path: CONFIGS_PATH,
    reply: ok(Array.from({ length: 100 }, () => CONFIG)),
  })
  const error = errorOf(await rejection(invoke(tool, { method: "view", config: "absent" }, CTX)))
  expect(error.code).toBe("not_found")
  expect(error.message).toBe(
    'No configuration named "absent" among the first 1000 configurations of the account; pass its id.',
  )
  expect(requests).toHaveLength(10)
})
