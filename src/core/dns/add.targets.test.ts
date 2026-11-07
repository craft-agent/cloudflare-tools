import { describe, expect, test } from "bun:test"
import { ACCOUNT_ID, rejection, ZONE_ID } from "../cloudflare/client.fixtures"
import { fail, ok } from "../cloudflare/testing"
import { isAbortError } from "../errors"
import { writeTargets } from "../targets"
import { OTHER_ACCOUNT_ID, SAMPLE_ZONE } from "../zone/fixtures"
import { batchRoute, CTX, setup, ZONE_PATH } from "./add.fixtures"

const BASE = `${ACCOUNT_ID}/zones/${ZONE_ID}/dns_records`

function records(...names: string[]) {
  return names.map((name) => ({ type: "A" as const, name, content: "192.0.2.1" }))
}

describe("cloudflareDnsRecordAdd: targets", () => {
  test("name each record by its full name, whether written relative, full or as the apex", async () => {
    const { tool, requests } = setup(batchRoute())

    const targets = await tool.targets!({ zone: ZONE_ID, records: records("WWW", "api.example.com.", "@") }, CTX)

    expect(targets).toEqual([`${BASE}/www.example.com`, `${BASE}/api.example.com`, `${BASE}/example.com`])
    expect(requests.map((request) => request.path)).toEqual([ZONE_PATH])
  })

  test("name a name once however many records use it", async () => {
    const { tool } = setup(batchRoute())
    const mixed = [
      { type: "A" as const, name: "www", content: "192.0.2.1" },
      { type: "AAAA" as const, name: "www.example.com", content: "2001:db8::1" },
    ]

    expect(await tool.targets!({ zone: ZONE_ID, records: mixed }, CTX)).toEqual([`${BASE}/www.example.com`])
  })

  test("look a domain up, so the target carries the id", async () => {
    const { tool } = setup({ method: "GET", path: "/zones", reply: ok([SAMPLE_ZONE]) })

    expect(await tool.targets!({ zone: "example.com", records: records("www") }, CTX)).toEqual([
      `${BASE}/www.example.com`,
    ])
  })

  test("reach a permission rule sorted, and `*` for a wildcard name", async () => {
    const { tool } = setup(batchRoute())

    expect(await writeTargets(tool, { zone: ZONE_ID, records: records("www", "*.sub", "api") }, CTX)).toEqual([
      `${BASE}/api.example.com`,
      `${BASE}/www.example.com`,
      "*",
    ])
  })

  test("are `*` when a name cannot be told", async () => {
    const { tool } = setup(batchRoute())

    expect(await tool.targets!({ zone: ZONE_ID, records: records("www", "bad name") }, CTX)).toEqual(["*"])
  })

  test("are `*` when the zone cannot be found", async () => {
    const { tool } = setup({ method: "GET", path: ZONE_PATH, reply: fail(404, [{ code: 7003, message: "No" }]) })

    expect(await tool.targets!({ zone: ZONE_ID, records: records("www") }, CTX)).toEqual(["*"])
  })

  test("are `*` when the zone belongs to another account", async () => {
    const { tool } = setup({
      method: "GET",
      path: ZONE_PATH,
      reply: ok({ ...SAMPLE_ZONE, account: { id: OTHER_ACCOUNT_ID } }),
    })

    expect(await tool.targets!({ zone: ZONE_ID, records: records("www") }, CTX)).toEqual(["*"])
  })

  test("are `*` when the account has no credential", async () => {
    const { tool } = setup(batchRoute())

    expect(await tool.targets!({ zone: ZONE_ID, account: "nobody", records: records("www") }, CTX)).toEqual(["*"])
  })

  test("pass a cancellation on instead of turning it into `*`", async () => {
    const controller = new AbortController()
    controller.abort()
    const { tool } = setup(batchRoute())

    const error = await rejection(
      writeTargets(tool, { zone: ZONE_ID, records: records("www") }, { ...CTX, signal: controller.signal }),
    )

    expect(isAbortError(error)).toBe(true)
  })
})
