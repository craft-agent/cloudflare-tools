import { describe, expect, test } from "bun:test"
import { toolError, ZONE_ID } from "../cloudflare/client.fixtures"
import { ok } from "../cloudflare/testing"
import { invoke } from "../tool"
import { CTX, PURGE_PATH, purgeRoute, setup, ZONE_PATH, ZONE_ROUTE } from "./cache-purge.fixtures"

describe("cloudflareZoneCachePurge: arguments and validation", () => {
  test("refuses when none or several forms are provided", async () => {
    const { purge } = setup([ZONE_ROUTE, purgeRoute()])

    const noneError = await toolError(invoke(purge, { zone: ZONE_ID }, CTX))
    expect(noneError.code).toBe("invalid_argument")
    expect(noneError.message).toContain("exactly one of urls, hosts, prefixes or tags")

    const severalError = await toolError(
      invoke(
        purge,
        {
          zone: ZONE_ID,
          urls: ["http://example.com/"],
          hosts: ["example.com"],
        },
        CTX,
      ),
    )
    expect(severalError.code).toBe("invalid_argument")
    expect(severalError.message).toContain("exactly one of urls, hosts, prefixes or tags")
  })

  test("refuses urls, hosts, or prefixes outside the zone", async () => {
    const { purge } = setup([ZONE_ROUTE, purgeRoute()])

    const urlError = await toolError(invoke(purge, { zone: ZONE_ID, urls: ["https://other.com/page"] }, CTX))
    expect(urlError.code).toBe("invalid_argument")
    expect(urlError.message).toContain("other.com is not in the zone example.com")

    const hostError = await toolError(invoke(purge, { zone: ZONE_ID, hosts: ["notexample.com"] }, CTX))
    expect(hostError.code).toBe("invalid_argument")
    expect(hostError.message).toContain("notexample.com is not in the zone example.com")

    const prefixError = await toolError(invoke(purge, { zone: ZONE_ID, prefixes: ["other.org/static"] }, CTX))
    expect(prefixError.code).toBe("invalid_argument")
    expect(prefixError.message).toContain("other.org is not in the zone example.com")
  })

  test("refuses prefix with scheme", async () => {
    const { purge } = setup([ZONE_ROUTE, purgeRoute()])

    const error = await toolError(invoke(purge, { zone: ZONE_ID, prefixes: ["http://example.com/foo"] }, CTX))
    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain('prefixes[0]: prefix must not include a scheme ("://")')
  })

  test("refuses duplicate items naming position", async () => {
    const { purge } = setup([ZONE_ROUTE, purgeRoute()])

    const rawDup = await toolError(
      invoke(purge, { zone: ZONE_ID, urls: ["http://example.com/a", "http://example.com/a"] }, CTX),
    )
    expect(rawDup.code).toBe("invalid_argument")
    expect(rawDup.message).toContain("urls[1]: duplicate item")

    const normDup = await toolError(
      invoke(purge, { zone: ZONE_ID, urls: ["http://example.com", "http://example.com/"] }, CTX),
    )
    expect(normDup.code).toBe("invalid_argument")
    expect(normDup.message).toContain("urls[1]: duplicate item")
  })

  test("refuses over-limit arrays (>100 items)", async () => {
    const { purge } = setup([ZONE_ROUTE, purgeRoute()])

    const items = Array.from({ length: 101 }, (_, i) => `https://example.com/page${i}`)
    const error = await toolError(invoke(purge, { zone: ZONE_ID, urls: items }, CTX))
    expect(error.code).toBe("invalid_argument")
  })

  test("refuses tags with whitespace or comma", async () => {
    const { purge } = setup([ZONE_ROUTE, purgeRoute()])

    const spaceError = await toolError(invoke(purge, { zone: ZONE_ID, tags: ["good-tag", "bad tag"] }, CTX))
    expect(spaceError.code).toBe("invalid_argument")
    expect(spaceError.message).toContain("tags[1]: contains whitespace or comma")

    const commaError = await toolError(invoke(purge, { zone: ZONE_ID, tags: ["bad,tag"] }, CTX))
    expect(commaError.code).toBe("invalid_argument")
    expect(commaError.message).toContain("tags[0]: contains whitespace or comma")
  })

  test("refuses items with whitespace or control characters", async () => {
    const { purge } = setup([ZONE_ROUTE, purgeRoute()])

    const error = await toolError(invoke(purge, { zone: ZONE_ID, urls: ["https://example.com/foo bar"] }, CTX))
    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("urls[0]: contains whitespace or control characters")
  })

  test("refuses zone of another account and sends nothing", async () => {
    const { purge, requests } = setup([
      {
        method: "GET",
        path: ZONE_PATH,
        reply: ok({ id: ZONE_ID, name: "example.com", account: { id: "0".repeat(32) } }),
      },
      purgeRoute(),
    ])

    const error = await toolError(invoke(purge, { zone: ZONE_ID, hosts: ["example.com"] }, CTX))
    expect(error.code).toBe("not_found")
    expect(requests.filter((r) => r.path === PURGE_PATH)).toHaveLength(0)
  })
})
