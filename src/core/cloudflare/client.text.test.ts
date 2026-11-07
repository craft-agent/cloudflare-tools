import { describe, expect, test } from "bun:test"
import {
  OTHER_TOKEN,
  USER_TOKEN,
  VERIFY_USER_PATH,
  ZONE_ID,
  clientFor,
  toolError,
  verifyRoute,
} from "./client.fixtures"
import { MASK } from "./mask"
import { ROUTES } from "./routes"
import { fail, ok, type FakeReply } from "./testing"

const EXPORT_PATH = `/zones/${ZONE_ID}/dns_records/export`
const ZONE_FILE = "; example.com\n$ORIGIN example.com.\nwww.example.com.\t1\tIN\tA\t192.0.2.1\n"

function clientAnswering(reply: FakeReply, extra: Parameters<typeof clientFor>[0] = []) {
  return clientFor([{ method: "GET", path: EXPORT_PATH, reply }, ...extra])
}

function exportOf(client: ReturnType<typeof clientFor>["client"]) {
  return client.requestText(ROUTES.dnsRecordsExport, { path: { zone_id: ZONE_ID } })
}

describe("CloudflareClient.requestText", () => {
  test("returns the text of a 200 text body as it is", async () => {
    const { client, requests } = clientAnswering({ status: 200, body: ZONE_FILE })

    expect(await exportOf(client)).toBe(ZONE_FILE)
    expect(requests).toHaveLength(1)
    expect(requests[0]!.path).toBe(EXPORT_PATH)
  })

  test("sends the token and asks for text or JSON", async () => {
    const { client, requests } = clientAnswering({ status: 200, body: ZONE_FILE })
    await exportOf(client)

    expect(requests[0]!.headers).toEqual({
      authorization: `Bearer ${USER_TOKEN}`,
      accept: "text/plain, application/json",
    })
  })

  test("masks a token-shaped string inside the text", async () => {
    const { client } = clientAnswering({ status: 200, body: `; ${USER_TOKEN}\ntxt TXT "Bearer ${OTHER_TOKEN}"\n` })
    const text = await exportOf(client)

    expect(text).toBe(`; ${MASK}\ntxt TXT "Bearer ${MASK}"\n`)
    expect(text).not.toContain(USER_TOKEN)
  })

  test("a 200 JSON envelope with success false fails like request", async () => {
    const { client } = clientAnswering({
      status: 200,
      body: { success: false, errors: [{ code: 5, message: "nope" }], result: null },
    })
    const error = await toolError(exportOf(client))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toContain("200")
    expect(error.message).toContain("5: nope")
  })

  test("a 200 JSON envelope with success true is returned as its text", async () => {
    const { client } = clientAnswering(ok([]))

    expect(JSON.parse(await exportOf(client))).toMatchObject({ success: true })
  })

  test("a 404 envelope is not_found", async () => {
    const { client } = clientAnswering(fail(404, [{ code: 7003, message: "No route for that URI" }]))
    const error = await toolError(exportOf(client))

    expect(error.code).toBe("not_found")
    expect(error.message).toBe("7003: No route for that URI")
  })

  test("a failure whose body is not a JSON object is upstream_error", async () => {
    const { client } = clientAnswering({ status: 502, body: "<html>Bad gateway</html>" })
    const error = await toolError(exportOf(client))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toContain("502")
  })

  test("a redirect is refused and not followed", async () => {
    const { client, requests } = clientAnswering({ status: 302, headers: { Location: "https://evil.example/x" } })
    const error = await toolError(exportOf(client))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toContain("redirect")
    expect(requests).toHaveLength(1)
  })

  test("a 403 checks the token like request", async () => {
    const { client, requests } = clientAnswering(fail(403, [{ code: 9109, message: "Unauthorized" }]), [
      verifyRoute(VERIFY_USER_PATH, "active"),
    ])
    const error = await toolError(exportOf(client))

    expect(error.code).toBe("forbidden")
    expect(error.message).toContain("lacks a permission")
    expect(requests.map((request) => request.path)).toEqual([EXPORT_PATH, VERIFY_USER_PATH])
  })

  test("refuses a route that is not in the allowlist", async () => {
    const { client, requests } = clientFor([])
    const error = await toolError(client.requestText({ method: "DELETE", path: "/accounts/{account_id}" }))

    expect(error.code).toBe("internal_error")
    expect(requests).toEqual([])
  })
})
