import { expect, test } from "bun:test"
import { ToolError } from "../errors"
import { ACCESS_APP_ID_PATTERN, DEPLOYMENT_ID_PATTERN, PATH_PARAMS, ROUTES, isAllowed } from "./routes"
import { fillPath } from "./url"

const ACCOUNT_ID = "a".repeat(32)
const ZONE_ID = "c".repeat(32)
const APP_ID = "0b2e3c4d-1a2b-4c3d-8e9f-0a1b2c3d4e5f"

const ROUTE_PATHS = [
  [ROUTES.accessApps, "/accounts/{account_id}/access/apps"],
  [ROUTES.accessApp, "/accounts/{account_id}/access/apps/{app_id}"],
  [ROUTES.accessAppPolicies, "/accounts/{account_id}/access/apps/{app_id}/policies"],
  [ROUTES.accessPolicies, "/accounts/{account_id}/access/policies"],
  [ROUTES.zoneAccessApps, "/zones/{zone_id}/access/apps"],
  [ROUTES.zoneAccessApp, "/zones/{zone_id}/access/apps/{app_id}"],
  [ROUTES.zoneAccessAppPolicies, "/zones/{zone_id}/access/apps/{app_id}/policies"],
] as const

test("Access routes allow only GETs", () => {
  for (const [route, path] of ROUTE_PATHS) {
    expect(route).toEqual({ method: "GET", path })
    expect(isAllowed(route)).toBe(true)
    for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
      expect(isAllowed({ method, path })).toBe(false)
    }
  }
  expect(PATH_PARAMS.app_id).toBe(ACCESS_APP_ID_PATTERN)
  expect(ACCESS_APP_ID_PATTERN).toBe(DEPLOYMENT_ID_PATTERN)
})

test("Access paths fill from the account or the zone", () => {
  expect(fillPath(ROUTES.accessApps, ACCOUNT_ID)).toBe(`/accounts/${ACCOUNT_ID}/access/apps`)
  expect(fillPath(ROUTES.accessPolicies, ACCOUNT_ID)).toBe(`/accounts/${ACCOUNT_ID}/access/policies`)
  expect(fillPath(ROUTES.accessAppPolicies, ACCOUNT_ID, { app_id: APP_ID })).toBe(
    `/accounts/${ACCOUNT_ID}/access/apps/${APP_ID}/policies`,
  )
  expect(fillPath(ROUTES.zoneAccessApps, ACCOUNT_ID, { zone_id: ZONE_ID })).toBe(`/zones/${ZONE_ID}/access/apps`)
  expect(fillPath(ROUTES.zoneAccessApp, ACCOUNT_ID, { zone_id: ZONE_ID, app_id: APP_ID })).toBe(
    `/zones/${ZONE_ID}/access/apps/${APP_ID}`,
  )
  expect(fillPath(ROUTES.zoneAccessAppPolicies, ACCOUNT_ID, { zone_id: ZONE_ID, app_id: APP_ID })).toBe(
    `/zones/${ZONE_ID}/access/apps/${APP_ID}/policies`,
  )
})

test("Access application ids accept only lowercase UUIDs", () => {
  expect(fillPath(ROUTES.accessApp, ACCOUNT_ID, { app_id: APP_ID })).toBe(
    `/accounts/${ACCOUNT_ID}/access/apps/${APP_ID}`,
  )
  for (const app_id of [
    "",
    "a1",
    APP_ID.toUpperCase(),
    "../apps",
    `${APP_ID}/policies`,
    "g".repeat(36),
    APP_ID.slice(1),
  ]) {
    expect(() => fillPath(ROUTES.accessApp, ACCOUNT_ID, { app_id })).toThrow(ToolError)
  }
})
