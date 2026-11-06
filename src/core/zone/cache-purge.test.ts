import { describe, expect, test } from "bun:test"
import { ACCOUNT_ID, ZONE_ID } from "../cloudflare/client.fixtures"
import { fail, ok } from "../cloudflare/testing"
import { annotations, invoke, toolMeta } from "../tool"
import { cloudflareZoneCachePurge } from "./cache-purge"
import { CTX, PURGE_ID, PURGE_PATH, purgeRoute, setup, ZONE_PATH, ZONE_ROUTE } from "./cache-purge.fixtures"

describe("cloudflareZoneCachePurge: forms and body", () => {
  test("purges urls and sends files with normalized URL", async () => {
    const { purge, requests } = setup([ZONE_ROUTE, purgeRoute()])

    const result = await invoke(
      purge,
      {
        zone: ZONE_ID,
        urls: ["http://example.com", "https://sub.example.com/page?query=1#hash"],
      },
      CTX,
    )

    expect(result).toEqual({
      label: "default",
      zone: { id: ZONE_ID, name: "example.com" },
      purged: {
        kind: "urls",
        items: ["http://example.com/", "https://sub.example.com/page?query=1"],
      },
      purge_id: PURGE_ID,
    })

    const purgeRequest = requests.find((r) => r.path === PURGE_PATH)
    expect(purgeRequest?.body).toEqual({
      files: ["http://example.com/", "https://sub.example.com/page?query=1"],
    })
  })

  test("normalizes IDN domain to punycode and lowercases host", async () => {
    const { purge, requests } = setup([ZONE_ROUTE, purgeRoute()])

    const result = await invoke(
      purge,
      {
        zone: ZONE_ID,
        urls: ["https://MÜNCHEN.example.com:8080/path"],
      },
      CTX,
    )

    expect(result.purged.items).toEqual(["https://xn--mnchen-3ya.example.com:8080/path"])
    const purgeRequest = requests.find((r) => r.path === PURGE_PATH)
    expect(purgeRequest?.body).toEqual({
      files: ["https://xn--mnchen-3ya.example.com:8080/path"],
    })
  })

  test("purges hosts and sends normalized host names", async () => {
    const { purge, requests } = setup([ZONE_ROUTE, purgeRoute()])

    const result = await invoke(
      purge,
      {
        zone: ZONE_ID,
        hosts: ["EXAMPLE.COM", "sub.example.com.", "MÜNCHEN.example.com"],
      },
      CTX,
    )

    expect(result.purged).toEqual({
      kind: "hosts",
      items: ["example.com", "sub.example.com", "xn--mnchen-3ya.example.com"],
    })
    const purgeRequest = requests.find((r) => r.path === PURGE_PATH)
    expect(purgeRequest?.body).toEqual({
      hosts: ["example.com", "sub.example.com", "xn--mnchen-3ya.example.com"],
    })
  })

  test("purges prefixes and sends prefixes with normalized host", async () => {
    const { purge, requests } = setup([ZONE_ROUTE, purgeRoute()])

    const result = await invoke(
      purge,
      {
        zone: ZONE_ID,
        prefixes: ["EXAMPLE.COM/static", "sub.example.com/assets/img.png"],
      },
      CTX,
    )

    expect(result.purged).toEqual({
      kind: "prefixes",
      items: ["example.com/static", "sub.example.com/assets/img.png"],
    })
    const purgeRequest = requests.find((r) => r.path === PURGE_PATH)
    expect(purgeRequest?.body).toEqual({
      prefixes: ["example.com/static", "sub.example.com/assets/img.png"],
    })
  })

  test("purges tags and sends tag list", async () => {
    const { purge, requests } = setup([ZONE_ROUTE, purgeRoute()])

    const result = await invoke(
      purge,
      {
        zone: ZONE_ID,
        tags: ["tag-1", "product-456"],
      },
      CTX,
    )

    expect(result.purged).toEqual({
      kind: "tags",
      items: ["tag-1", "product-456"],
    })
    const purgeRequest = requests.find((r) => r.path === PURGE_PATH)
    expect(purgeRequest?.body).toEqual({
      tags: ["tag-1", "product-456"],
    })
  })
})

describe("cloudflareZoneCachePurge: targets and metadata", () => {
  test("resolves target to <account_id>/zones/<zone_id>", async () => {
    const { purge } = setup([ZONE_ROUTE])

    const targets = await purge.targets!({ zone: ZONE_ID, hosts: ["example.com"] }, CTX)
    expect(targets).toEqual([`${ACCOUNT_ID}/zones/${ZONE_ID}`])
  })

  test("resolves target by zone name", async () => {
    const { purge } = setup([
      {
        method: "GET",
        path: "/zones",
        reply: ok([{ id: ZONE_ID, name: "example.com", account: { id: ACCOUNT_ID } }]),
      },
    ])

    const targets = await purge.targets!({ zone: "example.com", hosts: ["example.com"] }, CTX)
    expect(targets).toEqual([`${ACCOUNT_ID}/zones/${ZONE_ID}`])
  })

  test("returns * when zone is not found", async () => {
    const { purge } = setup([{ method: "GET", path: ZONE_PATH, reply: fail(404, [{ code: 7003, message: "No" }]) }])

    const targets = await purge.targets!({ zone: ZONE_ID, hosts: ["example.com"] }, CTX)
    expect(targets).toEqual(["*"])
  })

  test("has idempotent annotations and no toolMeta", () => {
    expect(annotations(cloudflareZoneCachePurge)).toEqual({
      title: "Purge Cloudflare zone cache",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    })
    expect(toolMeta(cloudflareZoneCachePurge)).toBeUndefined()
    expect(cloudflareZoneCachePurge.toolset).toBe("zones")
  })
})
