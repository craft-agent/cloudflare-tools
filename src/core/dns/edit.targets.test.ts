import { describe, expect, test } from "bun:test"
import { ACCOUNT_ID, rejection, ZONE_ID } from "../cloudflare/client.fixtures"
import { fail } from "../cloudflare/testing"
import { isAbortError } from "../errors"
import { writeTargets } from "../targets"
import { CNAME_RECORD, CTX, PLAIN_A_RECORD, setup, ZONE_PATH } from "./edit.fixtures"
import { A_RECORD, A_RECORD_ID, batchRoute, recordPath, recordRoute } from "./fixtures"

const BASE = `${ACCOUNT_ID}/zones/${ZONE_ID}/dns_records`

describe("cloudflareDnsRecordEdit: targets", () => {
  test("name each record by its current full name", async () => {
    const { tool } = setup(recordRoute(A_RECORD), recordRoute(PLAIN_A_RECORD), batchRoute())

    const targets = await tool.targets!(
      {
        zone: ZONE_ID,
        changes: [
          { id: A_RECORD_ID, ttl: 600 },
          { id: PLAIN_A_RECORD.id, ttl: 600 },
        ],
      },
      CTX,
    )

    expect(targets).toEqual([`${BASE}/www.example.com`, `${BASE}/api.example.com`])
  })

  test("add the new full name of a renamed record, written relative, full or as the apex", async () => {
    const { tool } = setup(recordRoute(A_RECORD), recordRoute(CNAME_RECORD), batchRoute())

    const targets = await tool.targets!(
      {
        zone: ZONE_ID,
        changes: [
          { id: A_RECORD_ID, name: "WEB" },
          { id: CNAME_RECORD.id, name: "@" },
        ],
      },
      CTX,
    )

    expect(targets).toEqual([
      `${BASE}/www.example.com`,
      `${BASE}/web.example.com`,
      `${BASE}/blog.example.com`,
      `${BASE}/example.com`,
    ])
  })

  test("name a name once, whether it is current or new", async () => {
    const { tool } = setup(recordRoute(A_RECORD), recordRoute(PLAIN_A_RECORD), batchRoute())

    const targets = await tool.targets!(
      {
        zone: ZONE_ID,
        changes: [
          { id: A_RECORD_ID, name: "api" },
          { id: PLAIN_A_RECORD.id, name: "www.example.com." },
        ],
      },
      CTX,
    )

    expect(targets).toEqual([`${BASE}/www.example.com`, `${BASE}/api.example.com`])
  })

  test("reach a permission rule sorted, and `*` for a wildcard new name", async () => {
    const { tool } = setup(recordRoute(A_RECORD), batchRoute())

    expect(await writeTargets(tool, { zone: ZONE_ID, changes: [{ id: A_RECORD_ID, name: "*.sub" }] }, CTX)).toEqual([
      `${BASE}/www.example.com`,
      "*",
    ])
  })

  test("are `*` when a new name cannot be told", async () => {
    const { tool } = setup(recordRoute(A_RECORD), batchRoute())

    expect(await tool.targets!({ zone: ZONE_ID, changes: [{ id: A_RECORD_ID, name: "bad name" }] }, CTX)).toEqual(["*"])
  })

  test("are `*` when a record cannot be read", async () => {
    const { tool } = setup(recordRoute(A_RECORD), batchRoute())

    expect(
      await tool.targets!(
        {
          zone: ZONE_ID,
          changes: [
            { id: A_RECORD_ID, ttl: 600 },
            { id: "9".repeat(32), ttl: 600 },
          ],
        },
        CTX,
      ),
    ).toEqual(["*"])
  })

  test("are `*` when a record read fails for another reason", async () => {
    const { tool } = setup({
      method: "GET",
      path: recordPath(A_RECORD_ID),
      reply: fail(500, [{ code: 1000, message: "Down" }]),
    })

    expect(await tool.targets!({ zone: ZONE_ID, changes: [{ id: A_RECORD_ID, ttl: 600 }] }, CTX)).toEqual(["*"])
  })

  test("are `*` when the zone cannot be found", async () => {
    const { tool } = setup(recordRoute(A_RECORD), {
      method: "GET",
      path: ZONE_PATH,
      reply: fail(404, [{ code: 7003, message: "No" }]),
    })

    expect(await tool.targets!({ zone: ZONE_ID, changes: [{ id: A_RECORD_ID, ttl: 600 }] }, CTX)).toEqual(["*"])
  })

  test("pass a cancellation on instead of turning it into `*`", async () => {
    const controller = new AbortController()
    controller.abort()
    const { tool } = setup(recordRoute(A_RECORD))

    const error = await rejection(
      writeTargets(
        tool,
        { zone: ZONE_ID, changes: [{ id: A_RECORD_ID, ttl: 600 }] },
        { ...CTX, signal: controller.signal },
      ),
    )

    expect(isAbortError(error)).toBe(true)
  })
})
