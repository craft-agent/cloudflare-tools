import { ZONE_ID, envFor } from "../cloudflare/client.fixtures"
import { fakeCloudflare, ok, type FakeReply, type FakeRoute } from "../cloudflare/testing"
import { ZONE_ROUTE } from "../zone/fixtures"
import type { Phase } from "./phases"
import { defineRulesRead } from "./read"
import type { Rule } from "./shape"

export { errorOf, refusalOf } from "../workers/fixtures"
export { CTX, ZONE_NAME } from "../zone/fixtures"

export const RULESET_ID = "e1".repeat(16)

/** The path of a phase's entry point ruleset in the fixture zone. */
export function entrypointPath(phase: Phase): string {
  return `/zones/${ZONE_ID}/rulesets/phases/${phase}/entrypoint`
}

/** A fake route answering the entry point of `phase` with `reply`. */
export function entrypointRoute(phase: Phase, reply: FakeReply): FakeRoute {
  return { method: "GET", path: entrypointPath(phase), reply }
}

/** An entry point ruleset as Cloudflare returns it, holding `rules`. */
export function rulesetOf(rules: unknown[], extra: Record<string, unknown> = {}): FakeReply {
  return ok({
    id: RULESET_ID,
    name: "default",
    kind: "zone",
    phase: "http_request_dynamic_redirect",
    version: "3",
    last_updated: "2025-01-02T03:04:05.678Z",
    rules,
    ...extra,
  })
}

/** A redirect rule as Cloudflare returns it. */
export const REDIRECT_RULE = {
  id: "r1".repeat(16),
  version: "1",
  ref: "ref-redirect",
  description: "Send /old to /new",
  expression: '(http.request.uri.path eq "/old")',
  action: "redirect",
  action_parameters: { from_value: { status_code: 301, target_url: { value: "/new" } } },
  enabled: true,
  last_updated: "2025-01-01T00:00:00Z",
}

/** `REDIRECT_RULE` as the tool shapes it at position 1. */
export const SHAPED_REDIRECT_RULE: Rule = {
  position: 1,
  id: REDIRECT_RULE.id,
  ref: "ref-redirect",
  description: "Send /old to /new",
  expression: '(http.request.uri.path eq "/old")',
  action: "redirect",
  action_parameters: REDIRECT_RULE.action_parameters,
  enabled: true,
  version: "1",
  last_updated: "2025-01-01T00:00:00Z",
}

/** A cache rule as Cloudflare returns it. */
export const CACHE_RULE = {
  id: "c2".repeat(16),
  version: "2",
  ref: "ref-cache",
  description: "Cache images",
  expression: '(http.request.uri.path.extension eq "png")',
  action: "set_cache_settings",
  action_parameters: { cache: true, edge_ttl: { mode: "override_origin", default: 3600 } },
  enabled: false,
  last_updated: "2025-02-01T00:00:00Z",
}

/** The tool wired to a fake Cloudflare that answers the zone lookup and `routes`. */
export function toolFor(...routes: FakeRoute[]) {
  const { fetch, requests } = fakeCloudflare([ZONE_ROUTE, ...routes])
  return { tool: defineRulesRead({ fetch, env: envFor() }), requests }
}
