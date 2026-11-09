import { describe, expect, test } from "bun:test"
import { currentForm } from "./current"
import { changeBlock, recordCountFact, recordLine, recordValue, type RecordLike } from "./describe"
import { A_RECORD, CAA_RECORD, CNAME_RECORD, MX_RECORD, PLAIN_A_RECORD, SRV_RECORD, TXT_RECORD } from "./fixtures"
import { shapeRecord } from "./records"
import { recordBody, type NewRecord } from "./values"

const ZONE = "example.com"

/** The line of a create body, as the tools build it from `recordBody`. */
function bodyLine(body: Record<string, unknown>): string {
  return recordLine(body as RecordLike, ZONE)
}

/** The block an edit of `record` into `fields` shows. */
function blockFor(raw: Record<string, unknown>, fields: Record<string, unknown>): string {
  const record = shapeRecord(raw)
  return changeBlock(record, currentForm(record, record.type as NewRecord["type"]), fields, ZONE)
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

describe("changeBlock", () => {
  test("heads the block with the record's name and type, then one indented line per changed field", () => {
    expect(blockFor(A_RECORD, { content: "192.0.2.2", ttl: 300, proxied: false })).toBe(
      "www A\n  content: 192.0.2.1 → 192.0.2.2\n  ttl: auto → 300\n  proxied: yes → no",
    )
  })

  test("lists the fields in the order of a patch whatever the order they were given in", () => {
    expect(blockFor(PLAIN_A_RECORD, { comment: "x", ttl: 1, content: "192.0.2.8" })).toBe(
      "api A\n  content: 192.0.2.7 → 192.0.2.8\n  ttl: 300 → auto\n  comment: (none) → x",
    )
  })

  test("shows a removed comment as (none) and a new one as written", () => {
    expect(blockFor(A_RECORD, { comment: "" })).toBe("www A\n  comment: web front → (none)")
    expect(blockFor(CNAME_RECORD, { comment: "docs" })).toBe("blog CNAME\n  comment: (none) → docs")
  })

  test("shows a rename relative to the zone, the apex as @", () => {
    expect(blockFor(A_RECORD, { name: "news.example.com" })).toBe("www A\n  name: www → news")
    expect(blockFor(A_RECORD, { name: "example.com" })).toBe("www A\n  name: www → @")
  })

  test("shows the data values of a CAA or SRV record in the order of its keys", () => {
    const caa = { flags: 0, tag: "issuewild", value: "pki.example.org" }
    const srv = { port: 5061, target: "sip2.example.org", priority: 10, weight: 5 }

    expect(blockFor(CAA_RECORD, { data: caa })).toBe(
      "@ CAA\n  data: 0 issue letsencrypt.org → 0 issuewild pki.example.org",
    )
    expect(blockFor(SRV_RECORD, { data: srv })).toBe(
      "_sip._tcp SRV\n  data: 10 5 5060 sip.example.org → 10 5 5061 sip2.example.org",
    )
  })

  test("shows a changed MX preference", () => {
    expect(blockFor(MX_RECORD, { priority: 20 })).toBe("@ MX\n  priority: 10 → 20")
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
