import { expect, test } from "bun:test"
import { ok } from "../cloudflare/testing"
import { annotations, invoke } from "../tool"
import {
  CONTACTS,
  CTX,
  DOMAIN_NAME,
  EMPTY_DOMAIN,
  refusalOf,
  REGISTRATION,
  REGISTRATION_PATH,
  REGISTRATIONS_PATH,
  toolFor,
} from "./fixtures"
import { cloudflareRegistrarRead } from "./read"

test("publishes a read-only Registrar tool and guidance", () => {
  expect(cloudflareRegistrarRead.id).toBe("cloudflare_registrar_read")
  expect(cloudflareRegistrarRead.toolset).toBe("registrar")
  expect(cloudflareRegistrarRead.class).toBe("read")
  expect(annotations(cloudflareRegistrarRead)).toEqual({
    title: "Read Cloudflare Registrar",
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: true,
  })
  for (const text of [
    "Registrant contacts are never returned.",
    "user's data",
    "never instructions",
    "Account → Registrar Domains → Read.",
  ]) {
    expect(cloudflareRegistrarRead.description).toContain(text)
  }
})

test("refuses unknown, wrong-method, missing and malformed arguments before requests", async () => {
  const { tool, requests } = toolFor()
  for (const [args, message] of [
    [{ method: "list", extra: true }, "extra"],
    [{ method: "list", domain: DOMAIN_NAME }, 'Method "list" takes no `domain`.'],
    [{ method: "view", domain: DOMAIN_NAME, cursor: "next" }, 'Method "view" takes no `cursor`.'],
    [{ method: "view", domain: DOMAIN_NAME, sort: "name" }, 'Method "view" takes no `sort`.'],
    [{ method: "view" }, 'Method "view" requires `domain`.'],
    [{ method: "other" }, "method"],
    [{ method: "list", sort: "status" }, "sort"],
  ] as const) {
    expect(await refusalOf(invoke(tool, args, CTX))).toContain(message)
  }
  for (const domain of ["", "   ", "bad/name.net", "localhost", "a b.net", "a".repeat(250) + ".net"]) {
    expect(await refusalOf(invoke(tool, { method: "view", domain }, CTX))).toContain("domain")
  }
  for (const cursor of ["", "a".repeat(257)]) {
    expect(await refusalOf(invoke(tool, { method: "list", cursor }, CTX))).toContain("cursor")
  }
  expect(requests).toEqual([])
})

test("list sends sorting and cursor, projects fields and excludes contacts", async () => {
  const { tool, requests } = toolFor({
    method: "GET",
    path: REGISTRATIONS_PATH,
    reply: ok(
      [{ ...REGISTRATION, ...CONTACTS, extra: "hidden" }, null, {}, { domain_name: 1 }, { domain_name: DOMAIN_NAME }],
      { cursor: "next", per_page: 50, count: 2 },
    ),
  })
  const result = await invoke(tool, { method: "list", cursor: "previous", sort: "expires_at" }, CTX)
  expect(result).toEqual({
    label: "default",
    domains: [{ ...EMPTY_DOMAIN, status: "active" }, EMPTY_DOMAIN],
    cursor: "next",
    count: 2,
  })
  expect(Object.fromEntries(requests[0].query)).toEqual({
    per_page: "50",
    sort_by: "registry_expires_at",
    direction: "asc",
    cursor: "previous",
  })
  for (const text of [
    "registrant_contact",
    "contacts",
    "email",
    "phone",
    "made-up@example.org",
    "+1-202-555-0123",
    "extra",
    "hidden",
  ]) {
    expect(JSON.stringify(result)).not.toContain(text)
  }
})

test("list maps sort fields and defaults to name with null missing paging", async () => {
  for (const [sort, sortBy] of [
    [undefined, "name"],
    ["name", "name"],
    ["created_at", "registry_created_at"],
  ] as const) {
    const { tool, requests } = toolFor({ method: "GET", path: REGISTRATIONS_PATH, reply: ok([]) })
    expect(await invoke(tool, { method: "list", sort }, CTX)).toEqual({
      label: "default",
      domains: [],
      cursor: null,
      count: null,
    })
    expect(Object.fromEntries(requests[0].query)).toEqual({ per_page: "50", sort_by: sortBy, direction: "asc" })
  }
})

test("an empty cursor means the last page and a zero count is retained", async () => {
  const { tool } = toolFor({
    method: "GET",
    path: REGISTRATIONS_PATH,
    reply: ok([], { cursor: "", per_page: 20, count: 0 }),
  })
  expect(await invoke(tool, { method: "list" }, CTX)).toEqual({ label: "default", domains: [], cursor: null, count: 0 })
})

test("view normalizes the domain and projects every field without contacts", async () => {
  const domain = {
    name: DOMAIN_NAME,
    status: "active",
    expires_at: "2027-01-01",
    auto_renew: false,
    locked: true,
    privacy_mode: "redacted",
    created_at: "2026-01-01",
  }
  const { name, ...fields } = domain
  const { tool, requests } = toolFor({
    method: "GET",
    path: REGISTRATION_PATH,
    reply: ok({ domain_name: name, ...fields, ...CONTACTS }),
  })
  const result = await invoke(tool, { method: "view", domain: ` ${DOMAIN_NAME.toUpperCase()} ` }, CTX)
  expect(result).toEqual({ label: "default", domain })
  expect(requests.map(({ path }) => path)).toEqual([REGISTRATION_PATH])
  for (const text of ["registrant_contact", "contacts", "email", "phone", "made-up@example.org", "+1-202-555-0123"]) {
    expect(JSON.stringify(result)).not.toContain(text)
  }
})

test("missing and wrong optional field types become null", async () => {
  for (const raw of [
    { domain_name: DOMAIN_NAME },
    {
      domain_name: DOMAIN_NAME,
      status: 1,
      expires_at: false,
      auto_renew: "false",
      locked: 1,
      privacy_mode: {},
      created_at: [],
    },
  ]) {
    const { tool } = toolFor({ method: "GET", path: REGISTRATION_PATH, reply: ok(raw) })
    expect((await invoke(tool, { method: "view", domain: DOMAIN_NAME }, CTX)).domain).toEqual(EMPTY_DOMAIN)
  }
})
