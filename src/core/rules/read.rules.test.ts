import { expect, test } from "bun:test"
import { ZONE_ID, rejection } from "../cloudflare/client.fixtures"
import { fail, ok } from "../cloudflare/testing"
import { invoke } from "../tool"
import {
  CACHE_RULE,
  CTX,
  REDIRECT_RULE,
  RULESET_ID,
  SHAPED_REDIRECT_RULE,
  entrypointPath,
  entrypointRoute,
  errorOf,
  rulesetOf,
  toolFor,
} from "./fixtures"

test("rules: shapes the rules in Cloudflare's order with positions", async () => {
  const { tool, requests } = toolFor(
    entrypointRoute("http_request_dynamic_redirect", rulesetOf([REDIRECT_RULE, CACHE_RULE])),
  )

  const result = await invoke(tool, { method: "rules", zone: ZONE_ID, phase: "http_request_dynamic_redirect" }, CTX)

  expect(result).toEqual({
    label: "default",
    zone: { id: ZONE_ID, name: "example.com" },
    phase: "http_request_dynamic_redirect",
    product: "Single Redirects",
    writable: true,
    ruleset: { id: RULESET_ID, version: "3", last_updated: "2025-01-02T03:04:05.678Z" },
    rules: [
      SHAPED_REDIRECT_RULE,
      {
        position: 2,
        id: CACHE_RULE.id,
        ref: "ref-cache",
        description: "Cache images",
        expression: CACHE_RULE.expression,
        action: "set_cache_settings",
        action_parameters: CACHE_RULE.action_parameters,
        enabled: false,
        version: "2",
        last_updated: "2025-02-01T00:00:00Z",
      },
    ],
  })
  expect(requests.map((request) => request.path)).toEqual([
    `/zones/${ZONE_ID}`,
    entrypointPath("http_request_dynamic_redirect"),
  ])
})

test("rules: a phase without an entry point has no ruleset and no rules", async () => {
  const { tool } = toolFor(
    entrypointRoute("http_request_origin", fail(404, [{ code: 10003, message: "Could not find entrypoint" }])),
  )

  const result = await invoke(tool, { method: "rules", zone: ZONE_ID, phase: "http_request_origin" }, CTX)

  expect(result).toMatchObject({ phase: "http_request_origin", product: "Origin Rules", ruleset: null, rules: [] })
})

test("rules: forbidden names the permission the phase needs", async () => {
  const { tool } = toolFor(
    entrypointRoute("http_request_transform", fail(403, [{ code: 10000, message: "Authentication error" }])),
  )

  const err = errorOf(
    await rejection(invoke(tool, { method: "rules", zone: ZONE_ID, phase: "http_request_transform" }, CTX)),
  )
  expect(err.code).toBe("forbidden")
  expect(err.message).toBe("10000: Authentication error. The token needs Zone → Zone Transform Rules → Read.")
})

test("rules: tolerates unknown fields and rows that do not parse", async () => {
  const { tool } = toolFor(
    entrypointRoute(
      "http_config_settings",
      rulesetOf(
        [
          null,
          { ...REDIRECT_RULE, brand_new_field: { nested: true } },
          { id: 5, expression: 7, enabled: "yes", action_parameters: "x" },
        ],
        { surprise: 1 },
      ),
    ),
  )

  const result = await invoke(tool, { method: "rules", zone: ZONE_ID, phase: "http_config_settings" }, CTX)

  expect(result.rules).toEqual([
    { ...SHAPED_REDIRECT_RULE, position: 2 },
    {
      position: 3,
      id: "",
      ref: null,
      description: null,
      expression: null,
      action: null,
      action_parameters: null,
      enabled: null,
      version: null,
      last_updated: null,
    },
  ])
  expect(JSON.stringify(result)).not.toContain("brand_new_field")
})

test("rules: keeps the ratelimit and logging settings of a rule that has them", async () => {
  const ratelimit = { characteristics: ["ip.src"], period: 60, requests_per_period: 100 }
  const { tool } = toolFor(
    entrypointRoute(
      "http_ratelimit",
      rulesetOf([
        { id: "q1".repeat(16), action: "block", expression: "true", ratelimit, logging: { enabled: true } },
        { id: "q2".repeat(16), action: "block", ratelimit: "bad" },
      ]),
    ),
  )

  const result = await invoke(tool, { method: "rules", zone: ZONE_ID, phase: "http_ratelimit" }, CTX)

  expect(result.writable).toBe(false)
  expect(result.rules?.[0]).toMatchObject({ ratelimit, logging: { enabled: true } })
  expect(result.rules?.[1]).not.toHaveProperty("ratelimit")
  expect(result.rules?.[1]).not.toHaveProperty("logging")
})

test("rules: upstream_error when the ruleset is not an object", async () => {
  for (const reply of [ok(null), ok("bad"), ok([])]) {
    const { tool } = toolFor(entrypointRoute("http_custom_errors", reply))
    const err = errorOf(
      await rejection(invoke(tool, { method: "rules", zone: ZONE_ID, phase: "http_custom_errors" }, CTX)),
    )
    expect(err.code).toBe("upstream_error")
    expect(err.message).toBe("Cloudflare returned an unexpected ruleset response.")
  }
})
