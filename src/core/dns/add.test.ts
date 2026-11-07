import { describe, expect, test } from "bun:test"
import { toolError, ZONE_ID } from "../cloudflare/client.fixtures"
import { fail, ok } from "../cloudflare/testing"
import { annotations, invoke } from "../tool"
import { OTHER_ACCOUNT_ID, SAMPLE_ZONE } from "../zone/fixtures"
import { cloudflareDnsRecordAdd } from "./add"
import { CTX, setup, ZONE_PATH } from "./add.fixtures"
import { A_RECORD, batchRequests, batchRoute, CAA_RECORD, MX_RECORD, SHAPED_A_RECORD } from "./fixtures"

const SRV_RECORD = {
  id: "e".repeat(32),
  type: "SRV",
  name: "_sip._tcp.example.com",
  content: "10 5 5060 sip.example.org",
  data: { priority: 10, weight: 5, port: 5060, target: "sip.example.org" },
  proxied: false,
  proxiable: false,
  ttl: 1,
  comment: null,
  tags: [],
  modified_on: null,
}

const RECORDS = [
  { type: "A" as const, name: "WWW", content: "192.0.2.1", proxied: true, comment: "web front" },
  { type: "MX" as const, name: "@", content: "Mail.Example.com.", priority: 10, ttl: 3600 },
  { type: "CAA" as const, name: "example.com.", data: { flags: 0, tag: "issue", value: "letsencrypt.org" } },
  {
    type: "SRV" as const,
    name: "_sip._tcp",
    data: { priority: 10, weight: 5, port: 5060, target: "Sip.Example.org" },
  },
]

const POSTS = [
  { type: "A", name: "www.example.com", content: "192.0.2.1", ttl: 1, proxied: true, comment: "web front" },
  { type: "MX", name: "example.com", content: "mail.example.com", ttl: 3600, priority: 10 },
  { type: "CAA", name: "example.com", data: { flags: 0, tag: "issue", value: "letsencrypt.org" }, ttl: 1 },
  {
    type: "SRV",
    name: "_sip._tcp.example.com",
    data: { priority: 10, weight: 5, port: 5060, target: "sip.example.org" },
    ttl: 1,
  },
]

describe("cloudflareDnsRecordAdd: metadata", () => {
  test("publishes add class annotations", () => {
    expect(annotations(cloudflareDnsRecordAdd)).toEqual({
      title: "Add Cloudflare DNS records",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    })
  })

  test("belongs to the dns toolset and names the tools for the other operations", () => {
    expect(cloudflareDnsRecordAdd.id).toBe("cloudflare_dns_record_add")
    expect(cloudflareDnsRecordAdd.toolset).toBe("dns")
    expect(cloudflareDnsRecordAdd.description).toContain("all are added or none is")
    expect(cloudflareDnsRecordAdd.description).toContain("cloudflare_dns_record_edit")
    expect(cloudflareDnsRecordAdd.description).toContain("cloudflare_dns_record_delete")
  })
})

describe("cloudflareDnsRecordAdd: adding", () => {
  test("sends one batch with the normalized bodies and returns the created records", async () => {
    const { tool, requests } = setup(batchRoute(ok({ posts: [A_RECORD, MX_RECORD, CAA_RECORD, SRV_RECORD] })))

    const result = await invoke(tool, { zone: ZONE_ID, records: RECORDS }, CTX)

    expect(requests.map((request) => request.path)).toEqual([ZONE_PATH, `${ZONE_PATH}/dns_records/batch`])
    expect(batchRequests(requests)).toHaveLength(1)
    expect(batchRequests(requests)[0]).toMatchObject({ method: "POST", body: { posts: POSTS } })
    expect(Object.keys(batchRequests(requests)[0]!.body as object)).toEqual(["posts"])
    expect(result.label).toBe("default")
    expect(result.zone).toEqual({ id: ZONE_ID, name: "example.com" })
    expect(result.added).toHaveLength(4)
    expect(result.added[0]).toEqual(SHAPED_A_RECORD)
    expect(result.added[1]).toMatchObject({ id: MX_RECORD.id, priority: 10 })
    expect(result.added[3]).toMatchObject({ type: "SRV", data: SRV_RECORD.data })
  })

  test("looks a zone up by domain", async () => {
    const { tool, requests } = setup(
      { method: "GET", path: "/zones", reply: ok([SAMPLE_ZONE]) },
      batchRoute(ok({ posts: [A_RECORD] })),
    )

    const result = await invoke(tool, { zone: "Example.com", records: [RECORDS[0]!] }, CTX)

    expect(result.added).toEqual([SHAPED_A_RECORD])
    expect(batchRequests(requests)).toHaveLength(1)
  })
})

describe("cloudflareDnsRecordAdd: refusals before anything is sent", () => {
  test("a record that breaks a rule sends nothing but the zone lookup, naming its position", async () => {
    const { tool, requests } = setup(batchRoute())

    const error = await toolError(
      invoke(
        tool,
        { zone: ZONE_ID, records: [RECORDS[0]!, { type: "A", name: "api", content: "not an address" }] },
        CTX,
      ),
    )

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toStartWith("records[1] (A api): ")
    expect(requests.map((request) => request.path)).toEqual([ZONE_PATH])
  })

  test("a record that repeats an earlier one in type, full name and value is refused", async () => {
    const { tool, requests } = setup(batchRoute())
    const records = [
      { type: "TXT" as const, name: "www", content: "hello" },
      { type: "A" as const, name: "www", content: "192.0.2.1" },
      { type: "TXT" as const, name: "WWW.example.com", content: "hello" },
    ]

    const error = await toolError(invoke(tool, { zone: ZONE_ID, records }, CTX))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toStartWith("records[2] repeats records[0] (TXT www)")
    expect(requests.map((request) => request.path)).toEqual([ZONE_PATH])
  })

  test("data is compared whatever the order of its keys, hostnames after normalizing", async () => {
    const { tool } = setup(batchRoute())
    const srv = { priority: 1, weight: 1, port: 1, target: "a.example.org" }
    const reordered = { target: "A.example.org.", port: 1, weight: 1, priority: 1 }

    const error = await toolError(
      invoke(
        tool,
        {
          zone: ZONE_ID,
          records: [
            { type: "SRV", name: "_a._b", data: srv },
            { type: "SRV", name: "_a._b", data: reordered },
          ],
        },
        CTX,
      ),
    )

    expect(error.message).toStartWith("records[1] repeats records[0]")
  })

  test("the same value at another name, or an MX with another priority, is not a repeat", async () => {
    const { tool, requests } = setup(batchRoute(ok({ posts: [] })))
    const records = [
      { type: "A" as const, name: "a", content: "192.0.2.1" },
      { type: "A" as const, name: "b", content: "192.0.2.1" },
      { type: "MX" as const, name: "@", content: "m.example.org", priority: 10 },
      { type: "MX" as const, name: "@", content: "m.example.org", priority: 20 },
    ]

    await invoke(tool, { zone: ZONE_ID, records }, CTX)

    expect(batchRequests(requests)).toHaveLength(1)
  })

  test("a zone of another account is refused before any batch", async () => {
    const { tool, requests } = setup(
      { method: "GET", path: ZONE_PATH, reply: ok({ ...SAMPLE_ZONE, account: { id: OTHER_ACCOUNT_ID } }) },
      batchRoute(),
    )

    const error = await toolError(invoke(tool, { zone: ZONE_ID, records: [RECORDS[0]!] }, CTX))

    expect(error.code).toBe("not_found")
    expect(batchRequests(requests)).toEqual([])
  })
})

describe("cloudflareDnsRecordAdd: Cloudflare failures", () => {
  test("a 400 says nothing was changed", async () => {
    const { tool } = setup(batchRoute(fail(400, [{ code: 81058, message: "An identical record already exists." }])))

    const error = await toolError(invoke(tool, { zone: ZONE_ID, records: [RECORDS[0]!] }, CTX))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("An identical record already exists.")
    expect(error.message).toEndWith(" Nothing was changed.")
  })

  test("a 500 says the batch may or may not have been applied", async () => {
    const { tool } = setup(batchRoute(fail(500, [{ code: 1000, message: "Internal error" }])))

    const error = await toolError(invoke(tool, { zone: ZONE_ID, records: [RECORDS[0]!] }, CTX))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toContain("may or may not have applied the whole batch")
    expect(error.message).toContain("cloudflare_dns_read")
  })
})
