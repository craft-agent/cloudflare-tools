import { expect, test } from "bun:test"
import { rejection } from "../cloudflare/client.fixtures"
import { fail, ok } from "../cloudflare/testing"
import { invoke } from "../tool"
import { CTX, DEPLOYMENT_ID, DEPLOYMENT_LOGS_PATH, LOG_ENTRY, PROJECT, errorOf, refusalOf, toolFor } from "./fixtures"
import { clipLine, shapeLogEntry } from "./shape"

test("logs requests deployment logs path with trimmed and lowercased deployment id", async () => {
  const upperDeploymentId = DEPLOYMENT_ID.toUpperCase()
  const { tool, requests } = toolFor({
    method: "GET",
    path: DEPLOYMENT_LOGS_PATH,
    reply: ok({ total: 1, includes_container_logs: true, data: [LOG_ENTRY] }),
  })
  const result = await invoke(
    tool,
    { method: "logs", project: ` ${PROJECT} `, deployment: ` ${upperDeploymentId} ` },
    CTX,
  )
  expect(result).toEqual({
    label: "default",
    project: PROJECT,
    deployment: DEPLOYMENT_ID,
    lines: [shapeLogEntry(LOG_ENTRY)!],
    total: 1,
    omitted: 0,
    includes_container_logs: true,
  })
  expect(requests[0].path).toBe(DEPLOYMENT_LOGS_PATH)
  expect(Object.fromEntries(requests[0].query)).toEqual({})
})

test("tail selection keeps the last lines and computes omitted, defaulting to 100", async () => {
  const sevenLines = Array.from({ length: 7 }, (_, i) => ({
    ts: `2024-01-01T00:00:0${i}Z`,
    line: `line ${i + 1}`,
  }))
  const { tool } = toolFor({
    method: "GET",
    path: DEPLOYMENT_LOGS_PATH,
    reply: ok({ total: 7, includes_container_logs: false, data: sevenLines }),
  })

  const withLines3 = await invoke(tool, { method: "logs", project: PROJECT, deployment: DEPLOYMENT_ID, lines: 3 }, CTX)
  expect(withLines3.lines?.map((item) => item.line)).toEqual(["line 5", "line 6", "line 7"])
  expect(withLines3.omitted).toBe(4)
  expect(withLines3.total).toBe(7)
  expect(withLines3.includes_container_logs).toBe(false)

  const defaultLines = await invoke(tool, { method: "logs", project: PROJECT, deployment: DEPLOYMENT_ID }, CTX)
  expect(defaultLines.lines?.length).toBe(7)
  expect(defaultLines.omitted).toBe(0)
  expect(defaultLines.total).toBe(7)
})

test("clips a 600-character line to 500 characters and an ellipsis", async () => {
  const longLine = "a".repeat(600)
  const { tool } = toolFor({
    method: "GET",
    path: DEPLOYMENT_LOGS_PATH,
    reply: ok({ data: [{ ts: "2024-01-01T00:00:00Z", line: longLine }] }),
  })
  const result = await invoke(tool, { method: "logs", project: PROJECT, deployment: DEPLOYMENT_ID }, CTX)
  expect(result.lines?.[0]?.line).toBe(clipLine(longLine))
  expect(result.lines?.[0]?.line.length).toBe(501)
  expect(result.lines?.[0]?.line.endsWith("…")).toBe(true)
})

test("falls back to data.length when Cloudflare's total is missing or not a number", async () => {
  for (const total of [undefined, null, "10", {}]) {
    const { tool } = toolFor({
      method: "GET",
      path: DEPLOYMENT_LOGS_PATH,
      reply: ok({ total, data: [LOG_ENTRY, LOG_ENTRY] }),
    })
    const result = await invoke(tool, { method: "logs", project: PROJECT, deployment: DEPLOYMENT_ID }, CTX)
    expect(result.total).toBe(2)
  }
})

test("skips entries in data that are not objects", async () => {
  const { tool } = toolFor({
    method: "GET",
    path: DEPLOYMENT_LOGS_PATH,
    reply: ok({ data: [null, "bad", 123, LOG_ENTRY, undefined] }),
  })
  const result = await invoke(tool, { method: "logs", project: PROJECT, deployment: DEPLOYMENT_ID }, CTX)
  expect(result.lines).toEqual([shapeLogEntry(LOG_ENTRY)!])
  expect(result.total).toBe(5)
})

test("missing deployment points at cloudflare_pages_read deployments", async () => {
  const { tool } = toolFor({
    method: "GET",
    path: DEPLOYMENT_LOGS_PATH,
    reply: fail(404, [{ code: 8000000, message: "Deployment not found" }]),
  })
  const error = errorOf(
    await rejection(invoke(tool, { method: "logs", project: PROJECT, deployment: DEPLOYMENT_ID }, CTX)),
  )
  expect(error.code).toBe("not_found")
  expect(error.message).toBe(
    `No deployment ${DEPLOYMENT_ID} in Pages project ${PROJECT} of the account default; cloudflare_pages_read deployments lists them.`,
  )
})

test("refuses bad deployment ids including short id", async () => {
  const { tool } = toolFor()
  for (const id of ["11111111", "not-a-uuid", "11111111-1111-4111-8111-11111111111g", ""]) {
    expect(await refusalOf(invoke(tool, { method: "logs", project: PROJECT, deployment: id }, CTX))).toBe(
      "`deployment` must be a deployment's id (a UUID), as cloudflare_pages_read deployments shows it; not its short_id.",
    )
  }
})

test("requires project and deployment on logs", async () => {
  const { tool } = toolFor()
  expect(await refusalOf(invoke(tool, { method: "logs" }, CTX))).toContain('Method "logs" requires `project`.')
  expect(await refusalOf(invoke(tool, { method: "logs", project: PROJECT }, CTX))).toContain(
    'Method "logs" requires `deployment`.',
  )
})

test("refuses deployment on list", async () => {
  const { tool } = toolFor()
  expect(await refusalOf(invoke(tool, { method: "list", deployment: DEPLOYMENT_ID }, CTX))).toContain("deployment")
})

test("refuses malformed or non-array data responses as upstream_error", async () => {
  for (const result of [null, "bad", [], { data: null }, { data: {} }, { data: "string" }]) {
    const { tool } = toolFor({
      method: "GET",
      path: DEPLOYMENT_LOGS_PATH,
      reply: ok(result),
    })
    const error = errorOf(
      await rejection(invoke(tool, { method: "logs", project: PROJECT, deployment: DEPLOYMENT_ID }, CTX)),
    )
    expect(error.code).toBe("upstream_error")
  }
})
