import { describe, expect, test } from "bun:test"
import { ACCOUNT_ID, rejection, ZONE_ID } from "../cloudflare/client.fixtures"
import { fail } from "../cloudflare/testing"
import { isAbortError } from "../errors"
import { writeTargets } from "../targets"
import { CTX, setup, ZONE_PATH } from "./delete.fixtures"
import { A_RECORD, A_RECORD_ID, batchRoute, recordPath, recordRoute, TXT_RECORD } from "./fixtures"

const BASE = `${ACCOUNT_ID}/zones/${ZONE_ID}/dns_records`
const WILDCARD_RECORD = { ...A_RECORD, id: "7".repeat(32), name: "*.example.com" }

describe("cloudflareDnsRecordDelete: targets", () => {
  test("name each deleted record by its full name", async () => {
    const { tool } = setup(recordRoute(A_RECORD), recordRoute(TXT_RECORD), batchRoute())

    const targets = await tool.targets!({ zone: ZONE_ID, ids: [A_RECORD_ID, TXT_RECORD.id] }, CTX)

    expect(targets).toEqual([`${BASE}/www.example.com`, `${BASE}/_dmarc.example.com`])
  })

  test("add the full name of each new record, written relative, full or as the apex", async () => {
    const { tool } = setup(recordRoute(A_RECORD), batchRoute())

    const targets = await tool.targets!(
      {
        zone: ZONE_ID,
        ids: [A_RECORD_ID],
        add: [
          { type: "CNAME", name: "API", content: "a.example.net" },
          { type: "TXT", name: "@", content: "hello" },
          { type: "TXT", name: "m.example.com.", content: "hello" },
        ],
      },
      CTX,
    )

    expect(targets).toEqual([
      `${BASE}/www.example.com`,
      `${BASE}/api.example.com`,
      `${BASE}/example.com`,
      `${BASE}/m.example.com`,
    ])
  })

  test("name a name once, whether it is deleted or added, as in a type change", async () => {
    const { tool } = setup(recordRoute(A_RECORD), batchRoute())

    const targets = await tool.targets!(
      { zone: ZONE_ID, ids: [A_RECORD_ID], add: [{ type: "CNAME", name: "WWW", content: "a.example.net" }] },
      CTX,
    )

    expect(targets).toEqual([`${BASE}/www.example.com`])
  })

  test("reach a permission rule as `*` for a wildcard name, deleted or added", async () => {
    const { tool } = setup(recordRoute(A_RECORD), recordRoute(WILDCARD_RECORD), batchRoute())

    expect(await writeTargets(tool, { zone: ZONE_ID, ids: [A_RECORD_ID, WILDCARD_RECORD.id] }, CTX)).toEqual([
      `${BASE}/www.example.com`,
      "*",
    ])
    expect(
      await writeTargets(
        tool,
        { zone: ZONE_ID, ids: [A_RECORD_ID], add: [{ type: "A", name: "*.sub", content: "192.0.2.1" }] },
        CTX,
      ),
    ).toEqual([`${BASE}/www.example.com`, "*"])
  })

  test("are `*` when a record cannot be read", async () => {
    const { tool } = setup(recordRoute(A_RECORD), batchRoute())

    expect(await tool.targets!({ zone: ZONE_ID, ids: [A_RECORD_ID, "9".repeat(32)] }, CTX)).toEqual(["*"])
  })

  test("are `*` when a record read fails for another reason", async () => {
    const { tool } = setup({
      method: "GET",
      path: recordPath(A_RECORD_ID),
      reply: fail(500, [{ code: 1000, message: "Down" }]),
    })

    expect(await tool.targets!({ zone: ZONE_ID, ids: [A_RECORD_ID] }, CTX)).toEqual(["*"])
  })

  test("are `*` when a new name cannot be told", async () => {
    const { tool } = setup(recordRoute(A_RECORD), batchRoute())

    expect(
      await tool.targets!(
        { zone: ZONE_ID, ids: [A_RECORD_ID], add: [{ type: "A", name: "bad name", content: "192.0.2.1" }] },
        CTX,
      ),
    ).toEqual(["*"])
  })

  test("are `*` when the zone cannot be found", async () => {
    const { tool } = setup(recordRoute(A_RECORD), {
      method: "GET",
      path: ZONE_PATH,
      reply: fail(404, [{ code: 7003, message: "No" }]),
    })

    expect(await tool.targets!({ zone: ZONE_ID, ids: [A_RECORD_ID] }, CTX)).toEqual(["*"])
  })

  test("pass a cancellation on instead of turning it into `*`", async () => {
    const controller = new AbortController()
    controller.abort()
    const { tool } = setup(recordRoute(A_RECORD))

    const error = await rejection(
      writeTargets(tool, { zone: ZONE_ID, ids: [A_RECORD_ID] }, { ...CTX, signal: controller.signal }),
    )

    expect(isAbortError(error)).toBe(true)
  })
})
