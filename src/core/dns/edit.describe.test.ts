import { describe, expect, test } from "bun:test"
import { toolError, ZONE_ID } from "../cloudflare/client.fixtures"
import { callDescription } from "../describe"
import { CTX, pathsOf, setupWith, ZONE_PATH } from "./edit.fixtures"
import {
  A_RECORD,
  A_RECORD_ID,
  batchRequests,
  CAA_RECORD,
  CNAME_RECORD,
  HTTPS_RECORD,
  MX_RECORD,
  PLAIN_A_RECORD,
  PRODUCT_RECORD,
  recordPath,
  SRV_RECORD,
} from "./fixtures"

type Changes = Parameters<ReturnType<typeof setupWith>["tool"]["execute"]>[0]["changes"]

/** The description the edit tool gives for `changes` against `records`, and the requests it sent to Cloudflare to tell it. */
async function describing(records: { id: string }[], changes: Changes) {
  const { tool, requests } = setupWith(records)
  const description = await tool.describe!(tool.input.parse({ zone: ZONE_ID, changes }), CTX)
  return { description, requests }
}

/** What describing `changes` against `records` throws. */
async function refusal(records: { id: string }[], changes: Changes) {
  const { tool, requests } = setupWith(records)
  const error = await toolError(Promise.resolve(tool.describe!(tool.input.parse({ zone: ZONE_ID, changes }), CTX)))
  expect(batchRequests(requests)).toEqual([])
  return error
}

describe("cloudflareDnsRecordEdit: describe", () => {
  test("states its intent", () => {
    expect(setupWith([]).tool.intent).toBe("About to change DNS records")
  })

  test("names the one record by the name Cloudflare reports and shows each changed field, with no facts", async () => {
    const { description } = await describing(
      [PLAIN_A_RECORD],
      [{ id: PLAIN_A_RECORD.id, content: "192.0.2.9", ttl: 600 }],
    )

    expect(description).toEqual({
      headline: { text: "About to change the DNS record {name}", values: { name: "api.example.com" } },
      facts: [],
      text: { label: "Changes", body: "api A\n  content: 192.0.2.7 → 192.0.2.9\n  ttl: 300 → 600" },
    })
  })

  test("names the zone and counts the records when it changes several, one block each in argument order", async () => {
    const { description } = await describing(
      [PLAIN_A_RECORD, A_RECORD, CNAME_RECORD],
      [
        { id: PLAIN_A_RECORD.id, content: "192.0.2.9" },
        { id: A_RECORD_ID, comment: "" },
        { id: CNAME_RECORD.id, type: "CNAME", name: "News" },
      ],
    )

    expect(description).toEqual({
      headline: { text: "About to change DNS records in {zone}", values: { zone: "example.com" } },
      facts: [{ label: "Records", value: { text: "{count} records", values: { count: 3 } } }],
      text: {
        label: "Changes",
        body: [
          "api A\n  content: 192.0.2.7 → 192.0.2.9",
          "www A\n  comment: web front → (none)",
          "blog CNAME\n  name: blog → news",
        ].join("\n"),
      },
    })
  })

  test("counts two records as records", async () => {
    const { description } = await describing(
      [PLAIN_A_RECORD, CNAME_RECORD],
      [
        { id: PLAIN_A_RECORD.id, ttl: 1 },
        { id: CNAME_RECORD.id, proxied: true },
      ],
    )

    expect(description.facts).toEqual([{ label: "Records", value: { text: "{count} records", values: { count: 2 } } }])
  })

  test("a rename keeps the current name in the headline and shows the new one relative to the zone", async () => {
    const { description } = await describing([A_RECORD], [{ id: A_RECORD_ID, name: "Web.Example.com" }])

    expect(description.headline).toEqual({
      text: "About to change the DNS record {name}",
      values: { name: "www.example.com" },
    })
    expect(description.text!.body).toBe("www A\n  name: www → web")
  })

  test("shows a proxied switch as yes and no and a ttl change to automatic", async () => {
    const { description } = await describing(
      [A_RECORD, PLAIN_A_RECORD],
      [
        { id: A_RECORD_ID, proxied: false },
        { id: PLAIN_A_RECORD.id, ttl: 1, proxied: true },
      ],
    )

    expect(description.text!.body).toBe("www A\n  proxied: yes → no\napi A\n  ttl: 300 → auto\n  proxied: no → yes")
  })

  test("shows a comment added, a MX preference and the data of CAA and SRV records", async () => {
    const { description } = await describing(
      [CNAME_RECORD, MX_RECORD, CAA_RECORD, SRV_RECORD],
      [
        { id: CNAME_RECORD.id, comment: "docs" },
        { id: MX_RECORD.id, priority: 20, content: "mx2.example.com" },
        { id: CAA_RECORD.id, data: { flags: 0, tag: "issuewild", value: "pki.example.org" } },
        { id: SRV_RECORD.id, data: { priority: 10, weight: 5, port: 5061, target: "Sip.Example.org" } },
      ],
    )

    expect(description.text!.body).toBe(
      [
        "blog CNAME\n  comment: (none) → docs",
        "@ MX\n  content: mail.example.com → mx2.example.com\n  priority: 10 → 20",
        "@ CAA\n  data: 0 issue letsencrypt.org → 0 issuewild pki.example.org",
        "_sip._tcp SRV\n  data: 10 5 5060 sip.example.org → 10 5 5061 sip.example.org",
      ].join("\n"),
    )
  })

  test("reads the records and the zone, sends no batch and shows no pins", async () => {
    const { description, requests } = await describing([A_RECORD], [{ id: A_RECORD_ID, comment: "x" }])

    expect(new Set(pathsOf(requests))).toEqual(new Set([ZONE_PATH, recordPath(A_RECORD_ID)]))
    expect(batchRequests(requests)).toEqual([])
    expect(description.pins).toBeUndefined()
  })

  test("gives the same description twice for the same state", async () => {
    const changes: Changes = [{ id: A_RECORD_ID, comment: "x" }]
    const first = await describing([A_RECORD], changes)
    const second = await describing([A_RECORD], changes)

    expect(second.description).toEqual(first.description)
  })

  test("is accepted by the description check, for one record and for several", async () => {
    const { tool } = setupWith([A_RECORD, PLAIN_A_RECORD])
    const one = [{ id: A_RECORD_ID, comment: "x" }]

    for (const changes of [one, [...one, { id: PLAIN_A_RECORD.id, ttl: 1 }]]) {
      const answer = await callDescription(tool, { zone: ZONE_ID, changes }, CTX)

      expect(answer).toBeDefined()
      expect(answer!.text!.body).toContain("comment:")
    }
  })
})

describe("cloudflareDnsRecordEdit: describe refuses where execute would", () => {
  test("a change that changes nothing throws", async () => {
    const error = await refusal([A_RECORD], [{ id: A_RECORD_ID, content: "192.0.2.1" }])

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toStartWith("changes[0] (A www): changes nothing")
  })

  test("an entry with no field to change throws", async () => {
    const error = await refusal([A_RECORD], [{ id: A_RECORD_ID }])

    expect(error.message).toStartWith("changes[0]: changes nothing")
  })

  test("a record another Cloudflare product manages throws", async () => {
    const error = await refusal([PRODUCT_RECORD], [{ id: PRODUCT_RECORD.id, ttl: 600 }])

    expect(error.message).toBe("changes[0] (A x): is managed by another Cloudflare product and is changed there.")
  })

  test("a type the tools do not write, and a type that differs, throw", async () => {
    const unwritable = await refusal([HTTPS_RECORD], [{ id: HTTPS_RECORD.id, ttl: 600 }])
    const differing = await refusal([A_RECORD], [{ id: A_RECORD_ID, type: "CNAME", content: "a.example.org" }])

    expect(unwritable.message).toContain("can be read and deleted")
    expect(differing.message).toContain("a record's type cannot change in place")
  })

  test("a value that breaks a rule throws", async () => {
    const error = await refusal([A_RECORD], [{ id: A_RECORD_ID, content: "not an address" }])

    expect(error.message).toStartWith("changes[0] (A www): ")
  })

  test("the same record twice throws before any read", async () => {
    const { tool, requests } = setupWith([A_RECORD])
    const changes = [
      { id: A_RECORD_ID, ttl: 600 },
      { id: A_RECORD_ID.toUpperCase(), ttl: 300 },
    ]

    const error = await toolError(Promise.resolve(tool.describe!(tool.input.parse({ zone: ZONE_ID, changes }), CTX)))

    expect(error.message).toStartWith("changes[1] repeats changes[0]")
    expect(requests).toEqual([])
  })

  test("a record that does not exist throws not_found", async () => {
    const error = await refusal([], [{ id: A_RECORD_ID, ttl: 600 }])

    expect(error.code).toBe("not_found")
  })

  test("the description check gives nothing for a call execute would refuse", async () => {
    const { tool } = setupWith([A_RECORD])

    expect(
      await callDescription(tool, { zone: ZONE_ID, changes: [{ id: A_RECORD_ID, content: "192.0.2.1" }] }, CTX),
    ).toBeUndefined()
  })
})
