import { describe, expect, test } from "bun:test"
import { ADDRESS_ID_PATTERN, PATH_PARAMS, ROUTES, RULE_ID_PATTERN } from "./routes"

describe("the Email Routing routes", () => {
  test("are listed and their zone parameter is a zone id", () => {
    expect(ROUTES.emailRouting).toEqual({ method: "GET", path: "/zones/{zone_id}/email/routing" })
    expect(ROUTES.emailRoutingRules).toEqual({ method: "GET", path: "/zones/{zone_id}/email/routing/rules" })
    expect(ROUTES.emailRoutingCatchAll).toEqual({
      method: "GET",
      path: "/zones/{zone_id}/email/routing/rules/catch_all",
    })
    expect(ROUTES.emailRoutingAddresses).toEqual({
      method: "GET",
      path: "/accounts/{account_id}/email/routing/addresses",
    })
    expect(ROUTES.emailRoutingRuleCreate).toEqual({ method: "POST", path: "/zones/{zone_id}/email/routing/rules" })
  })

  test("the single rule routes take a rule id, which is never `catch_all`", () => {
    const path = "/zones/{zone_id}/email/routing/rules/{rule_id}"
    expect(ROUTES.emailRoutingRule).toEqual({ method: "GET", path })
    expect(ROUTES.emailRoutingRuleEdit).toEqual({ method: "PUT", path })
    expect(ROUTES.emailRoutingRuleDelete).toEqual({ method: "DELETE", path })
    expect(PATH_PARAMS.rule_id).toBe(RULE_ID_PATTERN)
    for (const id of ["a", "a1".repeat(16), "A".repeat(64), "0"]) expect(RULE_ID_PATTERN.test(id)).toBe(true)
    for (const id of ["", "catch_all", "a_b", "a".repeat(65), "../x", "a/b", "a b", "a\n"]) {
      expect(RULE_ID_PATTERN.test(id)).toBe(false)
    }
  })

  test("the destination address routes are a POST and a DELETE by address id", () => {
    expect(ROUTES.emailRoutingAddressCreate).toEqual({
      method: "POST",
      path: "/accounts/{account_id}/email/routing/addresses",
    })
    expect(ROUTES.emailRoutingAddressDelete).toEqual({
      method: "DELETE",
      path: "/accounts/{account_id}/email/routing/addresses/{address_id}",
    })
    expect(PATH_PARAMS.address_id).toBe(ADDRESS_ID_PATTERN)
    expect(ADDRESS_ID_PATTERN.test("e5".repeat(16))).toBe(true)
    for (const id of ["", "a_b", "a".repeat(65), "../x", "a/b", "a@b.c"])
      expect(ADDRESS_ID_PATTERN.test(id)).toBe(false)
  })

  test("the catch-all edit route is a PUT to the fixed catch_all path, with no rule id", () => {
    expect(ROUTES.emailRoutingCatchAllEdit).toEqual({
      method: "PUT",
      path: "/zones/{zone_id}/email/routing/rules/catch_all",
    })
  })
})
