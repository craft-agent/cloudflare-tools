import { expect, test } from "bun:test"
import { ToolError } from "../errors"
import { PATH_PARAMS, ROUTES, SITEKEY_PATTERN, isAllowed } from "./routes"
import { fillPath } from "./url"

const ACCOUNT_ID = "a".repeat(32)
const SITEKEY = "0x4AAAAAAA_test-1"

test("Turnstile routes allow only account-scoped GETs", () => {
  expect(ROUTES.turnstileWidgets).toEqual({ method: "GET", path: "/accounts/{account_id}/challenges/widgets" })
  expect(ROUTES.turnstileWidget).toEqual({ method: "GET", path: "/accounts/{account_id}/challenges/widgets/{sitekey}" })
  expect(PATH_PARAMS.sitekey).toBe(SITEKEY_PATTERN)
  for (const route of [ROUTES.turnstileWidgets, ROUTES.turnstileWidget]) {
    expect(isAllowed(route)).toBe(true)
    for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
      expect(isAllowed({ method, path: route.path })).toBe(false)
    }
  }
})

test("Turnstile paths fill from the account and accept only valid sitekeys", () => {
  expect(fillPath(ROUTES.turnstileWidgets, ACCOUNT_ID)).toBe(`/accounts/${ACCOUNT_ID}/challenges/widgets`)
  for (const sitekey of [SITEKEY, "a", "A_-" + "a".repeat(61)]) {
    expect(fillPath(ROUTES.turnstileWidget, ACCOUNT_ID, { sitekey })).toBe(
      `/accounts/${ACCOUNT_ID}/challenges/widgets/${sitekey}`,
    )
  }
  for (const sitekey of ["", "a".repeat(65), "../widgets", `${SITEKEY}/extra`, "a.b", "a b"]) {
    expect(() => fillPath(ROUTES.turnstileWidget, ACCOUNT_ID, { sitekey })).toThrow(ToolError)
  }
})
