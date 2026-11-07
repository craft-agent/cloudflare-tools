import { describe, expect, test } from "bun:test"
import { toolError, ZONE_ID } from "../cloudflare/client.fixtures"
import { invoke } from "../tool"
import { confirming, CTX, setupWith } from "./delete.fixtures"
import { A_RECORD, A_RECORD_ID, batchRequests, CAA_RECORD, MX_RECORD, TXT_RECORD } from "./fixtures"

const PREFIX = `Delete 2 DNS records of zone example.com (${ZONE_ID}) in the Cloudflare account default: `
const SUFFIX = ". A deleted record stops answering; resolvers may keep it for its TTL."

/** The message the tool asked with, for the records read and the call's `ids` and `add`. */
async function askedWith(records: { id: string }[], args: { ids: string[]; add?: unknown[] }): Promise<string> {
  const { tool } = setupWith(records)
  const { asked, ctx } = confirming(true)

  await invoke(tool, { zone: ZONE_ID, ...args }, ctx)

  expect(asked).toHaveLength(1)
  expect(asked[0]!.tool).toBe("cloudflare_dns_record_delete")
  return asked[0]!.message
}

describe("cloudflareDnsRecordDelete: confirmation", () => {
  test("states the zone, the account, each record and each replacement in one line", async () => {
    const message = await askedWith([A_RECORD, TXT_RECORD], {
      ids: [A_RECORD_ID, TXT_RECORD.id],
      add: [{ type: "CNAME", name: "www", content: "target.example.net" }],
    })

    expect(message).toBe(
      `${PREFIX}A www → 192.0.2.1, TXT _dmarc → "v=DMARC1; p=none", and add 1: CNAME www → target.example.net${SUFFIX}`,
    )
    expect(message).not.toContain("\n")
  })

  test("says `record` for one record and leaves out the replacements when there are none", async () => {
    const message = await askedWith([A_RECORD], { ids: [A_RECORD_ID] })

    expect(message).toBe(
      `Delete 1 DNS record of zone example.com (${ZONE_ID}) in the Cloudflare account default: A www → 192.0.2.1${SUFFIX}`,
    )
  })

  test("writes the apex as @ and puts an MX preference before its host", async () => {
    const message = await askedWith([MX_RECORD, A_RECORD], { ids: [MX_RECORD.id, A_RECORD_ID] })

    expect(message).toBe(`${PREFIX}MX @ → 10 mail.example.com, A www → 192.0.2.1${SUFFIX}`)
  })

  test("shows a CAA record as Cloudflare does and a new CAA record compactly", async () => {
    const message = await askedWith([CAA_RECORD, A_RECORD], {
      ids: [CAA_RECORD.id, A_RECORD_ID],
      add: [{ type: "CAA", name: "@", data: { flags: 0, tag: "issuewild", value: "pki.example.org" } }],
    })

    expect(message).toContain('CAA @ → 0 issue "letsencrypt.org", A www')
    expect(message).toContain(", and add 1: CAA @ → 0 issuewild pki.example.org.")
  })

  test("clips a long value to 60 characters and keeps a multi-line value on one line", async () => {
    const long = { ...TXT_RECORD, content: `${"x".repeat(80)}` }
    const lines = { ...A_RECORD, content: "first\n\n   second\tthird" }
    const message = await askedWith([long, lines], { ids: [long.id, lines.id] })

    expect(message).toBe(`${PREFIX}TXT _dmarc → ${"x".repeat(60)}…, A www → first second third${SUFFIX}`)
  })

  test("asks before the batch is sent", async () => {
    const { tool, requests } = setupWith([A_RECORD])
    const { ctx } = confirming(true)
    let sentWhenAsked = -1
    const ask = ctx.confirm

    await invoke(
      tool,
      { zone: ZONE_ID, ids: [A_RECORD_ID] },
      { ...ctx, confirm: async (request) => ((sentWhenAsked = batchRequests(requests).length), ask(request)) },
    )

    expect(sentWhenAsked).toBe(0)
    expect(batchRequests(requests)).toHaveLength(1)
  })

  test("a declined confirmation is `declined` and sends no batch", async () => {
    const { tool, requests } = setupWith([A_RECORD])
    const { asked, ctx } = confirming(false)

    const error = await toolError(invoke(tool, { zone: ZONE_ID, ids: [A_RECORD_ID] }, ctx))

    expect(error.code).toBe("declined")
    expect(error.message).toContain("Delete 1 DNS record of zone example.com")
    expect(asked).toHaveLength(1)
    expect(batchRequests(requests)).toEqual([])
  })

  test("without a confirmation hook the harness's approval stands and the call proceeds", async () => {
    const { tool, requests } = setupWith([A_RECORD])

    await invoke(tool, { zone: ZONE_ID, ids: [A_RECORD_ID] }, CTX)

    expect(batchRequests(requests)).toHaveLength(1)
  })
})
