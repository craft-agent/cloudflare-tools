import { describe, expect, test } from "bun:test"
import { ZONE_ID, rejection } from "../cloudflare/client.fixtures"
import { fail, ok } from "../cloudflare/testing"
import { invoke } from "../tool"
import { CTX } from "../zone/fixtures"
import { SCRIPT, errorOf, refusalOf, scriptPath, toolFor } from "./fixtures"

describe("cloudflareWorkersRead: schedules", () => {
  test("reads cron triggers and their dates, with nulls for missing or odd fields", async () => {
    const { tool, requests } = toolFor({
      method: "GET",
      path: scriptPath("schedules"),
      reply: ok({
        schedules: [
          {
            cron: "0 * * * *",
            created_on: "2024-01-01T00:00:00Z",
            modified_on: "2024-02-01T00:00:00Z",
            extra: "discard",
          },
          { cron: "*/5 * * * *" },
          { cron: 5, created_on: false },
          null,
        ],
      }),
    })
    const result = await invoke(tool, { method: "schedules", script: ` ${SCRIPT} ` }, CTX)

    expect(result).toEqual({
      label: "default",
      script: SCRIPT,
      schedules: [
        { cron: "0 * * * *", created_on: "2024-01-01T00:00:00Z", modified_on: "2024-02-01T00:00:00Z" },
        { cron: "*/5 * * * *", created_on: null, modified_on: null },
        { cron: null, created_on: null, modified_on: null },
        { cron: null, created_on: null, modified_on: null },
      ],
    })
    expect(Object.fromEntries(requests[0]!.query)).toEqual({})
  })

  test("a missing or non-array schedules list is upstream_error", async () => {
    for (const result of [null, [], {}, { schedules: "odd" }]) {
      const { tool } = toolFor({ method: "GET", path: scriptPath("schedules"), reply: ok(result) })
      expect(errorOf(await rejection(invoke(tool, { method: "schedules", script: SCRIPT }, CTX))).code).toBe(
        "upstream_error",
      )
    }
  })
})

describe("cloudflareWorkersRead: secrets", () => {
  test("returns names and types only, never a secret's text or any other field", async () => {
    const secretText = "secret-value-must-never-appear"
    const { tool, requests } = toolFor({
      method: "GET",
      path: scriptPath("secrets"),
      reply: ok([
        { name: "API_KEY", type: "secret_text", text: secretText, value: secretText, extra: "discard" },
        { name: "CERT", type: "secret_key" },
        { name: 3, type: null },
        null,
      ]),
    })
    const result = await invoke(tool, { method: "secrets", script: ` ${SCRIPT} ` }, CTX)

    expect(result).toEqual({
      label: "default",
      script: SCRIPT,
      secrets: [
        { name: "API_KEY", type: "secret_text" },
        { name: "CERT", type: "secret_key" },
        { name: "", type: "" },
        { name: "", type: "" },
      ],
    })
    expect(JSON.stringify(result)).not.toContain(secretText)
    expect(Object.fromEntries(requests[0]!.query)).toEqual({})
  })

  test("a non-array result is upstream_error", async () => {
    for (const result of [null, {}, { secrets: [] }, "odd"]) {
      const { tool } = toolFor({ method: "GET", path: scriptPath("secrets"), reply: ok(result) })
      expect(errorOf(await rejection(invoke(tool, { method: "secrets", script: SCRIPT }, CTX))).code).toBe(
        "upstream_error",
      )
    }
  })
})

describe("cloudflareWorkersRead: trigger and secret errors", () => {
  for (const method of ["schedules", "secrets"] as const) {
    test(`${method}: requires a valid script before requesting`, async () => {
      const { tool, requests } = toolFor()
      expect(await refusalOf(invoke(tool, { method }, CTX))).toBe(`Method "${method}" requires \`script\`.`)
      expect(await refusalOf(invoke(tool, { method, script: "Invalid" }, CTX))).toContain("`script`")
      expect(requests).toHaveLength(0)
    })

    test(`${method}: refuses arguments of other methods`, async () => {
      const { tool, requests } = toolFor()
      for (const extra of [{ zone: ZONE_ID }, { hostname: "www.example.com" }, { page: 1 }, { per_page: 10 }]) {
        expect(await refusalOf(invoke(tool, { method, script: SCRIPT, ...extra }, CTX))).toContain(method)
      }
      expect(requests).toHaveLength(0)
    })

    test(`${method}: a missing Worker is not_found, pointing at list`, async () => {
      const { tool } = toolFor({
        method: "GET",
        path: scriptPath(method),
        reply: fail(404, [{ code: 10007, message: "This Worker does not exist." }]),
      })
      const error = errorOf(await rejection(invoke(tool, { method, script: SCRIPT }, CTX)))

      expect(error.code).toBe("not_found")
      expect(error.message).toContain("cloudflare_workers_read list shows its Workers.")
    })
  }
})
