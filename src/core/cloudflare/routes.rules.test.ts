import { describe, expect, test } from "bun:test"
import { ToolError } from "../errors"
import { PATH_PARAMS, PHASE_PATTERN, ROUTES, isAllowed } from "./routes"
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
