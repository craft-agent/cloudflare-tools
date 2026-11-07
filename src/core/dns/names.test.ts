import { describe, expect, test } from "bun:test"
import { isToolError } from "../errors"
import { recordName, relativeName } from "./names"

const ZONE = "example.com"

function refusal(input: string, zone = ZONE): string {
  try {
    recordName(input, zone)
  } catch (error) {
    if (isToolError(error) && error.code === "invalid_argument") return error.message
    throw error
  }
  throw new Error(`Expected "${input}" to be refused`)
}

describe("recordName: what a name stands for", () => {
  test("a relative name gets the zone appended", () => {
    expect(recordName("www", ZONE)).toBe("www.example.com")
    expect(recordName("a.b", ZONE)).toBe("a.b.example.com")
  })

  test("@ and the zone itself are the apex", () => {
    expect(recordName("@", ZONE)).toBe(ZONE)
    expect(recordName(" @ ", ZONE)).toBe(ZONE)
    expect(recordName("example.com", ZONE)).toBe(ZONE)
  })

  test("a full name is kept", () => {
    expect(recordName("www.example.com", ZONE)).toBe("www.example.com")
  })

  test("a trailing dot makes the name full", () => {
    expect(recordName("www.example.com.", ZONE)).toBe("www.example.com")
    expect(recordName("example.com.", ZONE)).toBe(ZONE)
  })

  test("a name is trimmed and lowercased", () => {
    expect(recordName("  WWW.Example.COM ", ZONE)).toBe("www.example.com")
  })

  test("a name that merely ends like the zone is still relative", () => {
    expect(recordName("notexample.com", ZONE)).toBe("notexample.com.example.com")
    expect(recordName("other.org", ZONE)).toBe("other.org.example.com")
  })

  test("IDN labels become punycode", () => {
    expect(recordName("bücher", ZONE)).toBe("xn--bcher-kva.example.com")
    expect(recordName("BÜCHER.example.com", ZONE)).toBe("xn--bcher-kva.example.com")
  })

  test("a name under an IDN zone given in Unicode is full", () => {
    expect(recordName("www.bücher.de", "xn--bcher-kva.de")).toBe("www.xn--bcher-kva.de")
  })

  test("a wildcard stays a leading label", () => {
    expect(recordName("*", ZONE)).toBe("*.example.com")
    expect(recordName("*.sub", ZONE)).toBe("*.sub.example.com")
    expect(recordName("*.example.com", ZONE)).toBe("*.example.com")
    expect(recordName("*.bücher", ZONE)).toBe("*.xn--bcher-kva.example.com")
  })

  test("labels may start with an underscore", () => {
    expect(recordName("_dmarc", ZONE)).toBe("_dmarc.example.com")
    expect(recordName("_sip._tcp", ZONE)).toBe("_sip._tcp.example.com")
  })
})

describe("recordName: refusals", () => {
  test("a wildcard anywhere but the whole leftmost label", () => {
    expect(refusal("a.*.b")).toContain('"a.*.b"')
    expect(refusal("a.*.b")).toContain("leftmost")
    expect(refusal("w*w")).toContain("w*w")
    expect(refusal("**")).toContain("**")
  })

  test("a label that starts or ends with a hyphen", () => {
    expect(refusal("-bad")).toContain("starts or ends with")
    expect(refusal("bad-")).toContain("starts or ends with")
  })

  test("a label of 64 characters, but not of 63", () => {
    expect(recordName("a".repeat(63), ZONE)).toBe(`${"a".repeat(63)}.example.com`)
    expect(refusal("a".repeat(64))).toContain("longer than 63")
  })

  test("a full name longer than 253 characters", () => {
    const long = Array.from({ length: 5 }, () => "a".repeat(50)).join(".")
    expect(refusal(long)).toContain("longer than 253")
  })

  test("empty names", () => {
    expect(refusal("")).toContain("empty")
    expect(refusal("   ")).toContain("empty")
    expect(refusal(".")).toContain("empty")
  })

  test("empty labels", () => {
    expect(refusal("a..b")).toContain("empty label")
    expect(refusal(".www")).toContain("empty label")
  })

  test("characters a label cannot hold", () => {
    expect(refusal("exa mple")).toContain('"exa mple"')
    expect(refusal("a/b")).toContain("a/b")
    expect(refusal("@.sub")).toContain("@.sub")
  })

  test("a full name with a trailing dot outside the zone", () => {
    expect(refusal("other.org.")).toContain("not in the zone example.com")
    expect(refusal("notexample.com.")).toContain("not in the zone")
  })

  test("the message names the input as given", () => {
    expect(refusal("-Bad")).toContain('"-Bad"')
  })
})

describe("relativeName", () => {
  test("is @ for the apex", () => {
    expect(relativeName(ZONE, ZONE)).toBe("@")
  })

  test("is the part before the zone", () => {
    expect(relativeName("www.example.com", ZONE)).toBe("www")
    expect(relativeName("a.b.example.com", ZONE)).toBe("a.b")
    expect(relativeName("*.example.com", ZONE)).toBe("*")
  })

  test("keeps a name outside the zone", () => {
    expect(relativeName("other.org", ZONE)).toBe("other.org")
    expect(relativeName("notexample.com", ZONE)).toBe("notexample.com")
  })
})
