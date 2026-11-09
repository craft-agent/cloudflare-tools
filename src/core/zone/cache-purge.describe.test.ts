import { describe, expect, test } from "bun:test"
import { toolError, ZONE_ID } from "../cloudflare/client.fixtures"
import { callDescription } from "../describe"
import type { ConfirmRequest } from "../tool"
import { CTX, purgeRoute, PURGE_PATH, setup, ZONE_ROUTE } from "./cache-purge.fixtures"

/** A call context whose confirmation records what it was asked. */
function confirming() {
  const asked: ConfirmRequest[] = []
  const ctx = {
    ...CTX,
    confirm: async (request: ConfirmRequest) => {
      asked.push(request)
      return true
    },
  }
  return { asked, ctx }
}

describe("cloudflareZoneCachePurge: describe", () => {
  test("states its intent", () => {
    expect(setup([]).purge.intent).toBe("About to purge cached content")
  })

  test("names the zone and shows the normalized URLs, one per line", async () => {
    const { purge, requests } = setup([ZONE_ROUTE, purgeRoute()])

    const description = await purge.describe!(
      purge.input.parse({ zone: ZONE_ID, urls: ["http://example.com", "https://SUB.example.com/page?query=1#hash"] }),
      CTX,
    )

    expect(description).toEqual({
      headline: { text: "About to purge the cache of {zone} by URL", values: { zone: "example.com" } },
      facts: [{ label: "Count", value: "2" }],
      text: { label: "URLs", body: "http://example.com/\nhttps://sub.example.com/page?query=1" },
    })
    expect(requests.filter((request) => request.path === PURGE_PATH)).toEqual([])
  })

  test("describes each other kind with its headline and label", async () => {
    const { purge } = setup([ZONE_ROUTE, purgeRoute()])
    const cases = [
      [{ hosts: ["EXAMPLE.COM", "sub.example.com."] }, "by host", "Hosts", "example.com\nsub.example.com"],
      [{ prefixes: ["Example.com/a/"] }, "by prefix", "Prefixes", "example.com/a/"],
      [{ tags: ["a", "b"] }, "by tag", "Tags", "a\nb"],
    ] as const

    for (const [kind, by, label, body] of cases) {
      const description = await purge.describe!(purge.input.parse({ zone: ZONE_ID, ...kind }), CTX)

      expect(description.headline).toEqual({
        text: `About to purge the cache of {zone} ${by}`,
        values: { zone: "example.com" },
      })
      expect(description.text).toEqual({ label, body })
    }
  })

  test("is accepted by the description check and gives the same answer twice", async () => {
    const { purge } = setup([ZONE_ROUTE, purgeRoute()])
    const args = { zone: ZONE_ID, tags: ["a"] }

    const first = await callDescription(purge, args, CTX)

    expect(first).toBeDefined()
    expect(await callDescription(purge, args, CTX)).toEqual(first)
  })

  test("throws where execute would refuse, and sends no purge", async () => {
    const { purge, requests } = setup([ZONE_ROUTE, purgeRoute()])
    const refused = [
      { urls: ["not a url"] },
      { urls: ["https://other.org/x"] },
      { hosts: ["other.org"] },
      { urls: ["https://example.com/"], hosts: ["example.com"] },
    ]

    for (const args of refused) {
      const error = await toolError(
        Promise.resolve(purge.describe!(purge.input.parse({ zone: ZONE_ID, ...args }), CTX)),
      )

      expect(error.code).toBe("invalid_argument")
      expect(await callDescription(purge, { zone: ZONE_ID, ...args }, CTX)).toBeUndefined()
    }
    expect(requests.filter((request) => request.path === PURGE_PATH)).toEqual([])
  })
})

describe("cloudflareZoneCachePurgeAll: describe", () => {
  test("states its intent", () => {
    expect(setup([]).purgeAll.intent).toBe("About to purge a zone's whole cache")
  })

  test("names the zone and the effect, with no text, and never asks or purges", async () => {
    const { purgeAll, requests } = setup([ZONE_ROUTE, purgeRoute()])
    const { asked, ctx } = confirming()

    const description = await purgeAll.describe!(purgeAll.input.parse({ zone: ZONE_ID }), ctx)

    expect(description).toEqual({
      headline: { text: "About to purge the whole cache of {zone}", values: { zone: "example.com" } },
      facts: [{ label: "Effect", value: { text: "every next request goes to the origin" } }],
    })
    expect(asked).toEqual([])
    expect(requests.filter((request) => request.path === PURGE_PATH)).toEqual([])
  })

  test("is accepted by the description check and gives the same answer twice", async () => {
    const { purgeAll } = setup([ZONE_ROUTE, purgeRoute()])

    const first = await callDescription(purgeAll, { zone: ZONE_ID }, CTX)

    expect(first).toBeDefined()
    expect(await callDescription(purgeAll, { zone: ZONE_ID }, CTX)).toEqual(first)
  })

  test("throws when the zone cannot be resolved", async () => {
    const { purgeAll } = setup([])

    const error = await toolError(Promise.resolve(purgeAll.describe!(purgeAll.input.parse({ zone: ZONE_ID }), CTX)))

    expect(error.code).toBeDefined()
  })
})
