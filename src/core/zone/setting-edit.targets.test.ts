import { describe, expect, test } from "bun:test"
import { ACCOUNT_ID, rejection, ZONE_ID } from "../cloudflare/client.fixtures"
import { fail, ok } from "../cloudflare/testing"
import { isAbortError } from "../errors"
import { writeTargets } from "../targets"
import { CTX, setup, ZONE_PATH, ZONE_ROUTE } from "./setting-edit.fixtures"

const CHANGES = [
  { setting: "ssl" as const, value: "full" },
  { setting: "http3" as const, value: "on" },
]
const SSL_TARGET = `${ACCOUNT_ID}/zones/${ZONE_ID}/settings/ssl`
const HTTP3_TARGET = `${ACCOUNT_ID}/zones/${ZONE_ID}/settings/http3`

describe("zone setting tools: targets", () => {
  test("name each setting of the zone by account id and zone id", async () => {
    const { edit, weaken, requests } = setup([ZONE_ROUTE])

    for (const tool of [edit, weaken]) {
      expect(await tool.targets!({ zone: ZONE_ID, changes: CHANGES }, CTX)).toEqual([SSL_TARGET, HTTP3_TARGET])
    }
    expect(requests.map((request) => request.path)).toEqual([ZONE_PATH, ZONE_PATH])
  })

  test("reach a permission rule sorted, through writeTargets", async () => {
    const { edit } = setup([ZONE_ROUTE])

    expect(await writeTargets(edit, { zone: ZONE_ID, changes: CHANGES }, CTX)).toEqual([HTTP3_TARGET, SSL_TARGET])
  })

  test("look a domain up, so the target carries the id", async () => {
    const { edit, requests } = setup([
      { method: "GET", path: "/zones", reply: ok([{ id: ZONE_ID, name: "example.com", account: { id: ACCOUNT_ID } }]) },
    ])

    const targets = await edit.targets!({ zone: "Example.com", changes: CHANGES }, CTX)

    expect(targets).toEqual([SSL_TARGET, HTTP3_TARGET])
    expect(requests.map((request) => request.path)).toEqual(["/zones"])
  })

  test("are `*` when the zone cannot be found", async () => {
    const { edit } = setup([{ method: "GET", path: ZONE_PATH, reply: fail(404, [{ code: 7003, message: "No" }]) }])

    expect(await edit.targets!({ zone: ZONE_ID, changes: CHANGES }, CTX)).toEqual(["*"])
  })

  test("are `*` when the zone belongs to another account", async () => {
    const { weaken } = setup([
      {
        method: "GET",
        path: ZONE_PATH,
        reply: ok({ id: ZONE_ID, name: "example.com", account: { id: "1".repeat(32) } }),
      },
    ])

    expect(await weaken.targets!({ zone: ZONE_ID, changes: CHANGES }, CTX)).toEqual(["*"])
  })

  test("are `*` when the account has no credential", async () => {
    const { edit } = setup([ZONE_ROUTE])

    expect(await edit.targets!({ zone: ZONE_ID, account: "nobody", changes: CHANGES }, CTX)).toEqual(["*"])
  })

  test("pass a cancellation on instead of turning it into `*`", async () => {
    const controller = new AbortController()
    controller.abort()
    const { edit } = setup([ZONE_ROUTE])

    const error = await rejection(
      writeTargets(edit, { zone: ZONE_ID, changes: CHANGES }, { ...CTX, signal: controller.signal }),
    )

    expect(isAbortError(error)).toBe(true)
  })
})
