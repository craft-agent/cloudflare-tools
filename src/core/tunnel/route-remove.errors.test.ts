import { describe, expect, test } from "bun:test"
import { rejection, toolError } from "../cloudflare/client.fixtures"
import { fail, ok, type FakeReply } from "../cloudflare/testing"
import { cloudflareDnsRecordDelete } from "../dns/delete"
import { isAbortError, isToolError } from "../errors"
import { invoke } from "../tool"
import {
  A_RECORD,
  API_RULE,
  CATCH_ALL,
  CONFIG,
  CTX,
  HOSTNAME,
  OWN_CNAME,
  PUBLISHED_RULE,
  SERVICE,
  TUNNEL_ID,
  VERSION,
  ZONE_NAME,
  batchRoute,
  configRoute,
  publishedRoute,
  putRoute,
  recordsRoute,
  removeFor,
  sent,
  writes,
} from "./route.fixtures"

const ARGS = { tunnel: TUNNEL_ID, hostname: HOSTNAME }
const REFUSED = { code: 9005, message: "Content is invalid" }
const PUBLISHED = [API_RULE, PUBLISHED_RULE, CATCH_ALL]
const CONFIGURATION_DONE = "The tunnel's configuration was changed: it no longer publishes app.example.com."
const DNS_NOTE =
  "it still points the hostname at the tunnel, which answers with its catch-all. cloudflare_dns_read shows the records, and cloudflare_dns_record_delete with the record in this error's details deletes it."

/** A reply that changes with each call: the first one for the first call, the second for every call after. */
function changing(first: FakeReply, second: FakeReply): () => FakeReply {
  let calls = 0
  return () => (calls++ === 0 ? first : second)
}

function dropped(): never {
  throw new Error("connection reset")
}

describe("route remove: the configuration write fails", () => {
  test.each([
    [400, "invalid_argument"],
    [404, "not_found"],
    [429, "rate_limited"],
  ] as const)("keeps the code of a %p, says nothing was changed and deletes no record", async (status, code) => {
    const { tool, requests } = removeFor(putRoute(fail(status, [REFUSED])))

    const error = await toolError(invoke(tool, ARGS, CTX))

    expect(error.code).toBe(code)
    expect(error.message).toBe("9005: Content is invalid Nothing was changed.")
    expect(sent(requests, "POST")).toHaveLength(0)
  })

  test("names the Edit permission when forbidden, before the note", async () => {
    const { tool } = removeFor(putRoute(fail(403, [{ code: 10000, message: "Authentication error" }])))

    const error = await toolError(invoke(tool, ARGS, CTX))

    expect(error.code).toBe("forbidden")
    expect(error.message).toBe(
      "10000: Authentication error. The token needs Account → Cloudflare Tunnel → Edit. Nothing was changed.",
    )
  })

  test.each([
    ["a 500", fail(500, [{ code: 1000, message: "Down" }]), "Cloudflare answered HTTP 500: 1000: Down "],
    ["a dropped connection", dropped, "Cloudflare could not be reached: connection reset "],
  ])(
    "says Cloudflare may or may not have changed it after %s, and deletes no record",
    async (_what, reply, failure) => {
      const { tool, requests } = removeFor(putRoute(reply))

      const error = await toolError(invoke(tool, ARGS, CTX))

      expect(error.code).toBe("upstream_error")
      expect(error.message).toBe(
        `${failure}Cloudflare may or may not have changed the tunnel's configuration, and no DNS record was deleted; read cloudflare_tunnel_read tunnel before sending it again.`,
      )
      expect(sent(requests, "POST")).toHaveLength(0)
    },
  )

  test("passes a cancellation during the write on untouched, and deletes no record", async () => {
    const controller = new AbortController()
    const { tool, requests } = removeFor(
      putRoute(() => {
        controller.abort()
        return ok({})
      }),
    )

    const error = await rejection(invoke(tool, ARGS, { ...CTX, signal: controller.signal }))

    expect(isAbortError(error)).toBe(true)
    expect(isToolError(error)).toBe(false)
    expect(sent(requests, "POST")).toHaveLength(0)
  })
})

describe("route remove: the DNS delete fails after the configuration was written", () => {
  /** What a failure of the batch leaves: the configuration written, one batch sent, and the error. */
  async function failedWith(reply: FakeReply | (() => FakeReply), args: object = ARGS) {
    const { tool, requests } = removeFor(batchRoute(reply))
    const error = await toolError(invoke(tool, args, CTX))
    expect(sent(requests, "PUT")).toHaveLength(1)
    expect(sent(requests, "POST")).toHaveLength(1)
    return error
  }

  test("keeps the code of a refusal, says the record was not deleted and carries the call that deletes it", async () => {
    const error = await failedWith(fail(400, [REFUSED]))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toBe(
      `9005: Content is invalid. ${CONFIGURATION_DONE} The DNS record was not deleted; ${DNS_NOTE}`,
    )
    expect(error.details).toEqual({
      done: ["configuration"],
      configuration: { tunnel: TUNNEL_ID, removed: { hostname: HOSTNAME, service: SERVICE } },
      remaining: { tool: "cloudflare_dns_record_delete", arguments: { zone: ZONE_NAME, ids: [OWN_CNAME.id] } },
    })
  })

  test("carries arguments the DNS delete tool accepts, with the account the call named and the path of the rule", async () => {
    const withPath = { hostname: HOSTNAME, path: "^/a", service: SERVICE }
    const { tool } = removeFor(publishedRoute([withPath, CATCH_ALL]), batchRoute(fail(400, [REFUSED])))

    const error = await toolError(invoke(tool, { ...ARGS, account: "default", path: "^/a" }, CTX))

    const call = (error.details as { remaining: { arguments: Record<string, unknown> } }).remaining.arguments
    const parsed = cloudflareDnsRecordDelete.input.parse(call)
    expect(parsed).toEqual({ account: "default", zone: ZONE_NAME, ids: [OWN_CNAME.id] })
    expect(error.details).toMatchObject({ configuration: { removed: withPath } })
    expect(error.message).toContain(`it no longer publishes ${HOSTNAME} (path ^/a).`)
  })

  test("leaves the account out of the call when the call named none", async () => {
    const error = await failedWith(fail(400, [REFUSED]))

    const call = (error.details as { remaining: { arguments: object } }).remaining.arguments
    expect(call).not.toHaveProperty("account")
    expect(cloudflareDnsRecordDelete.input.safeParse(call).success).toBe(true)
  })

  test("names the DNS Edit permission when forbidden", async () => {
    const error = await failedWith(fail(403, [{ code: 10000, message: "Authentication error" }]))

    expect(error.code).toBe("forbidden")
    expect(error.message).toStartWith(
      `10000: Authentication error. The token needs Zone → DNS → Edit. ${CONFIGURATION_DONE} The DNS record was not deleted;`,
    )
  })

  test("is an upstream_error that may or may not have deleted the record after a 500", async () => {
    const error = await failedWith(fail(500, [{ code: 1000, message: "Down" }]))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe(
      `Cloudflare answered HTTP 500: 1000: Down. ${CONFIGURATION_DONE} Cloudflare may or may not have deleted the DNS record; ${DNS_NOTE}`,
    )
    expect(error.details).toMatchObject({
      done: ["configuration"],
      remaining: { tool: "cloudflare_dns_record_delete" },
    })
  })

  test("is the same when the connection drops, or the reply is not an object", async () => {
    const lost = await failedWith(dropped)
    const odd = await failedWith(ok(null))

    expect(lost.message).toContain("Cloudflare could not be reached: connection reset.")
    expect(odd.message).toStartWith("Cloudflare returned an unexpected DNS batch response.")
    for (const error of [lost, odd]) {
      expect(error.code).toBe("upstream_error")
      expect(error.message).toContain("Cloudflare may or may not have deleted the DNS record;")
      expect(error.details).toHaveProperty("remaining")
    }
  })

  test("passes a cancellation during the DNS delete on untouched", async () => {
    const controller = new AbortController()
    const { tool } = removeFor(
      batchRoute(() => {
        controller.abort()
        return ok({ deletes: [OWN_CNAME] })
      }),
    )

    const error = await rejection(invoke(tool, ARGS, { ...CTX, signal: controller.signal }))

    expect(isAbortError(error)).toBe(true)
    expect(isToolError(error)).toBe(false)
  })
})

describe("route remove: waiting for the answer", () => {
  const withAnswer = { ...CTX, confirm: async () => true }
  const config = (version: number, ingress: unknown[]) => ok({ version, config: { ...CONFIG, ingress } })

  test("reads the tunnel, the configuration and the records a second time after an answer, and writes when nothing changed", async () => {
    const { tool, requests } = removeFor()

    await invoke(tool, ARGS, withAnswer)

    const reads = (suffix: string) => requests.filter((r) => r.method === "GET" && r.path.endsWith(suffix))
    expect(reads("/configurations")).toHaveLength(2)
    expect(reads("/dns_records")).toHaveLength(2)
    expect(writes(requests)).toHaveLength(2)
  })

  test.each([
    ["the version", configRoute(changing(config(VERSION, PUBLISHED), config(VERSION + 1, PUBLISHED)))],
    [
      "the rules, though not the version",
      configRoute(changing(config(VERSION, PUBLISHED), config(VERSION, [CATCH_ALL]))),
    ],
    ["the record that would go", recordsRoute(changing(ok([OWN_CNAME]), ok([{ ...OWN_CNAME, id: "7".repeat(32) }])))],
    [
      "a record that appeared next to the one that would go",
      recordsRoute(changing(ok([OWN_CNAME]), ok([OWN_CNAME, A_RECORD]))),
    ],
    ["the record that would go, now gone", recordsRoute(changing(ok([OWN_CNAME]), ok([])))],
    ["a hostname with no record, now with one", recordsRoute(changing(ok([]), ok([OWN_CNAME])))],
  ])("refuses as stale, sending no write, when %s changed", async (_what, route) => {
    const { tool, requests } = removeFor(route)

    const error = await toolError(invoke(tool, ARGS, withAnswer))

    expect(error.code).toBe("stale")
    expect(error.message).toBe(
      `The tunnel's configuration or ${HOSTNAME}'s DNS records changed while waiting for the answer. Nothing was changed; read them again before trying again.`,
    )
    expect(writes(requests)).toEqual([])
  })

  test("sends nothing when the person declines", async () => {
    const { tool, requests } = removeFor()

    const error = await toolError(invoke(tool, ARGS, { ...CTX, confirm: async () => false }))

    expect(error.code).toBe("declined")
    expect(writes(requests)).toEqual([])
  })

  test("passes a cancellation during the second read on untouched, sending no write", async () => {
    const controller = new AbortController()
    let calls = 0
    const { tool, requests } = removeFor(
      configRoute(() => {
        if (++calls === 2) controller.abort()
        return config(VERSION, PUBLISHED)
      }),
    )

    const error = await rejection(invoke(tool, ARGS, { ...withAnswer, signal: controller.signal }))

    expect(isAbortError(error)).toBe(true)
    expect(writes(requests)).toEqual([])
  })
})
