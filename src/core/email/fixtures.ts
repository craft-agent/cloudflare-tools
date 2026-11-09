import { ACCOUNT_ID, ZONE_ID, envFor } from "../cloudflare/client.fixtures"
import { fakeCloudflare, type FakeRoute } from "../cloudflare/testing"
import { ZONE_ROUTE } from "../zone/fixtures"
import { defineEmailRead } from "./read"
import type { Rule } from "./shape"

export { errorOf, refusalOf } from "../workers/fixtures"
export { CTX, ZONE_NAME } from "../zone/fixtures"

export const ROUTING_PATH = `/zones/${ZONE_ID}/email/routing`
export const RULES_PATH = `${ROUTING_PATH}/rules`
export const CATCH_ALL_PATH = `${RULES_PATH}/catch_all`
export const ADDRESSES_PATH = `/accounts/${ACCOUNT_ID}/email/routing/addresses`

export const RULE_ID = "a1".repeat(16)
export const OTHER_RULE_ID = "b2".repeat(16)
export const ADDRESS_ID = "c3".repeat(16)

/** A rule that forwards `Info@Example.com` to one address, as Cloudflare returns it. */
export const FORWARD_RULE = {
  id: RULE_ID,
  tag: RULE_ID,
  name: "Info forward",
  enabled: true,
  priority: 10,
  matchers: [{ type: "literal", field: "to", value: "Info@Example.com" }],
  actions: [{ type: "forward", value: ["Owner@Example.com"] }],
}

/** `FORWARD_RULE` as the tool shapes it. */
export const SHAPED_FORWARD_RULE: Rule = {
  id: RULE_ID,
  name: "Info forward",
  enabled: true,
  priority: 10,
  to: "info@example.com",
  action: { type: "forward", to: "owner@example.com" },
  managed_by: "api",
}

/** A catch-all rule that drops everything. */
export const CATCH_ALL_RULE = {
  id: OTHER_RULE_ID,
  name: "Catch-all",
  enabled: true,
  priority: 2147483647,
  matchers: [{ type: "all" }],
  actions: [{ type: "drop" }],
}

/** The tool wired to a fake Cloudflare that answers the zone lookup and `routes`. */
export function toolFor(...routes: FakeRoute[]) {
  const { fetch, requests } = fakeCloudflare([ZONE_ROUTE, ...routes])
  return { tool: defineEmailRead({ fetch, env: envFor() }), requests }
}
