import { describe, expect, test } from "bun:test"
import { USER_TOKEN, ZONE_ID, envFor, rejection } from "../cloudflare/client.fixtures"
import { MASK } from "../cloudflare/mask"
import { fail, fakeCloudflare, ok, type FakeRoute } from "../cloudflare/testing"
import { isToolError } from "../errors"
import { invoke } from "../tool"
import { CTX, OTHER_ACCOUNT_ID, SAMPLE_ZONE, ZONE_NAME, ZONE_PATH, ZONE_ROUTE } from "../zone/fixtures"
import { A_RECORD, A_RECORD_ID, EXPORT_PATH, RECORDS_PATH, recordPath, ZONE_FILE } from "./fixtures"
import { defineDnsRead } from "./read"

function toolFor(...routes: FakeRoute[]) {
  const { fetch, requests } = fakeCloudflare([ZONE_ROUTE, ...routes])
  return { tool: defineDnsRead({ fetch, env: envFor() }), requests }
}

function errorCode(error: unknown): string | undefined {
  return isToolError(error) ? error.code : undefined
}

describe("cloudflareDnsRead: view", () => {
  test("reads one record by id and returns it as Cloudflare sent it", async () => {
    const { tool, requests } = toolFor({
      method: "GET",
      path: recordPath(A_RECORD_ID),
      reply: ok(A_RECORD),
    })
    const result = await invoke(tool, { method: "view", zone: ZONE_ID, id: A_RECORD_ID }, CTX)

    expect(result).toEqual({ label: "default", zone: { id: ZONE_ID, name: ZONE_NAME }, record: A_RECORD })
    expect(requests.map((request) => request.path)).toEqual([ZONE_PATH, recordPath(A_RECORD_ID)])
  })

  test("lowercases the id in the path", async () => {
    const { tool, requests } = toolFor({
      method: "GET",
      path: recordPath(A_RECORD_ID),
      reply: ok(A_RECORD),
    })
    await invoke(tool, { method: "view", zone: ZONE_ID, id: A_RECORD_ID.toUpperCase() }, CTX)

    expect(requests.at(-1)!.path).toBe(recordPath(A_RECORD_ID))
  })

  test("a record that does not exist is not_found", async () => {
    const { tool } = toolFor({
      method: "GET",
      path: recordPath(A_RECORD_ID),
      reply: fail(404, [{ code: 81044, message: "Record does not exist." }]),
    })
    const error = await rejection(invoke(tool, { method: "view", zone: ZONE_ID, id: A_RECORD_ID }, CTX))

    expect(errorCode(error)).toBe("not_found")
  })

  test("a result that is not an object is upstream_error", async () => {
    const { tool } = toolFor({ method: "GET", path: recordPath(A_RECORD_ID), reply: ok([A_RECORD]) })
    const error = await rejection(invoke(tool, { method: "view", zone: ZONE_ID, id: A_RECORD_ID }, CTX))

    expect(errorCode(error)).toBe("upstream_error")
  })
})

describe("cloudflareDnsRead: export", () => {
  test("returns the zone file text and counts its records, without the SOA and the apex NS", async () => {
    const { tool, requests } = toolFor({ method: "GET", path: EXPORT_PATH, reply: { status: 200, body: ZONE_FILE } })
    const result = await invoke(tool, { method: "export", zone: ZONE_ID }, CTX)

    expect(result).toEqual({
      label: "default",
      zone: { id: ZONE_ID, name: ZONE_NAME },
      zone_file: ZONE_FILE,
      record_count: 4,
    })
    expect(requests.at(-1)!.headers.accept).toBe("text/plain, application/json")
  })

  test("an empty zone file has no records", async () => {
    const { tool } = toolFor({ method: "GET", path: EXPORT_PATH, reply: { status: 200, body: "" } })
    const result = await invoke(tool, { method: "export", zone: ZONE_ID }, CTX)

    expect(result).toMatchObject({ zone_file: "", record_count: 0 })
  })

  test("masks a token in the zone file", async () => {
    const { tool } = toolFor({
      method: "GET",
      path: EXPORT_PATH,
      reply: { status: 200, body: `x TXT "${USER_TOKEN}"\n` },
    })
    const result = await invoke(tool, { method: "export", zone: ZONE_ID }, CTX)

    expect(result.zone_file).toBe(`x TXT "${MASK}"\n`)
  })

  test("maps a failure to its error code", async () => {
    const cases: Array<[number, string]> = [
      [404, "not_found"],
      [429, "rate_limited"],
      [500, "upstream_error"],
    ]
    for (const [status, code] of cases) {
      const { tool } = toolFor({ method: "GET", path: EXPORT_PATH, reply: fail(status, [{ code: 1, message: "no" }]) })
      const error = await rejection(invoke(tool, { method: "export", zone: ZONE_ID }, CTX))

      expect(errorCode(error)).toBe(code)
    }
  })

  test("a 200 envelope that reports failure is upstream_error", async () => {
    const { tool } = toolFor({
      method: "GET",
      path: EXPORT_PATH,
      reply: { status: 200, body: { success: false, errors: [{ code: 5, message: "nope" }] } },
    })
    const error = await rejection(invoke(tool, { method: "export", zone: ZONE_ID }, CTX))

    expect(errorCode(error)).toBe("upstream_error")
  })
})

describe("cloudflareDnsRead: account boundary", () => {
  test("refuses a zone of another account before any record is read", async () => {
    const { fetch, requests } = fakeCloudflare([
      { method: "GET", path: ZONE_PATH, reply: ok({ ...SAMPLE_ZONE, account: { id: OTHER_ACCOUNT_ID } }) },
      { method: "GET", path: RECORDS_PATH, reply: ok([A_RECORD]) },
      { method: "GET", path: recordPath(A_RECORD_ID), reply: ok(A_RECORD) },
      { method: "GET", path: EXPORT_PATH, reply: { status: 200, body: ZONE_FILE } },
    ])
    const tool = defineDnsRead({ fetch, env: envFor() })

    for (const args of [
      { method: "list", zone: ZONE_ID },
      { method: "view", zone: ZONE_ID, id: A_RECORD_ID },
      { method: "export", zone: ZONE_ID },
    ] as const) {
      const error = await rejection(invoke(tool, args, CTX))
      expect(errorCode(error)).toBe("not_found")
    }
    expect(requests.map((request) => request.path)).toEqual([ZONE_PATH, ZONE_PATH, ZONE_PATH])
  })
})
