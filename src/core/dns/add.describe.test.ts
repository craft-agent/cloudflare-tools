import { describe, expect, test } from "bun:test"
import { toolError, ZONE_ID } from "../cloudflare/client.fixtures"
import { callDescription } from "../describe"
import { OTHER_ACCOUNT_ID, SAMPLE_ZONE } from "../zone/fixtures"
import { ok } from "../cloudflare/testing"
import { CTX, setup, ZONE_PATH } from "./add.fixtures"
import { batchRequests, batchRoute } from "./fixtures"

type Records = Parameters<ReturnType<typeof setup>["tool"]["execute"]>[0]["records"]

const WWW = { type: "A" as const, name: "WWW", content: "192.0.2.1", proxied: true, comment: "web front" }
const MX = { type: "MX" as const, name: "@", content: "Mail.Example.com.", priority: 10, ttl: 3600 }
const CAA = { type: "CAA" as const, name: "example.com.", data: { flags: 0, tag: "issue", value: "letsencrypt.org" } }
const SRV = {
  type: "SRV" as const,
  name: "_sip._tcp",
  data: { priority: 10, weight: 5, port: 5060, target: "Sip.Example.org" },
}
const TXT = { type: "TXT" as const, name: "_dmarc", content: "v=DMARC1; p=none" }

/** The description the add tool gives for `records`, and the requests it sent to Cloudflare to tell it. */
async function describing(records: Records) {
  const { tool, requests } = setup()
  const description = await tool.describe!(tool.input.parse({ zone: ZONE_ID, records }), CTX)
  return { description, requests, tool }
}

describe("cloudflareDnsRecordAdd: describe", () => {
  test("states its intent", () => {
    expect(setup().tool.intent).toBe("About to add DNS records")
  })

  test("names the one record it adds by the full name it will send, with no facts", async () => {
    const { description } = await describing([WWW])

    expect(description).toEqual({
      headline: { text: "About to add the DNS record {name}", values: { name: "www.example.com" } },
      facts: [],
      text: { label: "Records", body: "www A 192.0.2.1  TTL auto  proxied  # web front" },
    })
  })

  test("names the zone and counts the records when it adds several, one line each in argument order", async () => {
    const { description } = await describing([WWW, MX, CAA, SRV, TXT])

    expect(description).toEqual({
      headline: { text: "About to add DNS records to {zone}", values: { zone: "example.com" } },
      facts: [{ label: "Records", value: { text: "{count} records", values: { count: 5 } } }],
      text: {
        label: "Records",
        body: [
          "www A 192.0.2.1  TTL auto  proxied  # web front",
          "@ MX 10 mail.example.com  TTL 3600",
          "@ CAA 0 issue letsencrypt.org  TTL auto",
          "_sip._tcp SRV 10 5 5060 sip.example.org  TTL auto",
          "_dmarc TXT v=DMARC1; p=none  TTL auto",
        ].join("\n"),
      },
    })
  })

  test("counts two records as records", async () => {
    const { description } = await describing([WWW, TXT])

    expect(description.facts).toEqual([{ label: "Records", value: { text: "{count} records", values: { count: 2 } } }])
  })

  test("reads only the zone and sends no batch", async () => {
    const { requests } = await describing([WWW, MX])

    expect(requests.map((request) => request.path)).toEqual([ZONE_PATH])
  })

  test("gives the same description twice for the same state", async () => {
    const first = await describing([WWW, SRV])
    const second = await describing([WWW, SRV])

    expect(second.description).toEqual(first.description)
  })

  test("is accepted by the description check, for one record and for several", async () => {
    const { tool } = setup()

    for (const records of [[WWW], [WWW, MX, CAA, SRV]]) {
      const answer = await callDescription(tool, { zone: ZONE_ID, records }, CTX)

      expect(answer).toBeDefined()
      expect(answer!.headline).toBeDefined()
      expect(answer!.text!.body.split("\n")).toHaveLength(records.length)
    }
  })
})

describe("cloudflareDnsRecordAdd: describe refuses where execute would", () => {
  test("a record that breaks a rule throws with the message execute gives", async () => {
    const { tool } = setup(batchRoute(ok({ posts: [] })))
    const args = tool.input.parse({
      zone: ZONE_ID,
      records: [WWW, { type: "A", name: "api", content: "not an address" }],
    })

    const error = await toolError(Promise.resolve().then(() => tool.describe!(args, CTX)))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toStartWith("records[1] (A api): ")
    expect(await callDescription(tool, args, CTX)).toBeUndefined()
  })

  test("a record that repeats an earlier one throws", async () => {
    const { tool } = setup()
    const args = tool.input.parse({
      zone: ZONE_ID,
      records: [TXT, { ...TXT, name: "_DMARC.example.com" }],
    })

    const error = await toolError(Promise.resolve().then(() => tool.describe!(args, CTX)))

    expect(error.message).toStartWith("records[1] repeats records[0] (TXT _dmarc)")
  })

  test("a zone of another account throws not_found and sends no batch", async () => {
    const { tool, requests } = setup({
      method: "GET",
      path: ZONE_PATH,
      reply: ok({ ...SAMPLE_ZONE, account: { id: OTHER_ACCOUNT_ID } }),
    })

    const error = await toolError(
      Promise.resolve().then(() => tool.describe!(tool.input.parse({ zone: ZONE_ID, records: [WWW] }), CTX)),
    )

    expect(error.code).toBe("not_found")
    expect(batchRequests(requests)).toEqual([])
  })
})
