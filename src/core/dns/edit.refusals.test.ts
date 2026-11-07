import { describe, expect, test } from "bun:test"
import { toolError, ZONE_ID } from "../cloudflare/client.fixtures"
import { ok } from "../cloudflare/testing"
import { invoke } from "../tool"
import { OTHER_ACCOUNT_ID, SAMPLE_ZONE } from "../zone/fixtures"
import {
  CTX,
  HTTPS_RECORD,
  pathsOf,
  PLAIN_A_RECORD,
  PRODUCT_RECORD,
  setup,
  setupWith,
  WORKER_RECORD,
  ZONE_PATH,
} from "./edit.fixtures"
import { A_RECORD, A_RECORD_ID, batchRequests, batchRoute, recordPath, recordRoute } from "./fixtures"

type Changes = Parameters<ReturnType<typeof setup>["tool"]["execute"]>[0]["changes"]

/** The refusal `changes` earns against the records, with the requests the tool sent. */
async function refusal(records: { id: string }[], changes: Changes) {
  const { tool, requests } = setupWith(records)
  const error = await toolError(invoke(tool, { zone: ZONE_ID, changes }, CTX))
  expect(batchRequests(requests)).toEqual([])
  return { error, requests }
}

describe("cloudflareDnsRecordEdit: refusals before anything is sent", () => {
  test("a type that differs is refused, pointing at delete with a replacement", async () => {
    const { error } = await refusal([A_RECORD], [{ id: A_RECORD_ID, type: "CNAME", content: "a.example.org" }])

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toStartWith("changes[0] (A www): a record's type cannot change in place")
    expect(error.message).toContain("cloudflare_dns_record_delete")
  })

  test("a record another Cloudflare product manages is refused", async () => {
    const { error } = await refusal([PRODUCT_RECORD], [{ id: PRODUCT_RECORD.id, ttl: 600 }])

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toBe("changes[0] (A x): is managed by another Cloudflare product and is changed there.")
  })

  test("a Worker's custom domain is named as such", async () => {
    const { error } = await refusal([WORKER_RECORD], [{ id: WORKER_RECORD.id, ttl: 600 }])

    expect(error.message).toContain("(a Worker's custom domain)")
    expect(error.message).toContain("changed there")
  })

  test("a type the tools do not write is refused", async () => {
    const { error } = await refusal([HTTPS_RECORD], [{ id: HTTPS_RECORD.id, ttl: 600 }])

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toStartWith("changes[0] (HTTPS www): a HTTPS record can be read and deleted")
    expect(error.message).toContain("not changed")
  })

  test("a change that gives the record's own values changes nothing and is refused", async () => {
    const { error } = await refusal(
      [PLAIN_A_RECORD],
      [{ id: PLAIN_A_RECORD.id, type: "A", name: "API.example.com.", content: "192.0.2.7", ttl: 300, proxied: false }],
    )

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toBe("changes[0] (A api): changes nothing: the record already has these values.")
  })

  test("removing a comment the record does not have changes nothing", async () => {
    const { error } = await refusal([PLAIN_A_RECORD], [{ id: PLAIN_A_RECORD.id, comment: "" }])

    expect(error.message).toContain("changes nothing")
  })

  test("a value that breaks an add rule is refused with that rule's message, naming the position", async () => {
    const { error } = await refusal(
      [A_RECORD, PLAIN_A_RECORD],
      [
        { id: A_RECORD_ID, comment: "ok" },
        { id: PLAIN_A_RECORD.id, content: "not-an-ip" },
      ],
    )

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toStartWith('changes[1] (A api): content "not-an-ip" is not an IPv4 address')
  })

  test("a field the record's type does not take is refused", async () => {
    const { error } = await refusal([PLAIN_A_RECORD], [{ id: PLAIN_A_RECORD.id, priority: 10 }])

    expect(error.message).toStartWith("changes[0] (A api): takes no `priority`")
  })
})

describe("cloudflareDnsRecordEdit: refusals before any record is read", () => {
  test("a change with nothing but its id and type is refused", async () => {
    const { tool, requests } = setupWith([A_RECORD])

    const error = await toolError(
      invoke(
        tool,
        {
          zone: ZONE_ID,
          changes: [
            { id: A_RECORD_ID, comment: "x" },
            { id: PLAIN_A_RECORD.id, type: "A" },
          ],
        },
        CTX,
      ),
    )

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toStartWith("changes[1]: changes nothing")
    expect(requests).toEqual([])
  })

  test("the same id twice is refused, whatever its case", async () => {
    const { tool, requests } = setupWith([A_RECORD])

    const error = await toolError(
      invoke(
        tool,
        {
          zone: ZONE_ID,
          changes: [
            { id: A_RECORD_ID, comment: "x" },
            { id: A_RECORD_ID.toUpperCase(), ttl: 600 },
          ],
        },
        CTX,
      ),
    )

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toStartWith("changes[1] repeats changes[0]")
    expect(requests).toEqual([])
  })
})

describe("cloudflareDnsRecordEdit: records that cannot be read", () => {
  test("a record that is not in the zone is not_found, naming its position and where to look", async () => {
    const { tool, requests } = setup(recordRoute(A_RECORD), batchRoute())
    const missing = "9".repeat(32)

    const error = await toolError(
      invoke(
        tool,
        {
          zone: ZONE_ID,
          changes: [
            { id: A_RECORD_ID, comment: "x" },
            { id: missing, ttl: 600 },
          ],
        },
        CTX,
      ),
    )

    expect(error.code).toBe("not_found")
    expect(error.message).toBe(
      `changes[1]: no record ${missing} in the zone example.com; cloudflare_dns_read list shows its records.`,
    )
    expect(batchRequests(requests)).toEqual([])
    expect(pathsOf(requests)).toContain(recordPath(missing))
  })

  test("a reply that is not an object is an upstream_error", async () => {
    const { tool, requests } = setup(
      { method: "GET", path: recordPath(A_RECORD_ID), reply: ok([A_RECORD]) },
      batchRoute(),
    )

    const error = await toolError(invoke(tool, { zone: ZONE_ID, changes: [{ id: A_RECORD_ID, ttl: 600 }] }, CTX))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toStartWith("changes[0]: ")
    expect(batchRequests(requests)).toEqual([])
  })

  test("a zone of another account is refused before a record is read", async () => {
    const { tool, requests } = setup(
      { method: "GET", path: ZONE_PATH, reply: ok({ ...SAMPLE_ZONE, account: { id: OTHER_ACCOUNT_ID } }) },
      recordRoute(A_RECORD),
      batchRoute(),
    )

    const error = await toolError(invoke(tool, { zone: ZONE_ID, changes: [{ id: A_RECORD_ID, comment: "x" }] }, CTX))

    expect(error.code).toBe("not_found")
    expect(pathsOf(requests)).toEqual([ZONE_PATH])
  })
})
