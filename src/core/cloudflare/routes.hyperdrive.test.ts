import { expect, test } from "bun:test"
import { ToolError } from "../errors"
import { HYPERDRIVE_ID_PATTERN, PATH_PARAMS, ROUTES, isAllowed } from "./routes"
import { fillPath } from "./url"

const ACCOUNT_ID = "a".repeat(32)
const CONFIG_ID = "b1".repeat(16)

test("Hyperdrive routes allow only account-scoped GETs", () => {
  expect(ROUTES.hyperdriveConfigs).toEqual({ method: "GET", path: "/accounts/{account_id}/hyperdrive/configs" })
  expect(ROUTES.hyperdriveConfig).toEqual({
    method: "GET",
    path: "/accounts/{account_id}/hyperdrive/configs/{hyperdrive_id}",
  })
  expect(PATH_PARAMS.hyperdrive_id).toBe(HYPERDRIVE_ID_PATTERN)
  for (const route of [ROUTES.hyperdriveConfigs, ROUTES.hyperdriveConfig]) {
    expect(isAllowed(route)).toBe(true)
    for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
      expect(isAllowed({ method, path: route.path })).toBe(false)
    }
  }
})

test("Hyperdrive paths fill from the account and accept only lowercase 32-hex ids", () => {
  expect(fillPath(ROUTES.hyperdriveConfigs, ACCOUNT_ID)).toBe(`/accounts/${ACCOUNT_ID}/hyperdrive/configs`)
  expect(fillPath(ROUTES.hyperdriveConfig, ACCOUNT_ID, { hyperdrive_id: CONFIG_ID })).toBe(
    `/accounts/${ACCOUNT_ID}/hyperdrive/configs/${CONFIG_ID}`,
  )
  for (const hyperdrive_id of ["", "a1", CONFIG_ID.toUpperCase(), "../configs", `${CONFIG_ID}/extra`, "g".repeat(32)]) {
    expect(() => fillPath(ROUTES.hyperdriveConfig, ACCOUNT_ID, { hyperdrive_id })).toThrow(ToolError)
  }
})
