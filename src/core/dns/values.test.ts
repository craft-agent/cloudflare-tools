import { describe, expect, test } from "bun:test"
import { newRecordSchema, WRITABLE_TYPES } from "./values"
import { bodyOf, refusalOf, WHERE } from "./values.fixtures"

describe("newRecordSchema", () => {
  test("lists the eight writable types", () => {
    expect(WRITABLE_TYPES).toEqual(["A", "AAAA", "CNAME", "MX", "TXT", "NS", "CAA", "SRV"])
  })

  test("refuses unknown fields, also inside data", () => {
    expect(newRecordSchema.safeParse({ type: "A", name: "www", content: "192.0.2.1", extra: 1 }).success).toBe(false)
    expect(
      newRecordSchema.safeParse({ type: "CAA", name: "@", data: { flags: 0, tag: "issue", value: "x", extra: 1 } })
        .success,
    ).toBe(false)
  })

  test("refuses a type that is not writable and a fractional number", () => {
    expect(newRecordSchema.safeParse({ type: "HTTPS", name: "@", content: "x" }).success).toBe(false)
    expect(newRecordSchema.safeParse({ type: "A", name: "@", content: "192.0.2.1", ttl: 60.5 }).success).toBe(false)
  })

  test("describes every field", () => {
    for (const field of Object.values(newRecordSchema.shape)) expect(field.description).toBeTruthy()
  })
})

describe("recordBody: names", () => {
  test("turns a relative name, the apex and a full name into the full lowercase name", () => {
    expect(bodyOf({ type: "A", name: "WWW", content: "192.0.2.1" }).name).toBe("www.example.com")
    expect(bodyOf({ type: "A", name: "@", content: "192.0.2.1" }).name).toBe("example.com")
    expect(bodyOf({ type: "A", name: "api.Example.com.", content: "192.0.2.1" }).name).toBe("api.example.com")
    expect(bodyOf({ type: "A", name: "*.sub", content: "192.0.2.1" }).name).toBe("*.sub.example.com")
  })

  test("refuses a bad name with the position and type in front", () => {
    const message = refusalOf({ type: "A", name: "www.other.org.", content: "192.0.2.1" })

    expect(message).toStartWith(`${WHERE} (A): `)
    expect(message).toContain("is not in the zone example.com")
  })

  test("names the record by its relative name in every other refusal", () => {
    expect(refusalOf({ type: "A", name: "api.example.com", content: "nope" })).toStartWith(`${WHERE} (A api): `)
    expect(refusalOf({ type: "A", name: "@", content: "nope" })).toStartWith(`${WHERE} (A @): `)
  })
})

describe("recordBody: which field holds the value", () => {
  test.each(["A", "AAAA", "CNAME", "MX", "TXT", "NS"] as const)("%s takes content, not data", (type) => {
    expect(refusalOf({ type, name: "x", priority: 1, data: { flags: 0 } })).toContain("takes `content`, not `data`")
    expect(refusalOf({ type, name: "x", priority: 1 })).toContain("requires `content`")
  })

  test.each(["CAA", "SRV"] as const)("%s takes data, not content", (type) => {
    expect(refusalOf({ type, name: "_a._b", content: "x" })).toContain("takes `data`, not `content`")
    expect(refusalOf({ type, name: "_a._b" })).toContain("requires `data`")
  })
})

describe("recordBody: A and AAAA", () => {
  test("accept an address of their own family", () => {
    expect(bodyOf({ type: "A", name: "www", content: "192.0.2.1" })).toEqual({
      type: "A",
      name: "www.example.com",
      content: "192.0.2.1",
      ttl: 1,
      proxied: false,
    })
    expect(bodyOf({ type: "AAAA", name: "www", content: "2001:db8::1" }).content).toBe("2001:db8::1")
  })

  test("refuse the other family, a hostname and a scoped address", () => {
    expect(refusalOf({ type: "A", name: "www", content: "2001:db8::1" })).toContain("not an IPv4 address")
    expect(refusalOf({ type: "A", name: "www", content: "999.0.0.1" })).toContain("not an IPv4 address")
    expect(refusalOf({ type: "A", name: "www", content: "example.org" })).toContain("not an IPv4 address")
    expect(refusalOf({ type: "AAAA", name: "www", content: "192.0.2.1" })).toContain("not an IPv6 address")
    expect(refusalOf({ type: "AAAA", name: "www", content: "fe80::1%eth0" })).toContain("not an IPv6 address")
  })
})

describe("recordBody: hostnames", () => {
  test.each(["CNAME", "NS"] as const)("%s content is trimmed, lowercased and loses one trailing dot", (type) => {
    expect(bodyOf({ type, name: "www", content: "  Target.Example.ORG. " }).content).toBe("target.example.org")
  })

  test("an MX target is normalized the same way and an IDN becomes punycode", () => {
    expect(bodyOf({ type: "MX", name: "@", content: "mail.bücher.example.", priority: 10 }).content).toBe(
      "mail.xn--bcher-kva.example",
    )
  })

  test.each([
    ["has no dot", "localhost", "at least one dot"],
    ["is empty", " ", "it is empty"],
    ["has an empty label", "a..example.org", "empty label"],
    ["has a label over 63 characters", `${"a".repeat(64)}.example.org`, "longer than 63"],
    ["is over 253 characters", `${"a.".repeat(130)}org`, "longer than 253"],
    ["starts a label with a dash", "-a.example.org", "starts or ends with `-`"],
    ["ends a label with a dash", "a-.example.org", "starts or ends with `-`"],
    ["has a character outside a-z 0-9 - _", "a b.example.org", "may hold only letters"],
    ["is a wildcard", "*.example.org", "wildcard"],
    ["has two trailing dots", "a.example.org..", "empty label"],
  ])("refuses a hostname that %s", (_, content, fragment) => {
    const message = refusalOf({ type: "CNAME", name: "www", content })

    expect(message).toContain("is not a valid hostname")
    expect(message).toContain(fragment)
  })

  test("refuses a hostname that is the record's own full name", () => {
    expect(refusalOf({ type: "CNAME", name: "www", content: "WWW.example.com." })).toContain("the record's own name")
    expect(refusalOf({ type: "NS", name: "@", content: "example.com" })).toContain("the record's own name")
    expect(refusalOf({ type: "MX", name: "@", content: "example.com", priority: 1 })).toContain("the record's own name")
  })

  test("accepts underscores inside a label", () => {
    expect(bodyOf({ type: "CNAME", name: "sel._domainkey", content: "dkim_1.example.org" }).content).toBe(
      "dkim_1.example.org",
    )
  })
})

describe("recordBody: TXT", () => {
  test("keeps the text as it is", () => {
    expect(bodyOf({ type: "TXT", name: "_dmarc", content: "v=DMARC1; p=none" })).toEqual({
      type: "TXT",
      name: "_dmarc.example.com",
      content: "v=DMARC1; p=none",
      ttl: 1,
    })
  })

  test("accepts 1 to 2048 characters", () => {
    expect(bodyOf({ type: "TXT", name: "x", content: "a" }).content).toBe("a")
    expect(bodyOf({ type: "TXT", name: "x", content: "a".repeat(2048) }).content).toHaveLength(2048)
  })

  test("refuses an empty value and one over 2048 characters", () => {
    expect(refusalOf({ type: "TXT", name: "x", content: "" })).toContain("1–2048 characters")
    expect(refusalOf({ type: "TXT", name: "x", content: "a".repeat(2049) })).toContain("this one has 2049")
  })

  test.each(["a\nb", "a\rb", "a\tb", "a\x00b", "a\x7fb"])("refuses the control character in %j", (content) => {
    expect(refusalOf({ type: "TXT", name: "x", content })).toContain("one line of text")
  })
})
