import { describe, expect, test } from "bun:test"
import { ACCOUNT_ID, toolError, ZONE_ID } from "../cloudflare/client.fixtures"
import { fail, ok } from "../cloudflare/testing"
import { annotations, invoke, REQUIRES_USER_INTERACTION, toolMeta, type ConfirmRequest } from "../tool"
import { cloudflareZoneCachePurgeAll } from "./cache-purge-all"
import { CTX, PURGE_ID, PURGE_PATH, purgeRoute, setup, ZONE_PATH, ZONE_ROUTE } from "./cache-purge.fixtures"

describe("cloudflareZoneCachePurgeAll", () => {
  test("purges entire cache with purge_everything body", async () => {
    const asked: ConfirmRequest[] = []
    const { purgeAll, requests } = setup([ZONE_ROUTE, purgeRoute()])

    const result = await invoke(
      purgeAll,
      { zone: ZONE_ID },
      {
        ...CTX,
        confirm: async (req) => {
          asked.push(req)
          return true
        },
      },
    )

    expect(result).toEqual({
      label: "default",
      zone: { id: ZONE_ID, name: "example.com" },
      purged: { kind: "everything", items: [] },
      purge_id: PURGE_ID,
    })

    expect(asked).toHaveLength(1)
    expect(asked[0]!.tool).toBe("cloudflare_zone_cache_purge_all")
    expect(asked[0]!.message).toBe(
      `Purge the whole cache of zone example.com (${ZONE_ID}) in the Cloudflare account default: every next request goes to the origin.`,
    )

    const purgeRequest = requests.find((r) => r.path === PURGE_PATH)
    expect(purgeRequest?.body).toEqual({ purge_everything: true })
  })

  test("declined confirm throws declined and sends nothing", async () => {
    const { purgeAll, requests } = setup([ZONE_ROUTE, purgeRoute()])

    const error = await toolError(invoke(purgeAll, { zone: ZONE_ID }, { ...CTX, confirm: async () => false }))

    expect(error.code).toBe("declined")
    expect(requests.filter((r) => r.path === PURGE_PATH)).toHaveLength(0)
  })

  test("zone of another account throws not_found and sends nothing", async () => {
    const { purgeAll, requests } = setup([
      {
        method: "GET",
        path: ZONE_PATH,
        reply: ok({ id: ZONE_ID, name: "example.com", account: { id: "0".repeat(32) } }),
      },
      purgeRoute(),
    ])

    const error = await toolError(invoke(purgeAll, { zone: ZONE_ID }, { ...CTX, confirm: async () => true }))

    expect(error.code).toBe("not_found")
    expect(requests.filter((r) => r.path === PURGE_PATH)).toHaveLength(0)
  })

  test("resolves target to <account_id>/zones/<zone_id>", async () => {
    const { purgeAll } = setup([ZONE_ROUTE])

    const targets = await purgeAll.targets!({ zone: ZONE_ID }, CTX)
    expect(targets).toEqual([`${ACCOUNT_ID}/zones/${ZONE_ID}`])
  })

  test("returns * when zone is not found", async () => {
    const { purgeAll } = setup([{ method: "GET", path: ZONE_PATH, reply: fail(404, [{ code: 7003, message: "No" }]) }])

    const targets = await purgeAll.targets!({ zone: ZONE_ID }, CTX)
    expect(targets).toEqual(["*"])
  })

  test("has administrative annotations and REQUIRES_USER_INTERACTION toolMeta", () => {
    expect(annotations(cloudflareZoneCachePurgeAll)).toEqual({
      title: "Purge entire Cloudflare zone cache",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    })
    expect(toolMeta(cloudflareZoneCachePurgeAll)).toEqual({ [REQUIRES_USER_INTERACTION]: true })
    expect(cloudflareZoneCachePurgeAll.toolset).toBe("zones")
  })
})
