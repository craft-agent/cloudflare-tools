import { expect, test } from "bun:test"
import { ZONE_ID, rejection } from "../cloudflare/client.fixtures"
import { ok } from "../cloudflare/testing"
import { invoke } from "../tool"
import {
  CTX,
  FORWARD_RULE,
  OTHER_RULE_ID,
  RULES_PATH,
  RULE_ID,
  SHAPED_FORWARD_RULE,
  ZONE_NAME,
  errorOf,
  toolFor,
} from "./fixtures"
import { UNSUPPORTED_RULE_NOTE } from "./shape"

const BASE = { enabled: true, priority: 1 }

function rulesTool(rows: unknown[]) {
  const info = { page: 1, per_page: 50, total_count: rows.length, total_pages: 1 }
  return toolFor({ method: "GET", path: RULES_PATH, reply: ok(rows, info) })
}

async function shapedRules(rows: unknown[]) {
  const { tool } = rulesTool(rows)
  const result = await invoke(tool, { method: "rules", zone: ZONE_ID }, CTX)
  return result.rules ?? []
}

function rulesQuery(requests: { path: string; query: URLSearchParams }[]) {
  return Object.fromEntries(requests.find((request) => request.path === RULES_PATH)?.query ?? [])
}

test("rules: lists a zone's rules in Cloudflare's order with paging", async () => {
  const { tool, requests } = rulesTool([FORWARD_RULE, { ...FORWARD_RULE, id: OTHER_RULE_ID, name: "Second" }])

  const result = await invoke(tool, { method: "rules", zone: ZONE_ID }, CTX)

  expect(result).toEqual({
    label: "default",
    zone: { id: ZONE_ID, name: ZONE_NAME },
    rules: [SHAPED_FORWARD_RULE, { ...SHAPED_FORWARD_RULE, id: OTHER_RULE_ID, name: "Second" }],
    page: 1,
    per_page: 50,
    total_count: 2,
    total_pages: 1,
  })
  expect(rulesQuery(requests)).toEqual({ page: "1", per_page: "50" })
})

test("rules: sends the page asked for", async () => {
  const { tool, requests } = rulesTool([])

  await invoke(tool, { method: "rules", zone: ZONE_ID, page: 4 }, CTX)

  expect(rulesQuery(requests)).toEqual({ page: "4", per_page: "50" })
})

test("rules: shapes forward, drop and Worker rules", async () => {
  const to = (value: string) => [{ type: "literal", field: "to", value }]
  const rules = await shapedRules([
    { ...BASE, id: "r1", name: null, matchers: to("A@Example.com"), actions: [{ type: "drop" }] },
    {
      ...BASE,
      id: "r2",
      name: "Hook",
      matchers: to("b@example.com"),
      actions: [{ type: "worker", value: ["mail-handler"] }],
    },
    { ...BASE, id: "r3", matchers: [{ type: "all" }], actions: [{ type: "forward", value: ["C@Example.com"] }] },
  ])

  expect(rules).toEqual([
    { id: "r1", name: null, ...BASE, to: "a@example.com", action: { type: "drop" }, managed_by: "api" },
    {
      id: "r2",
      name: "Hook",
      ...BASE,
      to: "b@example.com",
      action: { type: "worker", worker: "mail-handler" },
      managed_by: "api",
    },
    { id: "r3", name: null, ...BASE, to: null, action: { type: "forward", to: "c@example.com" }, managed_by: "api" },
  ])
})

test("rules: a rule from Wrangler says so, and absent fields fall back", async () => {
  const [wrangler, bare] = await shapedRules([
    { ...FORWARD_RULE, source: "wrangler" },
    { tag: "t1", matchers: [{ type: "all" }], actions: [{ type: "drop" }], source: "other" },
  ])

  expect(wrangler?.managed_by).toBe("wrangler")
  expect(bare).toEqual({
    id: "t1",
    name: null,
    enabled: false,
    priority: null,
    to: null,
    action: { type: "drop" },
    managed_by: "api",
  })
})

test("rules: a rule with several matchers, actions or values, or unknown types, is kept with a note", async () => {
  const literal = { type: "literal", field: "to", value: "X@Example.com" }
  const forward = { type: "forward", value: ["o@example.com"] }
  const rules = await shapedRules([
    { ...BASE, id: "u1", matchers: [literal, { ...literal, value: "y@example.com" }], actions: [forward] },
    { ...BASE, id: "u2", matchers: [literal], actions: [forward, { type: "drop" }] },
    {
      ...BASE,
      id: "u3",
      matchers: [literal],
      actions: [{ type: "forward", value: ["a@example.com", "b@example.com"] }],
    },
    { ...BASE, id: "u4", matchers: [literal], actions: [{ type: "mystery", value: ["x"] }] },
    { ...BASE, id: "u5", matchers: [{ ...literal, field: "from" }], actions: [forward] },
    { ...BASE, id: "u6", matchers: [], actions: [] },
    { ...BASE, id: "u7", matchers: [literal], actions: [{ type: "forward", value: [] }], owner_worker_tag: "tag-one" },
  ])

  expect(rules.map((rule) => [rule.id, rule.to, rule.action])).toEqual([
    ["u1", "x@example.com", null],
    ["u2", "x@example.com", null],
    ["u3", "x@example.com", null],
    ["u4", "x@example.com", null],
    ["u5", null, null],
    ["u6", null, null],
    ["u7", "x@example.com", null],
  ])
  expect(rules.every((rule) => rule.note === UNSUPPORTED_RULE_NOTE)).toBe(true)
  expect(JSON.stringify(rules)).not.toContain("tag-one")
  expect(JSON.stringify(rules)).not.toContain("matchers")
})

test("rules: drops rows that are not objects or have no id, and clips a long name", async () => {
  const rules = await shapedRules([
    null,
    "text",
    { name: "no id" },
    { id: 5 },
    { ...FORWARD_RULE, name: "n".repeat(300) },
  ])

  expect(rules).toHaveLength(1)
  expect(rules[0]?.id).toBe(RULE_ID)
  expect(rules[0]?.name).toBe(`${"n".repeat(256)}…`)
})

test("rules: a zone Cloudflare does not know is not_found", async () => {
  const { tool, requests } = rulesTool([])

  const err = errorOf(await rejection(invoke(tool, { method: "rules", zone: "2".repeat(32) }, CTX)))

  expect(err.code).toBe("not_found")
  expect(requests.some((request) => request.path === RULES_PATH)).toBe(false)
})

test("rules: a result that is not an array is an upstream_error", async () => {
  const { tool } = toolFor({ method: "GET", path: RULES_PATH, reply: ok({}) })

  const err = errorOf(await rejection(invoke(tool, { method: "rules", zone: ZONE_ID }, CTX)))

  expect(err.code).toBe("upstream_error")
  expect(err.message).toBe("Cloudflare returned an unexpected routing rules response.")
})
