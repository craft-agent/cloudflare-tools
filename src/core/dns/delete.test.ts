import { describe, expect, test } from "bun:test"
import { toolError, ZONE_ID } from "../cloudflare/client.fixtures"
import { fail } from "../cloudflare/testing"
import { annotations, invoke, REQUIRES_USER_INTERACTION, toolMeta } from "../tool"
import { cloudflareDnsRecordDelete } from "./delete"
import { CTX, setup, setupWith } from "./delete.fixtures"
import {
  A_RECORD,
  A_RECORD_ID,
  batchRequests,
  batchRoute,
  CAA_RECORD,
  CNAME_RECORD,
  HTTPS_RECORD,
  MX_RECORD,
  recordRoute,
  SHAPED_A_RECORD,
  SRV_RECORD,
  TXT_RECORD,
} from "./fixtures"
import { shapeRecord } from "./records"

const NEW_CNAME = { ...CNAME_RECORD, name: "www.example.com", content: "target.example.net" }

describe("cloudflareDnsRecordDelete: metadata", () => {
  test("publishes administrative class annotations and asks even under an allow rule", () => {
    expect(annotations(cloudflareDnsRecordDelete)).toEqual({
      title: "Delete Cloudflare DNS records",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    })
    expect(toolMeta(cloudflareDnsRecordDelete)).toEqual({ [REQUIRES_USER_INTERACTION]: true })
  })

  test("belongs to the dns toolset and says what it does and what to watch for", () => {
    const { id, toolset, description } = cloudflareDnsRecordDelete

    expect(id).toBe("cloudflare_dns_record_delete")
    expect(toolset).toBe("dns")
    expect(description).toContain("always asks first")
    expect(description).toContain("all are deleted or none is")
    expect(description).toContain("add the new one with the same name")
    expect(description).toContain("resolvers may keep it up to its TTL")
    expect(description).toContain("read the records with cloudflare_dns_read before sending it again")
  })
})

describe("cloudflareDnsRecordDelete: deleting", () => {
  test("sends one batch of deletes and returns the records as they were", async () => {
    const { tool, requests } = setupWith([A_RECORD, TXT_RECORD], { deletes: [A_RECORD, TXT_RECORD] })

    const result = await invoke(tool, { zone: ZONE_ID, ids: [A_RECORD_ID, TXT_RECORD.id] }, CTX)

    expect(batchRequests(requests)).toHaveLength(1)
    expect(batchRequests(requests)[0]).toMatchObject({
      method: "POST",
      body: { deletes: [{ id: A_RECORD_ID }, { id: TXT_RECORD.id }] },
    })
    expect(Object.keys(batchRequests(requests)[0]!.body as object)).toEqual(["deletes"])
    expect(result).toEqual({
      label: "default",
      zone: { id: ZONE_ID, name: "example.com" },
      deleted: [SHAPED_A_RECORD, shapeRecord(TXT_RECORD)],
      added: [],
    })
  })

  test("reads and deletes by the lowercase id, and treats an empty `add` as none", async () => {
    const { tool, requests } = setupWith([A_RECORD])

    await invoke(tool, { zone: ZONE_ID, ids: [A_RECORD_ID.toUpperCase()], add: [] }, CTX)

    expect(requests.map((request) => request.path)).toContain(`/zones/${ZONE_ID}/dns_records/${A_RECORD_ID}`)
    expect(batchRequests(requests)[0]!.body).toEqual({ deletes: [{ id: A_RECORD_ID }] })
  })

  test("deletes a record of a type the tools do not write", async () => {
    const { tool, requests } = setupWith([HTTPS_RECORD, SRV_RECORD, CAA_RECORD, MX_RECORD])

    const result = await invoke(
      tool,
      { zone: ZONE_ID, ids: [HTTPS_RECORD.id, SRV_RECORD.id, CAA_RECORD.id, MX_RECORD.id] },
      CTX,
    )

    expect(batchRequests(requests)).toHaveLength(1)
    expect(result.deleted.map((record) => record.type)).toEqual(["HTTPS", "SRV", "CAA", "MX"])
  })

  test("a type change deletes the old record and adds the new one with the same name in one batch", async () => {
    const { tool, requests } = setupWith([A_RECORD], { deletes: [A_RECORD], posts: [NEW_CNAME] })

    const result = await invoke(
      tool,
      { zone: ZONE_ID, ids: [A_RECORD_ID], add: [{ type: "CNAME", name: "www", content: "target.example.net" }] },
      CTX,
    )

    expect(batchRequests(requests)).toHaveLength(1)
    expect(batchRequests(requests)[0]!.body).toEqual({
      deletes: [{ id: A_RECORD_ID }],
      posts: [{ type: "CNAME", name: "www.example.com", content: "target.example.net", ttl: 1, proxied: false }],
    })
    expect(result.deleted).toEqual([SHAPED_A_RECORD])
    expect(result.added).toEqual([shapeRecord(NEW_CNAME)])
  })

  test("a swap deletes two records and adds two in the same batch", async () => {
    const { tool, requests } = setupWith([A_RECORD, CNAME_RECORD], { posts: [] })

    await invoke(
      tool,
      {
        zone: ZONE_ID,
        ids: [A_RECORD_ID, CNAME_RECORD.id],
        add: [
          { type: "A", name: "blog", content: "192.0.2.1", ttl: 300 },
          { type: "CNAME", name: "www", content: "hosting.example.net" },
        ],
      },
      CTX,
    )

    expect(batchRequests(requests)).toHaveLength(1)
    expect(batchRequests(requests)[0]!.body).toMatchObject({
      deletes: [{ id: A_RECORD_ID }, { id: CNAME_RECORD.id }],
      posts: [
        { type: "A", name: "blog.example.com", content: "192.0.2.1", ttl: 300 },
        { type: "CNAME", name: "www.example.com", content: "hosting.example.net" },
      ],
    })
  })
})

describe("cloudflareDnsRecordDelete: Cloudflare failures", () => {
  test("a 400 says nothing was changed", async () => {
    const { tool } = setup(recordRoute(A_RECORD), batchRoute(fail(400, [{ code: 1004, message: "Bad batch." }])))

    const error = await toolError(invoke(tool, { zone: ZONE_ID, ids: [A_RECORD_ID] }, CTX))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("Bad batch.")
    expect(error.message).toEndWith(" Nothing was changed.")
  })

  test("a 500 says the batch may or may not have been applied", async () => {
    const { tool } = setup(recordRoute(A_RECORD), batchRoute(fail(500, [{ code: 1000, message: "Internal error" }])))

    const error = await toolError(invoke(tool, { zone: ZONE_ID, ids: [A_RECORD_ID] }, CTX))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toContain("may or may not have applied the whole batch")
    expect(error.message).toContain("cloudflare_dns_read")
  })
})
