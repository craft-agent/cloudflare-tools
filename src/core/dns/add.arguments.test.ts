import { describe, expect, test } from "bun:test"
import { rejection, ZONE_ID } from "../cloudflare/client.fixtures"
import { isToolError } from "../errors"
import { invoke } from "../tool"
import { CTX, setup } from "./add.fixtures"
import { batchRoute } from "./fixtures"

const RECORD = { type: "A" as const, name: "www", content: "192.0.2.1" }

async function refusalOf(args: unknown): Promise<string> {
  const { tool, requests } = setup(batchRoute())
  const error = await rejection(invoke(tool, args, CTX))
  if (!isToolError(error) || error.code !== "invalid_argument") throw new Error(`Unexpected error: ${String(error)}`)
  expect(requests).toEqual([])
  return error.message
}

describe("cloudflareDnsRecordAdd: arguments", () => {
  test("refuses more than 20 records", async () => {
    const records = Array.from({ length: 21 }, (_, index) => ({ ...RECORD, name: `h${index}` }))

    expect(await refusalOf({ zone: ZONE_ID, records })).toContain("records")
  })

  test("refuses no records and a missing list or zone", async () => {
    expect(await refusalOf({ zone: ZONE_ID, records: [] })).toContain("records")
    expect(await refusalOf({ zone: ZONE_ID })).toContain("records")
    expect(await refusalOf({ records: [RECORD] })).toContain("zone")
  })

  test("accepts 20 records", async () => {
    const records = Array.from({ length: 20 }, (_, index) => ({ ...RECORD, name: `h${index}` }))
    const { tool, requests } = setup(batchRoute())

    await invoke(tool, { zone: ZONE_ID, records }, CTX)

    expect(requests.at(-1)?.body).toMatchObject({
      posts: expect.arrayContaining([expect.objectContaining({ name: "h19.example.com" })]),
    })
  })

  test("refuses an unknown argument, also inside a record or its data", async () => {
    expect(await refusalOf({ zone: ZONE_ID, records: [RECORD], force: true })).toContain("force: unknown argument")
    expect(await refusalOf({ zone: ZONE_ID, records: [{ ...RECORD, id: "x" }] })).toContain(
      "records.0.id: unknown argument",
    )
    expect(
      await refusalOf({
        zone: ZONE_ID,
        records: [{ type: "CAA", name: "@", data: { flags: 0, tag: "issue", value: "x", extra: 1 } }],
      }),
    ).toContain("records.0.data.extra: unknown argument")
  })

  test("refuses a type that cannot be written", async () => {
    expect(await refusalOf({ zone: ZONE_ID, records: [{ type: "SOA", name: "@", content: "x" }] })).toContain("type")
  })
})
