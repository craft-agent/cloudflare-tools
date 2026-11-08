import { describe, expect, test } from "bun:test"
import { toolError } from "../cloudflare/client.fixtures"
import { ok } from "../cloudflare/testing"
import { invoke } from "../tool"
import {
  ARGS,
  CATCH_ALL,
  CONFIG,
  CTX,
  HOSTNAME,
  OWN_CNAME,
  TUNNEL_ID,
  TUNNEL_PATH,
  VERSION,
  changing,
  configRoute,
  recordsRoute,
  routeFor,
  sent,
  writes,
} from "./route.fixtures"

describe("route add: waiting for the answer", () => {
  const answer = async () => true
  const withAnswer = { ...CTX, confirm: answer }

  test("reads the tunnel, its configuration and the records a second time after an answer, and writes when nothing changed", async () => {
    const { tool, requests } = routeFor()

    await invoke(tool, ARGS, withAnswer)

    const reads = (suffix: string) => requests.filter((r) => r.method === "GET" && r.path.endsWith(suffix))
    expect(reads("/configurations")).toHaveLength(2)
    expect(reads("/dns_records")).toHaveLength(2)
    expect(sent(requests, "PUT")).toHaveLength(1)
  })

  test("reads nothing a second time without an answer to wait for", async () => {
    const { tool, requests } = routeFor()

    await invoke(tool, ARGS, CTX)

    expect(requests.filter((r) => r.path.endsWith("/configurations") && r.method === "GET")).toHaveLength(1)
  })

  test.each([
    [
      "the configuration's version",
      configRoute(changing(ok({ version: VERSION, config: CONFIG }), ok({ version: VERSION + 1, config: CONFIG }))),
    ],
    [
      "the rules, though not the version",
      configRoute(
        changing(
          ok({ version: VERSION, config: CONFIG }),
          ok({ version: VERSION, config: { ...CONFIG, ingress: [CATCH_ALL] } }),
        ),
      ),
    ],
    ["a DNS record that appeared", recordsRoute(changing(ok([]), ok([OWN_CNAME])))],
    [
      "the DNS record that was kept",
      recordsRoute(changing(ok([OWN_CNAME]), ok([{ ...OWN_CNAME, id: "7".repeat(32) }]))),
    ],
    ["a DNS record that went", recordsRoute(changing(ok([OWN_CNAME]), ok([])))],
  ])("refuses as stale, sending no write, when %s changed", async (_what, route) => {
    const { tool, requests } = routeFor(route)

    const error = await toolError(invoke(tool, ARGS, withAnswer))

    expect(error.code).toBe("stale")
    expect(error.message).toBe(
      `The tunnel's configuration or ${HOSTNAME}'s DNS records changed while waiting for the answer. Nothing was changed; read them again before trying again.`,
    )
    expect(writes(requests)).toEqual([])
  })

  test("refuses as stale when a record of another kind appeared too", async () => {
    const other = { ...OWN_CNAME, type: "A", content: "192.0.2.10" }
    const { tool, requests } = routeFor(recordsRoute(changing(ok([]), ok([other]))))

    const error = await toolError(invoke(tool, ARGS, withAnswer))

    expect(error.code).toBe("stale")
    expect(writes(requests)).toEqual([])
  })

  test("sends nothing when the person declines", async () => {
    const { tool, requests } = routeFor()

    const error = await toolError(invoke(tool, ARGS, { ...CTX, confirm: async () => false }))

    expect(error.code).toBe("declined")
    expect(writes(requests)).toEqual([])
  })

  test("refuses a tunnel that was deleted while waiting", async () => {
    const entry = { id: TUNNEL_ID, name: "n", config_src: "cloudflare" }
    const deleted = { ...entry, deleted_at: "2024-05-01T00:00:00Z" }
    const { tool, requests } = routeFor({
      method: "GET",
      path: TUNNEL_PATH,
      reply: changing(ok(entry), ok(deleted)),
    })

    const error = await toolError(invoke(tool, ARGS, withAnswer))

    expect(error.code).toBe("not_found")
    expect(writes(requests)).toEqual([])
  })
})
