import { expect, test } from "bun:test"
import { ZONE_ID, rejection } from "../cloudflare/client.fixtures"
import { fail } from "../cloudflare/testing"
import { invoke } from "../tool"
import { CACHE_RULE, CTX, REDIRECT_RULE, RULESET_ID, entrypointRoute, errorOf, rulesetOf, toolFor } from "./fixtures"
import { PHASES } from "./phases"

const NOT_FOUND = fail(404, [{ code: 10003, message: "Could not find entrypoint ruleset" }])
const FORBIDDEN = fail(403, [{ code: 10000, message: "Authentication error" }])

test("phases: lists every phase with its entry point, rule count, or the reason it could not be read", async () => {
  const { tool, requests } = toolFor(
    entrypointRoute("http_request_dynamic_redirect", rulesetOf([REDIRECT_RULE, CACHE_RULE])),
    entrypointRoute("http_request_cache_settings", NOT_FOUND),
    entrypointRoute("http_ratelimit", FORBIDDEN),
  )

  const result = await invoke(tool, { method: "phases", zone: ZONE_ID }, CTX)

  expect(result.label).toBe("default")
  expect(result.zone?.id).toBe(ZONE_ID)
  expect(result.phases?.map((item) => item.phase)).toEqual(PHASES.map((entry) => entry.phase))
  const byPhase = Object.fromEntries((result.phases ?? []).map((item) => [item.phase, item]))
  expect(byPhase.http_request_dynamic_redirect).toEqual({
    phase: "http_request_dynamic_redirect",
    product: "Single Redirects",
    writable: true,
    entry_point: true,
    rules: 2,
    ruleset_id: RULESET_ID,
    error: null,
  })
  expect(byPhase.http_request_cache_settings).toMatchObject({
    entry_point: false,
    rules: 0,
    ruleset_id: null,
    error: null,
  })
  expect(byPhase.http_ratelimit).toEqual({
    phase: "http_ratelimit",
    product: "Rate limiting rules",
    writable: false,
    entry_point: null,
    rules: null,
    ruleset_id: null,
    error: "10000: Authentication error. The token needs Zone → Zone WAF → Read.",
  })
  expect(byPhase.http_custom_errors).toMatchObject({ entry_point: false, rules: 0 })
  // A 403 also makes the client verify the token, so only the zone lookup and the entry point reads are counted.
  const paths = requests.map((request) => request.path)
  expect(paths.filter((path) => path === `/zones/${ZONE_ID}`)).toHaveLength(1)
  expect(paths.filter((path) => path.endsWith("/entrypoint"))).toHaveLength(PHASES.length)
})

test("phases: any other error fails the whole call", async () => {
  const { tool } = toolFor(
    entrypointRoute("http_request_dynamic_redirect", rulesetOf([])),
    entrypointRoute("http_request_origin", fail(500, [{ code: 1000, message: "Internal error" }])),
  )

  const err = errorOf(await rejection(invoke(tool, { method: "phases", zone: ZONE_ID }, CTX)))
  expect(err.code).toBe("upstream_error")
})
