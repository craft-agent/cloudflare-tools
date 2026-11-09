import { describe, expect, test } from "bun:test"
import { recordCountFact, recordLine, recordValue, type RecordLike } from "./describe"
import { A_RECORD, CAA_RECORD, CNAME_RECORD, MX_RECORD, PLAIN_A_RECORD, SRV_RECORD, TXT_RECORD } from "./fixtures"
import { shapeRecord } from "./records"
import { recordBody } from "./values"

const ZONE = "example.com"

/** The line of a create body, as the tools build it from `recordBody`. */
function bodyLine(body: Record<string, unknown>): string {
  return recordLine(body as RecordLike, ZONE)
}

describe("recordLine", () => {
  test("writes a record in the order of a zone file: name, type, value, TTL, proxied, comment", () => {
    expect(recordLine(shapeRecord(A_RECORD), ZONE)).toBe("www A 192.0.2.1  TTL auto  proxied  # web front")
  })

  test("shows the apex as @, an MX preference before its host and a TTL in seconds", () => {
    expect(recordLine(shapeRecord(MX_RECORD), ZONE)).toBe("@ MX 10 mail.example.com  TTL 3600")
  })

  test("shows a TXT value as Cloudflare reports it and leaves out an absent comment and a missing proxy", () => {
    expect(recordLine(shapeRecord(TXT_RECORD), ZONE)).toBe('_dmarc TXT "v=DMARC1; p=none"  TTL auto')
    expect(recordLine(shapeRecord(PLAIN_A_RECORD), ZONE)).toBe("api A 192.0.2.7  TTL 300")
  })

  test("shows a record that is not proxied and has an empty comment without either", () => {
    const record = { type: "A", name: "www.example.com", content: "192.0.2.1", ttl: 1, proxied: false, comment: "" }

    expect(recordLine(record, ZONE)).toBe("www A 192.0.2.1  TTL auto")
  })

  test("leaves the TTL out when the record has none", () => {
    expect(recordLine({ type: "A", name: "www.example.com", content: "192.0.2.1" }, ZONE)).toBe("www A 192.0.2.1")
  })

  test("keeps a name outside the zone as it is", () => {
    expect(recordLine({ type: "CNAME", name: "www.example.org", content: "a.example.net" }, ZONE)).toBe(
      "www.example.org CNAME a.example.net",
    )
  })

  test("shows the content of a CAA record as Cloudflare reports it", () => {
    expect(recordLine(shapeRecord(CAA_RECORD), ZONE)).toBe('@ CAA 0 issue "letsencrypt.org"  TTL 300')
  })

  test("shows the data values of a record body that has no content", () => {
    const caa = recordBody(
      { type: "CAA", name: "@", data: { flags: 0, tag: "issue", value: "pki.example.org" } },
      ZONE,
      "x",
    )
    const srv = recordBody(
      { type: "SRV", name: "_sip._tcp", data: { priority: 10, weight: 5, port: 5060, target: "Sip.Example.org" } },
      ZONE,
      "x",
    )

    expect(bodyLine(caa)).toBe("@ CAA 0 issue pki.example.org  TTL auto")
    expect(bodyLine(srv)).toBe("_sip._tcp SRV 10 5 5060 sip.example.org  TTL auto")
  })

  test("shows a record body as it will be sent: full name made relative, MX priority, proxied, comment", () => {
    const body = recordBody(
      { type: "MX", name: "MAIL", content: "Mx.Example.net.", priority: 5, comment: "backup" },
      ZONE,
      "x",
    )
    const proxied = recordBody({ type: "CNAME", name: "app", content: "a.example.net", proxied: true }, ZONE, "x")

    expect(bodyLine(body)).toBe("mail MX 5 mx.example.net  TTL auto  # backup")
    expect(bodyLine(proxied)).toBe("app CNAME a.example.net  TTL auto  proxied")
  })
})

describe("recordValue", () => {
  test("is empty for a record with neither content nor data", () => {
    expect(recordValue({ type: "A", name: "www.example.com" })).toBe("")
  })
})

describe("recordCountFact", () => {
  test("picks the singular template for one record and the plural for any other count", () => {
    expect(recordCountFact("Records", 1)).toEqual({
      label: "Records",
      value: { text: "{count} record", values: { count: 1 } },
    })
    expect(recordCountFact("Additions", 3)).toEqual({
      label: "Additions",
      value: { text: "{count} records", values: { count: 3 } },
    })
  })
})
