import { describe, expect, test } from "bun:test"
import { rejection, toolError, ZONE_ID } from "../cloudflare/client.fixtures"
import { ok } from "../cloudflare/testing"
import { isToolError } from "../errors"
import { invoke } from "../tool"
import { OTHER_ACCOUNT_ID, SAMPLE_ZONE } from "../zone/fixtures"
import { confirming, CTX, setup, setupWith, ZONE_PATH } from "./delete.fixtures"
import {
  A_RECORD,
  A_RECORD_ID,
  batchRequests,
  batchRoute,
  PRODUCT_RECORD,
  recordPath,
  recordRoute,
  WORKER_RECORD,
} from "./fixtures"

const NEW_A = { type: "A" as const, name: "api", content: "192.0.2.9" }

/** The refusal of a call: its error, the requests the tool sent, and what the confirmation was asked. */
async function refusal(records: { id: string }[], args: Record<string, unknown>) {
  const { tool, requests } = setupWith(records)
  const { asked, ctx } = confirming(true)
  const error = await toolError(invoke(tool, { zone: ZONE_ID, ...args }, ctx))
  expect(batchRequests(requests)).toEqual([])
  expect(asked).toEqual([])
  return { error, requests }
}

describe("cloudflareDnsRecordDelete: refusals before anything is sent", () => {
  test("the same id twice, in either case, is refused before any request", async () => {
    const { tool, requests } = setupWith([A_RECORD])

    const error = await toolError(
      invoke(tool, { zone: ZONE_ID, ids: [A_RECORD_ID, "9".repeat(32), A_RECORD_ID.toUpperCase()] }, CTX),
    )

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toStartWith("ids[2] repeats ids[0]")
    expect(requests).toEqual([])
  })

  test("a record read-only because another Cloudflare product manages it is refused", async () => {
    const { error } = await refusal([A_RECORD, PRODUCT_RECORD], { ids: [A_RECORD_ID, PRODUCT_RECORD.id] })

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toBe("ids[1] (A x): is managed by another Cloudflare product and is changed there.")
  })

  test("a Worker's custom domain is named as such", async () => {
    const { error } = await refusal([WORKER_RECORD], { ids: [WORKER_RECORD.id] })

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toStartWith(
      "ids[0] (A app): is managed by another Cloudflare product (a Worker's custom domain)",
    )
  })

  test("an invalid new record is refused, naming its position", async () => {
    const { error } = await refusal([A_RECORD], {
      ids: [A_RECORD_ID],
      add: [NEW_A, { type: "A", name: "bad", content: "not-an-address" }],
    })

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toStartWith("add[1] (A bad): content")
  })

  test("a new record repeated is refused, in the wording of the add tool", async () => {
    const { error } = await refusal([A_RECORD], {
      ids: [A_RECORD_ID],
      add: [NEW_A, { ...NEW_A, name: "API.example.com." }],
    })

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toStartWith("add[1] repeats add[0] (A api)")
  })

  test("a new record that points at its own name is refused though the deletion is valid", async () => {
    const { error } = await refusal([A_RECORD], {
      ids: [A_RECORD_ID],
      add: [{ type: "CNAME", name: "www", content: "www.example.com" }],
    })

    expect(error.message).toStartWith("add[0] (CNAME www): content")
  })
})

describe("cloudflareDnsRecordDelete: records that cannot be read", () => {
  test("a record that is not in the zone is not_found, naming its position and where to look", async () => {
    const { tool, requests } = setup(recordRoute(A_RECORD), batchRoute())
    const missing = "9".repeat(32)

    const error = await toolError(invoke(tool, { zone: ZONE_ID, ids: [A_RECORD_ID, missing] }, CTX))

    expect(error.code).toBe("not_found")
    expect(error.message).toBe(
      `ids[1]: no record ${missing} in the zone example.com; cloudflare_dns_read list shows its records.`,
    )
    expect(batchRequests(requests)).toEqual([])
    expect(requests.map((request) => request.path)).toContain(recordPath(missing))
  })

  test("the first missing record in order is the one reported", async () => {
    const { tool } = setup(batchRoute())

    const error = await toolError(invoke(tool, { zone: ZONE_ID, ids: ["8".repeat(32), "9".repeat(32)] }, CTX))

    expect(error.message).toStartWith(`ids[0]: no record ${"8".repeat(32)}`)
  })

  test("a reply that is not an object is an upstream_error", async () => {
    const { tool, requests } = setup(
      { method: "GET", path: recordPath(A_RECORD_ID), reply: ok([A_RECORD]) },
      batchRoute(),
    )

    const error = await toolError(invoke(tool, { zone: ZONE_ID, ids: [A_RECORD_ID] }, CTX))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toStartWith("ids[0]: ")
    expect(batchRequests(requests)).toEqual([])
  })

  test("a zone of another account is refused before a record is read", async () => {
    const { tool, requests } = setup(
      { method: "GET", path: ZONE_PATH, reply: ok({ ...SAMPLE_ZONE, account: { id: OTHER_ACCOUNT_ID } }) },
      recordRoute(A_RECORD),
      batchRoute(),
    )

    const error = await toolError(invoke(tool, { zone: ZONE_ID, ids: [A_RECORD_ID] }, CTX))

    expect(error.code).toBe("not_found")
    expect(requests.map((request) => request.path)).toEqual([ZONE_PATH])
  })
})

describe("cloudflareDnsRecordDelete: arguments", () => {
  async function schemaRefusal(args: unknown): Promise<string> {
    const { tool, requests } = setupWith([A_RECORD])
    const error = await rejection(invoke(tool, args, CTX))
    if (!isToolError(error) || error.code !== "invalid_argument") throw new Error(`Unexpected error: ${String(error)}`)
    expect(requests).toEqual([])
    return error.message
  }

  test("refuses more than 20 ids, no ids, and a missing list or zone", async () => {
    const ids = Array.from({ length: 21 }, (_, index) => index.toString(16).padStart(32, "0"))

    expect(await schemaRefusal({ zone: ZONE_ID, ids })).toContain("ids")
    expect(await schemaRefusal({ zone: ZONE_ID, ids: [] })).toContain("ids")
    expect(await schemaRefusal({ zone: ZONE_ID })).toContain("ids")
    expect(await schemaRefusal({ ids: [A_RECORD_ID] })).toContain("zone")
  })

  test("refuses more than 20 new records", async () => {
    const add = Array.from({ length: 21 }, (_, index) => ({ ...NEW_A, name: `h${index}` }))

    expect(await schemaRefusal({ zone: ZONE_ID, ids: [A_RECORD_ID], add })).toContain("add")
  })

  test("refuses an id that is not 32 hex digits and an unknown argument, also inside a new record", async () => {
    expect(await schemaRefusal({ zone: ZONE_ID, ids: ["abc"] })).toContain("ids")
    expect(await schemaRefusal({ zone: ZONE_ID, ids: [A_RECORD_ID], force: true })).toContain("force: unknown argument")
    expect(await schemaRefusal({ zone: ZONE_ID, ids: [A_RECORD_ID], add: [{ ...NEW_A, id: "x" }] })).toContain(
      "add.0.id: unknown argument",
    )
  })

  test("accepts 20 ids and 20 new records", async () => {
    const records = Array.from({ length: 20 }, (_, index) => ({
      ...A_RECORD,
      id: index.toString(16).padStart(32, "0"),
    }))
    const add = Array.from({ length: 20 }, (_, index) => ({ ...NEW_A, name: `h${index}` }))
    const { tool, requests } = setupWith(records)

    await invoke(tool, { zone: ZONE_ID, ids: records.map((record) => record.id), add }, CTX)

    expect(batchRequests(requests)).toHaveLength(1)
  })
})
