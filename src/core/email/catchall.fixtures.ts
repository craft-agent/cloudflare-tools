import { envFor } from "../cloudflare/client.fixtures"
import { fakeCloudflare, ok, type FakeReply, type FakeRequest, type FakeRoute } from "../cloudflare/testing"
import { ZONE_ROUTE } from "../zone/fixtures"
import { defineEmailCatchAllEdit } from "./catchall-edit"
import { CATCH_ALL_PATH, CATCH_ALL_RULE, OTHER_DESTINATION, catchAllRoute } from "./rule.current.fixtures"
import { DESTINATION, ZONES_ROUTE, addressRow, addressesRoute, paged, routingRoute } from "./rule.fixtures"
import type { Rule } from "./shape"

export { CATCH_ALL_PATH, CATCH_ALL_RULE, catchAllRoute }

/** The arguments of an edit of the catch-all that drops; a test adds what changes. */
export const CATCH_BASE = { zone: "example.com", replaces: { type: "drop" } }

/** `CATCH_ALL_RULE` as the tool shapes it. */
export const SHAPED_CATCH_ALL: Rule = {
  id: CATCH_ALL_RULE.id,
  name: "Catch-all",
  enabled: true,
  priority: 2147483647,
  to: null,
  action: { type: "drop" },
  managed_by: "api",
}

/** The catch-all as Cloudflare returns it once it is off, keeping its action. */
export const DISABLED_CATCH_ALL = { ...CATCH_ALL_RULE, enabled: false }

/** The body the edit sends when only what a test changes differs from `CATCH_ALL_RULE`. */
export const CATCH_BODY = {
  matchers: [{ type: "all" }],
  actions: [{ type: "drop" }],
  enabled: true,
  name: "Catch-all",
}

type Reply = FakeReply | ((request: FakeRequest) => FakeReply)

/** The replace call; by default it answers with the catch-all it was sent, as Cloudflare does. */
export function replaceCatchAllRoute(
  reply: Reply = (request) =>
    ok({ id: CATCH_ALL_RULE.id, tag: CATCH_ALL_RULE.id, priority: 2147483647, ...(request.body as object) }),
): FakeRoute {
  return { method: "PUT", path: CATCH_ALL_PATH, reply }
}

/** The tool wired to a fake Cloudflare: the `routes` given first, then a zone, Email Routing on, an enabled catch-all that drops, two verified destinations and the replace call. */
export function catchAllEditFor(...routes: FakeRoute[]) {
  const { fetch, requests } = fakeCloudflare([
    ...routes,
    ZONES_ROUTE,
    ZONE_ROUTE,
    routingRoute(),
    catchAllRoute(),
    addressesRoute(paged([[addressRow(DESTINATION), addressRow(OTHER_DESTINATION)]])),
    replaceCatchAllRoute(),
  ])
  return { tool: defineEmailCatchAllEdit({ fetch, env: envFor() }), requests }
}
