import { describe, expect, test } from "bun:test"
import { rejection, toolError } from "../cloudflare/client.fixtures"
import { fail, ok, type FakeReply } from "../cloudflare/testing"
import { cloudflareDnsRecordAdd } from "../dns/add"
import { recordBody } from "../dns/values"
import { isAbortError, isToolError } from "../errors"
import { invoke } from "../tool"
import {
  ARGS,
  CTX,
  HOSTNAME,
  NEW_RULE,
  OWN_CNAME,
  SERVICE,
  TARGET,
  TUNNEL_ID,
  ZONE_NAME,
  batchRoute,
  dropped,
  putRoute,
  routeFor,
  sent,
} from "./route.fixtures"

const REFUSED = { code: 9005, message: "Content is invalid" }
const DNS_NOTE =
  "until it is, no visitor reaches the hostname. cloudflare_dns_read shows the records, and cloudflare_dns_record_add with the record in this error's details adds it."
const CONFIGURATION_DONE = `The tunnel's configuration was changed: it now sends ${HOSTNAME} to ${SERVICE}.`

describe("route add: the configuration write fails", () => {
  test.each([
    [400, "invalid_argument"],
    [404, "not_found"],
    [429, "rate_limited"],
  ] as const)("keeps the code of a %p and says nothing was changed, and adds no record", async (status, code) => {
    const { tool, requests } = routeFor(putRoute(fail(status, [REFUSED])))

    const error = await toolError(invoke(tool, ARGS, CTX))

    expect(error.code).toBe(code)
    expect(error.message).toStartWith("9005: Content is invalid")
    expect(error.message).toEndWith(" Nothing was changed.")
    expect(sent(requests, "POST")).toHaveLength(0)
  })

  test("names the Edit permission when forbidden, before the note", async () => {
    const { tool, requests } = routeFor(putRoute(fail(403, [{ code: 10000, message: "Authentication error" }])))

    const error = await toolError(invoke(tool, ARGS, CTX))

    expect(error.code).toBe("forbidden")
    expect(error.message).toBe(
      "10000: Authentication error. The token needs Account → Cloudflare One Connector: cloudflared → Edit. Nothing was changed.",
    )
    expect(sent(requests, "POST")).toHaveLength(0)
  })

  test("says Cloudflare may or may not have changed it after a 500, and adds no record", async () => {
    const { tool, requests } = routeFor(putRoute(fail(500, [{ code: 1000, message: "Down" }])))

    const error = await toolError(invoke(tool, ARGS, CTX))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe(
      "Cloudflare answered HTTP 500: 1000: Down. Cloudflare may or may not have changed the tunnel's configuration, and no DNS record was added; read cloudflare_tunnel_read tunnel before sending it again.",
    )
    expect(sent(requests, "POST")).toHaveLength(0)
  })

  test("says so too when the connection drops", async () => {
    const { tool, requests } = routeFor(putRoute(dropped))

    const error = await toolError(invoke(tool, ARGS, CTX))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toStartWith(
      "Cloudflare could not be reached: connection reset. Cloudflare may or may not have",
    )
    expect(sent(requests, "POST")).toHaveLength(0)
  })

  test("passes a cancellation during the write on untouched, and adds no record", async () => {
    const controller = new AbortController()
    const { tool, requests } = routeFor(
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

describe("route add: the DNS step fails after the configuration was written", () => {
  /** What a failure of the batch leaves: the configuration written, one batch sent, and the error. */
  async function failedWith(reply: FakeReply | (() => FakeReply), args: object = ARGS) {
    const { tool, requests } = routeFor(batchRoute(reply))
    const error = await toolError(invoke(tool, args, CTX))
    expect(sent(requests, "PUT")).toHaveLength(1)
    expect(sent(requests, "POST")).toHaveLength(1)
    return error
  }

  test("keeps the code of a refusal, says the record was not added and carries the call that adds it", async () => {
    const error = await failedWith(fail(400, [REFUSED]))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toBe(
      `9005: Content is invalid. ${CONFIGURATION_DONE} The DNS record was not added; ${DNS_NOTE}`,
    )
    expect(error.details).toEqual({
      done: ["configuration"],
      configuration: { tunnel: TUNNEL_ID, rule: NEW_RULE },
      remaining: {
        tool: "cloudflare_dns_record_add",
        arguments: {
          zone: ZONE_NAME,
          records: [{ type: "CNAME", name: HOSTNAME, content: TARGET, proxied: true, comment: "Cloudflare Tunnel" }],
        },
      },
    })
  })

  test("carries arguments the DNS add tool accepts, with the account the call named and the path of the rule", async () => {
    const error = await failedWith(fail(400, [REFUSED]), { ...ARGS, account: "default", path: "^/admin" })

    const call = (error.details as { remaining: { arguments: Record<string, unknown> } }).remaining.arguments
    const parsed = cloudflareDnsRecordAdd.input.parse(call)
    expect(parsed.account).toBe("default")
    expect(parsed.zone).toBe(ZONE_NAME)
    expect(() => recordBody(parsed.records[0]!, ZONE_NAME, "records[0]")).not.toThrow()
    expect(error.details).toMatchObject({ configuration: { rule: { ...NEW_RULE, path: "^/admin" } } })
    expect(error.message).toContain(`it now sends ${HOSTNAME} (path ^/admin) to ${SERVICE}.`)
  })

  test("leaves the account out of the call when the call named none", async () => {
    const error = await failedWith(fail(400, [REFUSED]))

    const call = (error.details as { remaining: { arguments: object } }).remaining.arguments
    expect(call).not.toHaveProperty("account")
    expect(cloudflareDnsRecordAdd.input.safeParse(call).success).toBe(true)
  })

  test("names the DNS Edit permission when forbidden", async () => {
    const error = await failedWith(fail(403, [{ code: 10000, message: "Authentication error" }]))

    expect(error.code).toBe("forbidden")
    expect(error.message).toStartWith(
      `10000: Authentication error. The token needs Zone → DNS → Edit. ${CONFIGURATION_DONE} The DNS record was not added;`,
    )
  })

  test("is an upstream_error that may or may not have added the record after a 500", async () => {
    const error = await failedWith(fail(500, [{ code: 1000, message: "Down" }]))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe(
      `Cloudflare answered HTTP 500: 1000: Down. ${CONFIGURATION_DONE} Cloudflare may or may not have added the DNS record; ${DNS_NOTE}`,
    )
    expect(error.details).toMatchObject({ done: ["configuration"], remaining: { tool: "cloudflare_dns_record_add" } })
  })

  test("is the same when the connection drops", async () => {
    const error = await failedWith(dropped)

    expect(error.code).toBe("upstream_error")
    expect(error.message).toContain("Cloudflare could not be reached: connection reset.")
    expect(error.message).toContain("Cloudflare may or may not have added the DNS record;")
    expect(error.details).toHaveProperty("remaining")
  })

  test.each([
    ["without records", ok({})],
    ["with no created record", ok({ posts: [] })],
    ["with a reply that is not an object", ok(null)],
  ])("treats a batch reply %s as unexpected, so the record may or may not be there", async (_what, reply) => {
    const error = await failedWith(reply)

    expect(error.code).toBe("upstream_error")
    expect(error.message).toStartWith("Cloudflare returned an unexpected DNS batch response.")
    expect(error.message).toContain("may or may not have added the DNS record;")
  })

  test("passes a cancellation during the DNS step on untouched", async () => {
    const controller = new AbortController()
    const { tool } = routeFor(
      batchRoute(() => {
        controller.abort()
        return ok({ posts: [OWN_CNAME] })
      }),
    )

    const error = await rejection(invoke(tool, ARGS, { ...CTX, signal: controller.signal }))

    expect(isAbortError(error)).toBe(true)
    expect(isToolError(error)).toBe(false)
  })
})
