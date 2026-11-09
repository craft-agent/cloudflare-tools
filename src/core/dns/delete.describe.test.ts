import { describe, expect, test } from "bun:test"
import { toolError, ZONE_ID } from "../cloudflare/client.fixtures"
import { callDescription } from "../describe"
import { confirming, CTX, setupWith } from "./delete.fixtures"
import {
  A_RECORD,
  A_RECORD_ID,
  batchRequests,
  CAA_RECORD,
  MX_RECORD,
  PRODUCT_RECORD,
  SRV_RECORD,
  TXT_RECORD,
  WORKER_RECORD,
} from "./fixtures"

type Args = { ids: string[]; add?: Parameters<ReturnType<typeof setupWith>["tool"]["execute"]>[0]["add"] }

const CNAME = { type: "CNAME" as const, name: "www", content: "target.example.net" }
const NEW_MX = { type: "MX" as const, name: "@", content: "Mx.Example.net.", priority: 5, ttl: 3600, comment: "backup" }
const NEW_CAA = { type: "CAA" as const, name: "@", data: { flags: 0, tag: "issuewild", value: "pki.example.org" } }

/** The description the delete tool gives for `args` against `records`, with what it asked and sent. */
async function describing(records: { id: string }[], args: Args) {
  const { tool, requests } = setupWith(records)
  const { asked, ctx } = confirming(true)
  const description = await tool.describe!(tool.input.parse({ zone: ZONE_ID, ...args }), ctx)
  return { description, requests, asked }
}

/** What describing `args` against `records` throws, with nothing sent or asked. */
async function refusal(records: { id: string }[], args: Args) {
  const { tool, requests } = setupWith(records)
  const { asked, ctx } = confirming(true)
  const error = await toolError(Promise.resolve(tool.describe!(tool.input.parse({ zone: ZONE_ID, ...args }), ctx)))
  expect(batchRequests(requests)).toEqual([])
  expect(asked).toEqual([])
  return error
}

describe("cloudflareDnsRecordDelete: describe", () => {
  test("states its intent", () => {
    expect(setupWith([]).tool.intent).toBe("About to delete DNS records")
  })

  test("names the one record it deletes by the name Cloudflare reports, with no facts", async () => {
    const { description } = await describing([A_RECORD], { ids: [A_RECORD_ID] })

    expect(description).toEqual({
      headline: { text: "About to delete the DNS record {name}", values: { name: "www.example.com" } },
      facts: [],
      text: { label: "Records", body: "- www A 192.0.2.1  TTL auto  proxied  # web front" },
    })
  })

  test("names the zone and counts the records when it deletes several, one marked line each in argument order", async () => {
    const { description } = await describing([MX_RECORD, A_RECORD, TXT_RECORD, CAA_RECORD, SRV_RECORD], {
      ids: [MX_RECORD.id, A_RECORD_ID, TXT_RECORD.id, CAA_RECORD.id, SRV_RECORD.id],
    })

    expect(description).toEqual({
      headline: { text: "About to delete DNS records in {zone}", values: { zone: "example.com" } },
      facts: [{ label: "Records", value: { text: "{count} records", values: { count: 5 } } }],
      text: {
        label: "Records",
        body: [
          "- @ MX 10 mail.example.com  TTL 3600",
          "- www A 192.0.2.1  TTL auto  proxied  # web front",
          '- _dmarc TXT "v=DMARC1; p=none"  TTL auto',
          '- @ CAA 0 issue "letsencrypt.org"  TTL 300',
          "- _sip._tcp SRV 10 5 5060 sip.example.org  TTL 300",
        ].join("\n"),
      },
    })
  })

  test("counts two records as records", async () => {
    const { description } = await describing([A_RECORD, TXT_RECORD], { ids: [A_RECORD_ID, TXT_RECORD.id] })

    expect(description.facts).toEqual([{ label: "Records", value: { text: "{count} records", values: { count: 2 } } }])
  })

  test("with a replacement it is a replacement: both counts as facts, `- ` lines then `+ ` lines", async () => {
    const { description } = await describing([A_RECORD], { ids: [A_RECORD_ID], add: [CNAME] })

    expect(description).toEqual({
      headline: { text: "About to replace DNS records in {zone}", values: { zone: "example.com" } },
      facts: [
        { label: "Deletions", value: { text: "{count} record", values: { count: 1 } } },
        { label: "Additions", value: { text: "{count} record", values: { count: 1 } } },
      ],
      text: {
        label: "Records",
        body: "- www A 192.0.2.1  TTL auto  proxied  # web front\n+ www CNAME target.example.net  TTL auto",
      },
    })
  })

  test("with replacements it shows the records as they will be sent and counts each side", async () => {
    const { description } = await describing([A_RECORD, MX_RECORD], {
      ids: [A_RECORD_ID, MX_RECORD.id],
      add: [NEW_MX, NEW_CAA, CNAME],
    })

    expect(description.headline!.text).toBe("About to replace DNS records in {zone}")
    expect(description.facts).toEqual([
      { label: "Deletions", value: { text: "{count} records", values: { count: 2 } } },
      { label: "Additions", value: { text: "{count} records", values: { count: 3 } } },
    ])
    expect(description.text!.body).toBe(
      [
        "- www A 192.0.2.1  TTL auto  proxied  # web front",
        "- @ MX 10 mail.example.com  TTL 3600",
        "+ @ MX 5 mx.example.net  TTL 3600  # backup",
        "+ @ CAA 0 issuewild pki.example.org  TTL auto",
        "+ www CNAME target.example.net  TTL auto",
      ].join("\n"),
    )
  })

  test("an empty add is no replacement", async () => {
    const { description } = await describing([A_RECORD], { ids: [A_RECORD_ID], add: [] })

    expect(description.headline!.text).toBe("About to delete the DNS record {name}")
    expect(description.facts).toEqual([])
  })

  test("never asks for the confirmation, sends no batch and shows no pins", async () => {
    const { description, requests, asked } = await describing([A_RECORD], { ids: [A_RECORD_ID], add: [CNAME] })

    expect(asked).toEqual([])
    expect(batchRequests(requests)).toEqual([])
    expect(description.pins).toBeUndefined()
  })

  test("gives the same description twice for the same state", async () => {
    const args = { ids: [A_RECORD_ID, MX_RECORD.id], add: [CNAME] }
    const first = await describing([A_RECORD, MX_RECORD], args)
    const second = await describing([A_RECORD, MX_RECORD], args)

    expect(second.description).toEqual(first.description)
  })

  test("is accepted by the description check, with and without a replacement", async () => {
    const { tool } = setupWith([A_RECORD, MX_RECORD])

    for (const args of [{ ids: [A_RECORD_ID] }, { ids: [A_RECORD_ID, MX_RECORD.id], add: [CNAME] }]) {
      const answer = await callDescription(tool, { zone: ZONE_ID, ...args }, CTX)

      expect(answer).toBeDefined()
      expect(answer!.headline).toBeDefined()
      expect(answer!.text!.body.split("\n")).toHaveLength(args.ids.length + (args.add?.length ?? 0))
    }
  })
})

describe("cloudflareDnsRecordDelete: describe refuses where execute would", () => {
  test("a record another Cloudflare product manages throws", async () => {
    const error = await refusal([A_RECORD, PRODUCT_RECORD], { ids: [A_RECORD_ID, PRODUCT_RECORD.id] })

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toBe("ids[1] (A x): is managed by another Cloudflare product and is changed there.")
  })

  test("a Worker's custom domain throws, naming it", async () => {
    const error = await refusal([WORKER_RECORD], { ids: [WORKER_RECORD.id] })

    expect(error.message).toContain("(a Worker's custom domain)")
  })

  test("the same id twice throws before any read", async () => {
    const { tool, requests } = setupWith([A_RECORD])
    const ids = [A_RECORD_ID, A_RECORD_ID.toUpperCase()]

    const error = await toolError(Promise.resolve(tool.describe!(tool.input.parse({ zone: ZONE_ID, ids }), CTX)))

    expect(error.message).toStartWith("ids[1] repeats ids[0]")
    expect(requests).toEqual([])
  })

  test("a record to add that breaks a rule throws, naming its position", async () => {
    const error = await refusal([A_RECORD], {
      ids: [A_RECORD_ID],
      add: [CNAME, { type: "A", name: "api", content: "not an address" }],
    })

    expect(error.message).toStartWith("add[1] (A api): ")
  })

  test("a record to add that repeats an earlier one throws", async () => {
    const error = await refusal([A_RECORD], { ids: [A_RECORD_ID], add: [CNAME, { ...CNAME, name: "WWW.example.com" }] })

    expect(error.message).toStartWith("add[1] repeats add[0] (CNAME www)")
  })

  test("a record that does not exist throws not_found", async () => {
    const error = await refusal([], { ids: [A_RECORD_ID] })

    expect(error.code).toBe("not_found")
  })

  test("the description check gives nothing for a call execute would refuse", async () => {
    const { tool } = setupWith([PRODUCT_RECORD])

    expect(await callDescription(tool, { zone: ZONE_ID, ids: [PRODUCT_RECORD.id] }, CTX)).toBeUndefined()
  })
})
