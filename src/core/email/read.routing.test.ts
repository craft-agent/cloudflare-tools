import { expect, test } from "bun:test"
import { ZONE_ID, rejection } from "../cloudflare/client.fixtures"
import { fail, ok } from "../cloudflare/testing"
import { invoke } from "../tool"
import {
  CATCH_ALL_PATH,
  CATCH_ALL_RULE,
  CTX,
  OTHER_RULE_ID,
  ROUTING_PATH,
  ZONE_NAME,
  errorOf,
  toolFor,
} from "./fixtures"

const SETTINGS = {
  id: "d4".repeat(16),
  name: ZONE_NAME,
  tag: "tag-value",
  enabled: true,
  status: "ready",
  support_subaddress: true,
  admin_locked: true,
  synced: true,
  skip_wizard: false,
  created: "2024-01-01T00:00:00Z",
  modified: "2024-02-01T00:00:00Z",
}

const ARGS = { method: "routing", zone: ZONE_ID }

test("routing: reads the settings and the catch-all and drops everything else", async () => {
  const { tool, requests } = toolFor(
    { method: "GET", path: ROUTING_PATH, reply: ok(SETTINGS) },
    { method: "GET", path: CATCH_ALL_PATH, reply: ok(CATCH_ALL_RULE) },
  )

  const result = await invoke(tool, ARGS, CTX)

  expect(result).toEqual({
    label: "default",
    zone: { id: ZONE_ID, name: ZONE_NAME },
    routing: { enabled: true, status: "ready", support_subaddress: true },
    catch_all: {
      id: OTHER_RULE_ID,
      name: "Catch-all",
      enabled: true,
      priority: 2147483647,
      to: null,
      action: { type: "drop" },
      managed_by: "api",
    },
  })
  const json = JSON.stringify(result)
  for (const dropped of ["admin_locked", "synced", "skip_wizard", "tag-value", SETTINGS.id, "modified"]) {
    expect(json).not.toContain(dropped)
  }
  expect(requests.map((request) => request.path)).toEqual(expect.arrayContaining([ROUTING_PATH, CATCH_ALL_PATH]))
})

test("routing: off settings give false, null and null when Cloudflare sends nothing", async () => {
  const { tool } = toolFor(
    { method: "GET", path: ROUTING_PATH, reply: ok({ name: ZONE_NAME }) },
    { method: "GET", path: CATCH_ALL_PATH, reply: ok(null) },
  )

  const result = await invoke(tool, ARGS, CTX)

  expect(result.routing).toEqual({ enabled: false, status: null, support_subaddress: null })
  expect(result.catch_all).toBeNull()
})

test("routing: a catch-all that is not found gives null", async () => {
  const { tool } = toolFor(
    { method: "GET", path: ROUTING_PATH, reply: ok(SETTINGS) },
    { method: "GET", path: CATCH_ALL_PATH, reply: fail(404, [{ code: 1000, message: "No catch-all" }]) },
  )

  const result = await invoke(tool, ARGS, CTX)

  expect(result.catch_all).toBeNull()
  expect(result.routing?.enabled).toBe(true)
})

test("routing: any other catch-all failure fails the call", async () => {
  const { tool } = toolFor(
    { method: "GET", path: ROUTING_PATH, reply: ok(SETTINGS) },
    { method: "GET", path: CATCH_ALL_PATH, reply: fail(500, [{ code: 1000, message: "Broken" }]) },
  )

  const err = errorOf(await rejection(invoke(tool, ARGS, CTX)))

  expect(err.code).toBe("upstream_error")
})

test("routing: a zone Cloudflare does not know is refused before the settings are read", async () => {
  const { tool, requests } = toolFor()

  const err = errorOf(await rejection(invoke(tool, { method: "routing", zone: "3".repeat(32) }, CTX)))

  expect(err.code).toBe("not_found")
  expect(requests.some((request) => request.path === ROUTING_PATH)).toBe(false)
})
