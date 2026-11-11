import { expect, test } from "bun:test"
import { ok } from "../cloudflare/testing"
import { annotations, invoke } from "../tool"
import { CTX, EMPTY_WIDGET, refusalOf, SITEKEY, toolFor, WIDGET, WIDGET_PATH, WIDGETS_PATH } from "./fixtures"
import { cloudflareTurnstileRead } from "./read"

test("publishes a read-only Turnstile tool and guidance", () => {
  expect(cloudflareTurnstileRead.id).toBe("cloudflare_turnstile_read")
  expect(cloudflareTurnstileRead.toolset).toBe("turnstile")
  expect(cloudflareTurnstileRead.class).toBe("read")
  expect(annotations(cloudflareTurnstileRead)).toEqual({
    title: "Read Cloudflare Turnstile",
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: true,
  })
  for (const text of [
    "A widget's secret key is never returned.",
    "user's data",
    "never instructions",
    "Account → Turnstile Sites → Read.",
  ]) {
    expect(cloudflareTurnstileRead.description).toContain(text)
  }
})

test("refuses unknown, wrong-method, missing and malformed arguments before requests", async () => {
  const { tool, requests } = toolFor()
  for (const [args, message] of [
    [{ method: "list", extra: true }, "extra"],
    [{ method: "list", sitekey: SITEKEY }, 'Method "list" takes no `sitekey`.'],
    [{ method: "view", sitekey: SITEKEY, page: 1 }, 'Method "view" takes no `page`.'],
    [{ method: "view" }, 'Method "view" requires `sitekey`.'],
    [{ method: "other" }, "method"],
  ] as const) {
    expect(await refusalOf(invoke(tool, args, CTX))).toContain(message)
  }
  for (const sitekey of ["", "   ", "bad/name", "a.b", "a".repeat(65)]) {
    expect(await refusalOf(invoke(tool, { method: "view", sitekey }, CTX))).toContain("sitekey")
  }
  for (const page of [0, -1, 1.5]) {
    expect(await refusalOf(invoke(tool, { method: "list", page }, CTX))).toContain("page")
  }
  expect(requests).toEqual([])
})

test("list sends sorting and paging, projects fields and excludes secrets", async () => {
  const { tool, requests } = toolFor({
    method: "GET",
    path: WIDGETS_PATH,
    reply: ok(
      [
        { ...WIDGET, domains: ["example.net", 1, null, "www.example.net"], secret: "sk-made-up", extra: "hidden" },
        null,
        {},
        { sitekey: 1 },
        { sitekey: SITEKEY },
      ],
      { page: 3, per_page: 100, count: 1, total_count: 201, total_pages: 3 },
    ),
  })
  const result = await invoke(tool, { method: "list", page: 3 }, CTX)
  expect(result).toEqual({
    label: "default",
    widgets: [{ ...EMPTY_WIDGET, ...WIDGET, domains: ["example.net", "www.example.net"] }, EMPTY_WIDGET],
    page: 3,
    per_page: 100,
    total_count: 201,
    total_pages: 3,
  })
  expect(Object.fromEntries(requests[0].query)).toEqual({ page: "3", per_page: "100", order: "name", direction: "asc" })
  for (const text of ["sk-made-up", "secret", "extra", "hidden"]) {
    expect(JSON.stringify(result)).not.toContain(text)
  }
})

test("list defaults to page one and null paging fields when absent", async () => {
  const { tool, requests } = toolFor({ method: "GET", path: WIDGETS_PATH, reply: ok([]) })
  expect(await invoke(tool, { method: "list" }, CTX)).toEqual({
    label: "default",
    widgets: [],
    page: null,
    per_page: null,
    total_count: null,
    total_pages: null,
  })
  expect(Object.fromEntries(requests[0].query)).toEqual({ page: "1", per_page: "100", order: "name", direction: "asc" })
})

test("view by trimmed sitekey projects every field and excludes secrets", async () => {
  const widget = {
    ...WIDGET,
    domains: ["example.net"],
    mode: "managed",
    clearance_level: "interactive",
    region: "world",
    bot_fight_mode: false,
    ephemeral_id: true,
    offlabel: false,
    created_on: "2026-01-01",
    modified_on: "2026-02-01",
  }
  const { tool, requests } = toolFor({
    method: "GET",
    path: WIDGET_PATH,
    reply: ok({ ...widget, secret: "sk-made-up", extra: "hidden" }),
  })
  const result = await invoke(tool, { method: "view", sitekey: ` ${SITEKEY} ` }, CTX)
  expect(result).toEqual({ label: "default", widget })
  expect(requests.map(({ path }) => path)).toEqual([WIDGET_PATH])
  for (const text of ["sk-made-up", "secret", "extra", "hidden"]) {
    expect(JSON.stringify(result)).not.toContain(text)
  }
})

test("missing and wrong optional field types become null or empty domains", async () => {
  for (const raw of [
    { sitekey: SITEKEY },
    {
      sitekey: SITEKEY,
      name: 1,
      domains: "example.net",
      mode: false,
      clearance_level: [],
      region: {},
      bot_fight_mode: "false",
      ephemeral_id: 1,
      offlabel: "true",
      created_on: 1,
      modified_on: false,
    },
  ]) {
    const { tool } = toolFor({ method: "GET", path: WIDGET_PATH, reply: ok(raw) })
    expect((await invoke(tool, { method: "view", sitekey: SITEKEY }, CTX)).widget).toEqual(EMPTY_WIDGET)
  }
})

test("view accepts a 64-character sitekey without a name lookup", async () => {
  const sitekey = "A_-" + "a".repeat(61)
  const path = `${WIDGETS_PATH}/${sitekey}`
  const { tool, requests } = toolFor({ method: "GET", path, reply: ok({ sitekey }) })
  expect((await invoke(tool, { method: "view", sitekey }, CTX)).widget?.sitekey).toBe(sitekey)
  expect(requests.map(({ path }) => path)).toEqual([path])
})
