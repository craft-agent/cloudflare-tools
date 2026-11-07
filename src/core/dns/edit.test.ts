import { describe, expect, test } from "bun:test"
import { toolError, ZONE_ID } from "../cloudflare/client.fixtures"
import { fail, ok } from "../cloudflare/testing"
import { annotations, invoke } from "../tool"
import { cloudflareDnsRecordEdit } from "./edit"
import { CNAME_RECORD, CTX, pathsOf, PLAIN_A_RECORD, setup, setupWith, SRV_RECORD, ZONE_PATH } from "./edit.fixtures"
import {
  A_RECORD,
  A_RECORD_ID,
  batchRequests,
  batchRoute,
  CAA_RECORD,
  recordPath,
  recordRoute,
  SHAPED_A_RECORD,
  TXT_RECORD,
} from "./fixtures"
import { shapeRecord } from "./records"

describe("cloudflareDnsRecordEdit: metadata", () => {
  test("publishes overwrite class annotations", () => {
    expect(annotations(cloudflareDnsRecordEdit)).toEqual({
      title: "Change Cloudflare DNS records",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    })
  })

  test("belongs to the dns toolset and names what to use for a type change", () => {
    expect(cloudflareDnsRecordEdit.id).toBe("cloudflare_dns_record_edit")
    expect(cloudflareDnsRecordEdit.toolset).toBe("dns")
    expect(cloudflareDnsRecordEdit.description).toContain("all are changed or none is")
    expect(cloudflareDnsRecordEdit.description).toContain("cloudflare_dns_record_delete")
  })
})

describe("cloudflareDnsRecordEdit: changing", () => {
  test("sends one batch with only the changed fields and returns each record before and after", async () => {
    const patched = [
      { ...CNAME_RECORD, name: "news.example.com" },
      { ...A_RECORD, comment: null },
      { ...PLAIN_A_RECORD, content: "192.0.2.9", ttl: 600 },
    ]
    const { tool, requests } = setupWith([PLAIN_A_RECORD, A_RECORD, CNAME_RECORD], patched)

    const result = await invoke(
      tool,
      {
        zone: ZONE_ID,
        changes: [
          { id: PLAIN_A_RECORD.id, content: "192.0.2.9", ttl: 600 },
          { id: A_RECORD_ID, comment: "" },
          { id: CNAME_RECORD.id, type: "CNAME", name: "News" },
        ],
      },
      CTX,
    )

    expect(batchRequests(requests)).toHaveLength(1)
    expect(batchRequests(requests)[0]).toMatchObject({
      method: "POST",
      body: {
        patches: [
          { id: PLAIN_A_RECORD.id, type: "A", content: "192.0.2.9", ttl: 600 },
          { id: A_RECORD_ID, type: "A", comment: "" },
          { id: CNAME_RECORD.id, type: "CNAME", name: "news.example.com" },
        ],
      },
    })
    expect(Object.keys(batchRequests(requests)[0]!.body as object)).toEqual(["patches"])
    expect(pathsOf(requests).at(-1)).toBe(`${ZONE_PATH}/dns_records/batch`)
    expect(result.label).toBe("default")
    expect(result.zone).toEqual({ id: ZONE_ID, name: "example.com" })
    expect(result.changed.map((item) => item.id)).toEqual([PLAIN_A_RECORD.id, A_RECORD_ID, CNAME_RECORD.id])
    expect(result.changed[0]).toEqual({
      id: PLAIN_A_RECORD.id,
      before: shapeRecord(PLAIN_A_RECORD),
      after: shapeRecord(patched[2]),
    })
    expect(result.changed[1]!.before).toEqual(SHAPED_A_RECORD)
    expect(result.changed[1]!.after).toMatchObject({ comment: null })
    expect(result.changed[2]!.after).toMatchObject({ name: "news.example.com" })
  })

  test("reads a record by its lowercase id and patches with it", async () => {
    const { tool, requests } = setupWith([A_RECORD], [A_RECORD])

    await invoke(tool, { zone: ZONE_ID, changes: [{ id: A_RECORD_ID.toUpperCase(), ttl: 600, proxied: false }] }, CTX)

    expect(pathsOf(requests)).toContain(recordPath(A_RECORD_ID))
    expect(batchRequests(requests)[0]!.body).toEqual({
      patches: [{ id: A_RECORD_ID, type: "A", ttl: 600, proxied: false }],
    })
  })

  test("`after` is null when the batch result lacks the record", async () => {
    const { tool } = setupWith([A_RECORD], [])

    const result = await invoke(tool, { zone: ZONE_ID, changes: [{ id: A_RECORD_ID, comment: "new" }] }, CTX)

    expect(result.changed).toEqual([{ id: A_RECORD_ID, before: SHAPED_A_RECORD, after: null }])
  })

  test("a type that matches the record's is accepted", async () => {
    const { tool, requests } = setupWith([A_RECORD], [A_RECORD])

    await invoke(tool, { zone: ZONE_ID, changes: [{ id: A_RECORD_ID, type: "A", comment: "new" }] }, CTX)

    expect(batchRequests(requests)[0]!.body).toEqual({ patches: [{ id: A_RECORD_ID, type: "A", comment: "new" }] })
  })
})

describe("cloudflareDnsRecordEdit: the rules of add apply to the result", () => {
  test("proxying a record with ttl 300 is refused, naming the ttl", async () => {
    const { tool, requests } = setupWith([PLAIN_A_RECORD])

    const error = await toolError(
      invoke(tool, { zone: ZONE_ID, changes: [{ id: PLAIN_A_RECORD.id, proxied: true }] }, CTX),
    )

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toStartWith("changes[0] (A api): a proxied record's TTL is automatic")
    expect(batchRequests(requests)).toEqual([])
  })

  test("proxying it with ttl 1 in the same change is accepted", async () => {
    const { tool, requests } = setupWith([PLAIN_A_RECORD], [PLAIN_A_RECORD])

    await invoke(tool, { zone: ZONE_ID, changes: [{ id: PLAIN_A_RECORD.id, proxied: true, ttl: 1 }] }, CTX)

    expect(batchRequests(requests)[0]!.body).toEqual({
      patches: [{ id: PLAIN_A_RECORD.id, type: "A", ttl: 1, proxied: true }],
    })
  })

  test("a TXT record Cloudflare returns quoted keeps its text, so changing only the ttl sends only the ttl", async () => {
    const { tool, requests } = setupWith([TXT_RECORD], [TXT_RECORD])

    await invoke(tool, { zone: ZONE_ID, changes: [{ id: TXT_RECORD.id, ttl: 300 }] }, CTX)

    expect(batchRequests(requests)[0]!.body).toEqual({ patches: [{ id: TXT_RECORD.id, type: "TXT", ttl: 300 }] })
  })

  test("a new TXT value is sent without quotes", async () => {
    const { tool, requests } = setupWith([TXT_RECORD], [TXT_RECORD])

    await invoke(tool, { zone: ZONE_ID, changes: [{ id: TXT_RECORD.id, content: "v=DMARC1; p=reject" }] }, CTX)

    expect(batchRequests(requests)[0]!.body).toEqual({
      patches: [{ id: TXT_RECORD.id, type: "TXT", content: "v=DMARC1; p=reject" }],
    })
  })

  test("a CAA data change sends only data", async () => {
    const { tool, requests } = setupWith([CAA_RECORD], [CAA_RECORD])
    const data = { flags: 0, tag: "issuewild", value: "letsencrypt.org" }

    await invoke(tool, { zone: ZONE_ID, changes: [{ id: CAA_RECORD.id, data }] }, CTX)

    expect(batchRequests(requests)[0]!.body).toEqual({ patches: [{ id: CAA_RECORD.id, type: "CAA", data }] })
  })

  test("an SRV record's extra data keys from Cloudflare are not carried over", async () => {
    const { tool, requests } = setupWith([SRV_RECORD], [SRV_RECORD])

    await invoke(tool, { zone: ZONE_ID, changes: [{ id: SRV_RECORD.id, ttl: 600 }] }, CTX)

    expect(batchRequests(requests)[0]!.body).toEqual({ patches: [{ id: SRV_RECORD.id, type: "SRV", ttl: 600 }] })
  })

  test("changing one SRV key sends the whole data without the extra keys", async () => {
    const { tool, requests } = setupWith([SRV_RECORD], [SRV_RECORD])
    const data = { priority: 20, weight: 5, port: 5060, target: "sip.example.org" }

    await invoke(tool, { zone: ZONE_ID, changes: [{ id: SRV_RECORD.id, data }] }, CTX)

    expect(batchRequests(requests)[0]!.body).toEqual({ patches: [{ id: SRV_RECORD.id, type: "SRV", data }] })
  })
})

describe("cloudflareDnsRecordEdit: Cloudflare failures", () => {
  test("a 400 says nothing was changed", async () => {
    const { tool } = setup(
      recordRoute(A_RECORD),
      batchRoute(fail(400, [{ code: 81058, message: "An identical record already exists." }])),
    )

    const error = await toolError(invoke(tool, { zone: ZONE_ID, changes: [{ id: A_RECORD_ID, comment: "new" }] }, CTX))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("An identical record already exists.")
    expect(error.message).toEndWith(" Nothing was changed.")
  })

  test("a 500 says the batch may or may not have been applied", async () => {
    const { tool } = setup(recordRoute(A_RECORD), batchRoute(fail(500, [{ code: 1000, message: "Internal error" }])))

    const error = await toolError(invoke(tool, { zone: ZONE_ID, changes: [{ id: A_RECORD_ID, comment: "new" }] }, CTX))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toContain("may or may not have applied the whole batch")
  })

  test("a record read that fails otherwise passes through", async () => {
    const { tool, requests } = setup(
      { method: "GET", path: recordPath(A_RECORD_ID), reply: fail(500, [{ code: 1000, message: "Down" }]) },
      batchRoute(ok({})),
    )

    const error = await toolError(invoke(tool, { zone: ZONE_ID, changes: [{ id: A_RECORD_ID, comment: "new" }] }, CTX))

    expect(error.code).toBe("upstream_error")
    expect(batchRequests(requests)).toEqual([])
  })
})
