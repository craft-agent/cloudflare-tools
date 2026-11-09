import { describe, expect, test } from "bun:test"
import { ToolError } from "../errors"
import { PATH_PARAMS, PHASE_PATTERN, ROUTES, RULESET_ID_PATTERN, isAllowed } from "./routes"
import { fillPath } from "./url"

const ZONE_ID = "a".repeat(32)

describe("the ruleset routes", () => {
  test("the entry point route is a GET by zone and phase", () => {
    expect(ROUTES.rulesetEntrypoint).toEqual({
      method: "GET",
      path: "/zones/{zone_id}/rulesets/phases/{phase}/entrypoint",
    })
    expect(isAllowed(ROUTES.rulesetEntrypoint)).toBe(true)
    expect(PATH_PARAMS.phase).toBe(PHASE_PATTERN)
  })

  test("the other methods on that path are not allowed", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
      expect(isAllowed({ method, path: ROUTES.rulesetEntrypoint.path })).toBe(false)
    }
  })

  test("the path fills only for the listed phases", () => {
    expect(fillPath(ROUTES.rulesetEntrypoint, "x", { zone_id: ZONE_ID, phase: "http_ratelimit" })).toBe(
      `/zones/${ZONE_ID}/rulesets/phases/http_ratelimit/entrypoint`,
    )
    for (const phase of [
      "http_request_firewall_managed",
      "ddos_l7",
      "http_ratelimit/x",
      "../http_ratelimit",
      "http_ratelimit\n",
      "",
    ]) {
      expect(() => fillPath(ROUTES.rulesetEntrypoint, "x", { zone_id: ZONE_ID, phase })).toThrow(ToolError)
    }
  })
})

describe("the ruleset write routes", () => {
  test("creating an entry point and adding a rule are POSTs, and nothing replaces an entry point", () => {
    expect(ROUTES.rulesetCreate).toEqual({ method: "POST", path: "/zones/{zone_id}/rulesets" })
    expect(ROUTES.rulesetRuleCreate).toEqual({
      method: "POST",
      path: "/zones/{zone_id}/rulesets/{ruleset_id}/rules",
    })
    expect(isAllowed(ROUTES.rulesetCreate)).toBe(true)
    expect(isAllowed(ROUTES.rulesetRuleCreate)).toBe(true)
    expect(PATH_PARAMS.ruleset_id).toBe(RULESET_ID_PATTERN)
    for (const method of ["PUT", "PATCH", "DELETE"] as const) {
      expect(isAllowed({ method, path: ROUTES.rulesetCreate.path })).toBe(false)
      expect(isAllowed({ method, path: ROUTES.rulesetEntrypoint.path })).toBe(false)
      expect(isAllowed({ method, path: ROUTES.rulesetRuleCreate.path })).toBe(false)
    }
  })

  test("the rule path fills only for a 32-hex ruleset id", () => {
    const rulesetId = "e1".repeat(16)
    expect(fillPath(ROUTES.rulesetRuleCreate, "x", { zone_id: ZONE_ID, ruleset_id: rulesetId })).toBe(
      `/zones/${ZONE_ID}/rulesets/${rulesetId}/rules`,
    )
    for (const id of ["phases", "../rules", `${rulesetId}/rules`, rulesetId.toUpperCase(), "e1", ""]) {
      expect(() => fillPath(ROUTES.rulesetRuleCreate, "x", { zone_id: ZONE_ID, ruleset_id: id })).toThrow(ToolError)
    }
  })

  test("changing a rule is a PATCH of one rule, and no other read or change is allowed on its path", () => {
    expect(ROUTES.rulesetRuleEdit).toEqual({
      method: "PATCH",
      path: "/zones/{zone_id}/rulesets/{ruleset_id}/rules/{ruleset_rule_id}",
    })
    expect(isAllowed(ROUTES.rulesetRuleEdit)).toBe(true)
    expect(PATH_PARAMS.ruleset_rule_id).toBe(RULESET_ID_PATTERN)
    for (const method of ["GET", "POST", "PUT"] as const) {
      expect(isAllowed({ method, path: ROUTES.rulesetRuleEdit.path })).toBe(false)
    }
  })

  test("deleting a rule is a DELETE of one rule, on the path the change uses", () => {
    expect(ROUTES.rulesetRuleDelete).toEqual({ method: "DELETE", path: ROUTES.rulesetRuleEdit.path })
    expect(isAllowed(ROUTES.rulesetRuleDelete)).toBe(true)
    for (const method of ["GET", "POST", "PUT"] as const) {
      expect(isAllowed({ method, path: ROUTES.rulesetRuleDelete.path })).toBe(false)
    }
  })

  test("the rule path fills only for 32-hex ids", () => {
    const id = "e1".repeat(16)
    const path = { zone_id: ZONE_ID, ruleset_id: id, ruleset_rule_id: id }
    expect(fillPath(ROUTES.rulesetRuleEdit, "x", path)).toBe(`/zones/${ZONE_ID}/rulesets/${id}/rules/${id}`)
    for (const bad of ["../rules", `${id}/x`, id.toUpperCase(), "e1", "catch_all", ""]) {
      expect(() => fillPath(ROUTES.rulesetRuleEdit, "x", { ...path, ruleset_rule_id: bad })).toThrow(ToolError)
    }
  })
})
