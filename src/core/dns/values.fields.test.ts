import { describe, expect, test } from "bun:test"
import { bodyOf, refusalOf, WHERE } from "./values.fixtures"

const CAA = { flags: 0, tag: "issue", value: "letsencrypt.org" }
const SRV = { priority: 10, weight: 5, port: 5060, target: "Sip.Example.org." }

describe("recordBody: MX priority", () => {
  test("is sent for MX", () => {
    expect(bodyOf({ type: "MX", name: "@", content: "mail.example.org", priority: 0 })).toEqual({
      type: "MX",
      name: "example.com",
      content: "mail.example.org",
      ttl: 1,
      priority: 0,
    })
    expect(bodyOf({ type: "MX", name: "@", content: "mail.example.org", priority: 65535 }).priority).toBe(65535)
  })

  test("is required for MX and limited to 0–65535", () => {
    expect(refusalOf({ type: "MX", name: "@", content: "mail.example.org" })).toContain("requires `priority`")
    expect(refusalOf({ type: "MX", name: "@", content: "mail.example.org", priority: -1 })).toContain("from 0 to 65535")
    expect(refusalOf({ type: "MX", name: "@", content: "mail.example.org", priority: 65536 })).toContain(
      "from 0 to 65535",
    )
  })

  test.each(["A", "TXT", "CNAME"] as const)("is refused on %s", (type) => {
    const content = type === "A" ? "192.0.2.1" : type === "TXT" ? "text" : "target.example.org"

    expect(refusalOf({ type, name: "x", content, priority: 10 })).toContain("takes no `priority`")
  })

  test("is refused on SRV, which puts it in data", () => {
    expect(refusalOf({ type: "SRV", name: "_sip._tcp", data: SRV, priority: 10 })).toContain("an SRV record puts it in")
  })
})

describe("recordBody: CAA", () => {
  test("sends flags, tag and value as data", () => {
    expect(bodyOf({ type: "CAA", name: "@", data: CAA })).toEqual({
      type: "CAA",
      name: "example.com",
      data: CAA,
      ttl: 1,
    })
  })

  test.each(["issue", "issuewild", "iodef", "issuemail", "issuevmc"])("accepts the tag %s", (tag) => {
    expect(bodyOf({ type: "CAA", name: "@", data: { ...CAA, tag } }).data).toEqual({ ...CAA, tag })
  })

  test("refuses a tag outside the list", () => {
    expect(refusalOf({ type: "CAA", name: "@", data: { ...CAA, tag: "issues" } })).toContain("must be one of issue,")
  })

  test("limits flags to 0–255", () => {
    expect(bodyOf({ type: "CAA", name: "@", data: { ...CAA, flags: 255 } }).data).toMatchObject({ flags: 255 })
    expect(refusalOf({ type: "CAA", name: "@", data: { ...CAA, flags: 256 } })).toContain("data.flags")
    expect(refusalOf({ type: "CAA", name: "@", data: { ...CAA, flags: -1 } })).toContain("from 0 to 255")
  })

  test("takes a non-empty value of up to 255 characters without control characters", () => {
    expect(bodyOf({ type: "CAA", name: "@", data: { ...CAA, value: "a".repeat(255) } }).data).toMatchObject({
      value: "a".repeat(255),
    })
    expect(refusalOf({ type: "CAA", name: "@", data: { ...CAA, value: "" } })).toContain("data.value must be 1–255")
    expect(refusalOf({ type: "CAA", name: "@", data: { ...CAA, value: "a".repeat(256) } })).toContain("has 256")
    expect(refusalOf({ type: "CAA", name: "@", data: { ...CAA, value: "a\nb" } })).toContain("control characters")
  })

  test("needs all three keys and takes no other", () => {
    expect(refusalOf({ type: "CAA", name: "@", data: { flags: 0, tag: "issue" } })).toContain("needs value")
    expect(refusalOf({ type: "CAA", name: "@", data: {} })).toContain("needs flags, tag, value")
    expect(refusalOf({ type: "CAA", name: "@", data: { ...CAA, port: 80 } })).toContain(
      "CAA `data` takes only flags, tag, value; remove port",
    )
  })
})

describe("recordBody: SRV", () => {
  test("sends the four keys as data with the target normalized", () => {
    expect(bodyOf({ type: "SRV", name: "_sip._tcp", data: SRV })).toEqual({
      type: "SRV",
      name: "_sip._tcp.example.com",
      data: { ...SRV, target: "sip.example.org" },
      ttl: 1,
    })
  })

  test('accepts "." as the target meaning no service', () => {
    expect(bodyOf({ type: "SRV", name: "_sip._tcp", data: { ...SRV, target: "." } }).data).toMatchObject({
      target: ".",
    })
  })

  test("accepts a name below the service labels", () => {
    expect(bodyOf({ type: "SRV", name: "_sip._tcp.sub", data: SRV }).name).toBe("_sip._tcp.sub.example.com")
  })

  test.each(["@", "_sip", "sip._tcp", "_sip.tcp", "www"])("refuses the name %s, saying which form it takes", (name) => {
    expect(refusalOf({ type: "SRV", name, data: SRV })).toContain("two labels that begin with `_`")
  })

  test("limits priority, weight and port to 0–65535", () => {
    for (const key of ["priority", "weight", "port"] as const) {
      expect(bodyOf({ type: "SRV", name: "_a._b", data: { ...SRV, [key]: 65535 } }).data).toMatchObject({
        [key]: 65535,
      })
      expect(refusalOf({ type: "SRV", name: "_a._b", data: { ...SRV, [key]: 65536 } })).toContain(`data.${key}`)
    }
  })

  test("refuses a bad target and one equal to the record's own name", () => {
    expect(refusalOf({ type: "SRV", name: "_a._b", data: { ...SRV, target: "localhost" } })).toContain("data.target")
    expect(refusalOf({ type: "SRV", name: "_a._b", data: { ...SRV, target: "_a._b.example.com" } })).toContain(
      "the record's own name",
    )
  })

  test("needs all four keys and takes no other", () => {
    expect(refusalOf({ type: "SRV", name: "_a._b", data: { priority: 1, weight: 1, port: 1 } })).toContain(
      "needs target",
    )
    expect(refusalOf({ type: "SRV", name: "_a._b", data: { ...SRV, tag: "issue" } })).toContain(
      "SRV `data` takes only priority, weight, port, target; remove tag",
    )
  })
})

describe("recordBody: ttl", () => {
  test("defaults to automatic", () => {
    expect(bodyOf({ type: "A", name: "x", content: "192.0.2.1" }).ttl).toBe(1)
  })

  test.each([1, 60, 3600, 86400])("accepts %d", (ttl) => {
    expect(bodyOf({ type: "A", name: "x", content: "192.0.2.1", ttl }).ttl).toBe(ttl)
  })

  test.each([0, 2, 59, 86401, -1])("refuses %d", (ttl) => {
    expect(refusalOf({ type: "A", name: "x", content: "192.0.2.1", ttl })).toContain("1 for automatic, or 60–86400")
  })
})

describe("recordBody: proxied", () => {
  test.each([
    ["A", "192.0.2.1"],
    ["AAAA", "2001:db8::1"],
    ["CNAME", "target.example.org"],
  ] as const)("is sent for %s and defaults to false", (type, content) => {
    expect(bodyOf({ type, name: "x", content }).proxied).toBe(false)
    expect(bodyOf({ type, name: "x", content, proxied: true }).proxied).toBe(true)
  })

  test("is left out of the body of a type that cannot be proxied, and refused when true", () => {
    expect(bodyOf({ type: "TXT", name: "x", content: "t", proxied: false })).not.toHaveProperty("proxied")
    expect(bodyOf({ type: "CAA", name: "@", data: CAA })).not.toHaveProperty("proxied")
    expect(refusalOf({ type: "TXT", name: "x", content: "t", proxied: true })).toContain("only A, AAAA and CNAME")
    expect(refusalOf({ type: "MX", name: "@", content: "m.example.org", priority: 1, proxied: true })).toContain(
      "cannot be proxied",
    )
  })

  test("needs an automatic TTL", () => {
    expect(bodyOf({ type: "A", name: "x", content: "192.0.2.1", proxied: true, ttl: 1 }).ttl).toBe(1)
    expect(refusalOf({ type: "A", name: "x", content: "192.0.2.1", proxied: true, ttl: 300 })).toContain(
      "a proxied record's TTL is automatic",
    )
  })

  test("lets an unproxied record keep its TTL", () => {
    expect(bodyOf({ type: "A", name: "x", content: "192.0.2.1", proxied: false, ttl: 300 }).ttl).toBe(300)
  })
})

describe("recordBody: comment", () => {
  test("is sent when it is not empty and left out when it is", () => {
    expect(bodyOf({ type: "A", name: "x", content: "192.0.2.1", comment: "web front" }).comment).toBe("web front")
    expect(bodyOf({ type: "A", name: "x", content: "192.0.2.1", comment: "" })).not.toHaveProperty("comment")
  })

  test("takes up to 500 characters on one line", () => {
    expect(bodyOf({ type: "A", name: "x", content: "192.0.2.1", comment: "a".repeat(500) }).comment).toHaveLength(500)
    expect(refusalOf({ type: "A", name: "x", content: "192.0.2.1", comment: "a".repeat(501) })).toContain("501")
    expect(refusalOf({ type: "A", name: "x", content: "192.0.2.1", comment: "a\nb" })).toContain("one line")
    expect(refusalOf({ type: "A", name: "x", content: "192.0.2.1", comment: "a\rb" })).toContain("one line")
  })
})

describe("recordBody: refusals", () => {
  test("carry the position, the type and the relative name", () => {
    expect(refusalOf({ type: "SRV", name: "_a._b", data: { ...SRV, port: 70000 } })).toStartWith(
      `${WHERE} (SRV _a._b): data.port`,
    )
  })
})
