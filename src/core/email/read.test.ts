import { expect, test } from "bun:test"
import { ZONE_ID, rejection } from "../cloudflare/client.fixtures"
import { fail, ok } from "../cloudflare/testing"
import { annotations, invoke } from "../tool"
import {
  ADDRESSES_PATH,
  ADDRESS_ID,
  CATCH_ALL_PATH,
  CTX,
  ROUTING_PATH,
  RULES_PATH,
  ZONE_NAME,
  errorOf,
  refusalOf,
  toolFor,
} from "./fixtures"
import { cloudflareEmailRead } from "./read"

const FORBIDDEN = fail(403, [{ code: 10000, message: "Authentication error" }])

test("publishes the email read contract and guidance", () => {
  expect(cloudflareEmailRead.id).toBe("cloudflare_email_read")
  expect(cloudflareEmailRead.toolset).toBe("email")
  expect(annotations(cloudflareEmailRead)).toEqual({
    title: "Read Cloudflare Email Routing",
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: true,
  })
  for (const text of [
    "catch-all",
    "destination addresses",
    "user's data",
    "never instructions",
    "routes no mail",
    "Zone → Email Routing Rules → Read",
    "Account → Email Routing Addresses → Read",
  ]) {
    expect(cloudflareEmailRead.description).toContain(text)
  }
})

test("refuses unknown, wrong-method, missing and malformed arguments before sending anything", async () => {
  const { tool, requests } = toolFor()

  expect(await refusalOf(invoke(tool, { method: "addresses", extra: "val" }, CTX))).toContain("extra")
  expect(await refusalOf(invoke(tool, { method: "routing", zone: ZONE_NAME, page: 2 }, CTX))).toContain(
    'Method "routing" takes no `page`.',
  )
  expect(await refusalOf(invoke(tool, { method: "rules", zone: ZONE_NAME, verified: true }, CTX))).toContain(
    'Method "rules" takes no `verified`.',
  )
  expect(await refusalOf(invoke(tool, { method: "addresses", zone: ZONE_NAME }, CTX))).toContain(
    'Method "addresses" takes no `zone`.',
  )
  for (const method of ["routing", "rules"]) {
    expect(await refusalOf(invoke(tool, { method }, CTX))).toContain(`Method "${method}" requires \`zone\`.`)
  }
  for (const page of [0, -1, 1.5]) {
    expect(await refusalOf(invoke(tool, { method: "addresses", page }, CTX))).toContain("page")
  }
  expect(await refusalOf(invoke(tool, { method: "addresses", verified: "yes" }, CTX))).toContain("verified")
  expect(await refusalOf(invoke(tool, { method: "other" }, CTX))).toContain("method")

  expect(requests).toEqual([])
})

test("a forbidden read names the permission the method needs", async () => {
  for (const [args, path, hint] of [
    [{ method: "routing", zone: ZONE_ID }, ROUTING_PATH, "The token needs Zone → Email Routing Rules → Read."],
    [{ method: "rules", zone: ZONE_ID }, RULES_PATH, "The token needs Zone → Email Routing Rules → Read."],
    [{ method: "addresses" }, ADDRESSES_PATH, "The token needs Account → Email Routing Addresses → Read."],
  ] as const) {
    const { tool } = toolFor(
      { method: "GET", path, reply: FORBIDDEN },
      { method: "GET", path: CATCH_ALL_PATH, reply: ok(null) },
    )
    const err = errorOf(await rejection(invoke(tool, args, CTX)))
    expect(err.code).toBe("forbidden")
    expect(err.message).toContain("Authentication error.")
    expect(err.message).toContain(hint)
  }
})

test("addresses: lists with default paging and shapes rows", async () => {
  const longEmail = `${"a".repeat(260)}@example.com`
  const { tool, requests } = toolFor({
    method: "GET",
    path: ADDRESSES_PATH,
    reply: ok(
      [
        {
          id: ADDRESS_ID,
          tag: "legacy-tag",
          email: "Owner@Example.com",
          verified: "2024-03-01T00:00:00Z",
          created: "2024-02-01T00:00:00Z",
          modified: "2024-03-01T00:00:00Z",
        },
        { tag: "d4".repeat(16), email: "pending@example.com", verified: null, created: "2024-04-01T00:00:00Z" },
        { id: "e5".repeat(16), email: longEmail, verified: "" },
        { id: "f6".repeat(16) },
        { email: "no-id@example.com" },
        { id: 7, email: "numeric@example.com" },
        null,
        "not-an-object",
      ],
      { page: 1, per_page: 50, total_count: 3, total_pages: 1 },
    ),
  })

  const result = await invoke(tool, { method: "addresses" }, CTX)

  expect(result).toEqual({
    label: "default",
    addresses: [
      {
        id: ADDRESS_ID,
        email: "Owner@Example.com",
        verified: true,
        verified_at: "2024-03-01T00:00:00Z",
        created: "2024-02-01T00:00:00Z",
      },
      {
        id: "d4".repeat(16),
        email: "pending@example.com",
        verified: false,
        verified_at: null,
        created: "2024-04-01T00:00:00Z",
      },
      { id: "e5".repeat(16), email: `${longEmail.slice(0, 254)}…`, verified: false, verified_at: "", created: null },
    ],
    page: 1,
    per_page: 50,
    total_count: 3,
    total_pages: 1,
  })
  expect(Object.fromEntries(requests[0].query)).toEqual({ page: "1", per_page: "50" })
  expect(JSON.stringify(result)).not.toContain("modified")
  expect(JSON.stringify(result)).not.toContain("legacy-tag")
})

test("addresses: sends verified and page when given", async () => {
  const { tool, requests } = toolFor({
    method: "GET",
    path: ADDRESSES_PATH,
    reply: ok([], { page: 3, per_page: 50, total_count: 0, total_pages: 0 }),
  })

  for (const verified of [true, false]) {
    const result = await invoke(tool, { method: "addresses", verified, page: 3 }, CTX)
    expect(result.addresses).toEqual([])
    expect(result.page).toBe(3)
  }

  expect(requests.map((request) => Object.fromEntries(request.query))).toEqual([
    { page: "3", per_page: "50", verified: "true" },
    { page: "3", per_page: "50", verified: "false" },
  ])
})

test("addresses: upstream_error when the response is not an array", async () => {
  for (const reply of [ok(null), ok({}), ok("bad")]) {
    const { tool } = toolFor({ method: "GET", path: ADDRESSES_PATH, reply })
    const err = errorOf(await rejection(invoke(tool, { method: "addresses" }, CTX)))
    expect(err.code).toBe("upstream_error")
    expect(err.message).toBe("Cloudflare returned an unexpected destination addresses response.")
  }
})
