import { ACCOUNT_ID, envFor } from "../cloudflare/client.fixtures"
import { fakeCloudflare, ok, fail, type FakeReply, type FakeRequest, type FakeRoute } from "../cloudflare/testing"
import { SAMPLE_ZONE } from "../zone/fixtures"
import { defineEmailAddressAdd } from "./address-add"
import { defineEmailAddressDelete } from "./address-delete"
import { CATCH_ALL_PATH, CATCH_ALL_RULE, RULE_ID } from "./fixtures"
import { ADDRESSES_PATH, DESTINATION, addressRow, addressesRoute, paged } from "./rule.fixtures"
import type { Address } from "./address"

export { ADDRESSES_PATH, CATCH_ALL_PATH, DESTINATION, RULE_ID }

/** The id every address row of the fixtures has. */
export const ADDRESS_ID = addressRow(DESTINATION).id

/** The account's two zones. */
export const ZONE_A = SAMPLE_ZONE
export const ZONE_B = { id: "9".repeat(32), name: "example.org", account: { id: ACCOUNT_ID } }

/** The address of `DESTINATION` as the tools shape it: confirmed. */
export const SHAPED_VERIFIED: Address = {
  id: ADDRESS_ID,
  email: DESTINATION,
  verified: true,
  verified_at: "2024-01-01T00:00:00Z",
  created: "2023-12-01T00:00:00Z",
}

/** The address of `DESTINATION` as the tools shape it: added, not yet confirmed. */
export const SHAPED_PENDING: Address = { ...SHAPED_VERIFIED, verified: false, verified_at: null }

/** The path of the address's DELETE call. */
export const ADDRESS_PATH = `${ADDRESSES_PATH}/${ADDRESS_ID}`

/** The rules path of a zone. */
export function rulesPathOf(zone: { id: string }): string {
  return `/zones/${zone.id}/email/routing/rules`
}

/** A rule that forwards `to` to `value`, in Cloudflare's shape. */
export function forwardingRule(value: string[], extra: Record<string, unknown> = {}) {
  return {
    id: RULE_ID,
    name: "Sales",
    enabled: true,
    priority: 10,
    matchers: [{ type: "literal", field: "to", value: "sales@example.com" }],
    actions: [{ type: "forward", value }],
    ...extra,
  }
}

type Reply = FakeReply | ((request: FakeRequest) => FakeReply)

/** The account's zones listing. */
export function zonesRoute(reply: Reply = ok([ZONE_A, ZONE_B])): FakeRoute {
  return { method: "GET", path: "/zones", reply }
}

/** The rules of a zone; none by default. */
export function zoneRulesRoute(zone: { id: string }, reply: Reply = paged([[]])): FakeRoute {
  return { method: "GET", path: rulesPathOf(zone), reply }
}

/** The catch-all of a zone; by default it is the catch-all that drops. */
export function zoneCatchAllRoute(zone: { id: string }, reply: Reply = ok(CATCH_ALL_RULE)): FakeRoute {
  return { method: "GET", path: `${rulesPathOf(zone)}/catch_all`, reply }
}

/** A catch-all call answered "not found", as a zone without one. */
export const NO_CATCH_ALL = fail(404, [{ code: 1004, message: "Not found" }])

/** The create call; by default it answers with a pending address, as Cloudflare does. */
export function createAddressRoute(
  reply: Reply = (request) => ok({ ...addressRow((request.body as { email: string }).email, null), id: ADDRESS_ID }),
): FakeRoute {
  return { method: "POST", path: ADDRESSES_PATH, reply }
}

/** The delete call. */
export function deleteAddressRoute(reply: Reply = ok({ id: ADDRESS_ID })): FakeRoute {
  return { method: "DELETE", path: ADDRESS_PATH, reply }
}

/** The add tool wired to a fake Cloudflare: the `routes` given first, then no addresses and the create call. */
export function addressAddFor(...routes: FakeRoute[]) {
  const { fetch, requests } = fakeCloudflare([...routes, addressesRoute(paged([[]])), createAddressRoute()])
  return { tool: defineEmailAddressAdd({ fetch, env: envFor() }), requests }
}

/** The delete tool wired to a fake Cloudflare: the `routes` given first, then the address of `DESTINATION`, two zones with no rule forwarding to it and the delete call. */
export function addressDeleteFor(...routes: FakeRoute[]) {
  const { fetch, requests } = fakeCloudflare([
    ...routes,
    addressesRoute(paged([[addressRow(DESTINATION)]])),
    zonesRoute(),
    zoneRulesRoute(ZONE_A),
    zoneCatchAllRoute(ZONE_A),
    zoneRulesRoute(ZONE_B),
    zoneCatchAllRoute(ZONE_B, NO_CATCH_ALL),
    deleteAddressRoute(),
  ])
  return { tool: defineEmailAddressDelete({ fetch, env: envFor() }), requests }
}
