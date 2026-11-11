import { expect, test } from "bun:test"
import { ToolError } from "../errors"
import { DOMAIN_NAME_PATTERN, PATH_PARAMS, ROUTES, isAllowed } from "./routes"
import { fillPath } from "./url"

const ACCOUNT_ID = "a".repeat(32)
const DOMAIN_NAME = "example.net"

test("Registrar routes allow only account-scoped registration GETs, never legacy domains", () => {
  expect(ROUTES.registrarRegistrations).toEqual({
    method: "GET",
    path: "/accounts/{account_id}/registrar/registrations",
  })
  expect(ROUTES.registrarRegistration).toEqual({
    method: "GET",
    path: "/accounts/{account_id}/registrar/registrations/{domain_name}",
  })
  expect(PATH_PARAMS.domain_name).toBe(DOMAIN_NAME_PATTERN)
  for (const route of [ROUTES.registrarRegistrations, ROUTES.registrarRegistration]) {
    expect(isAllowed(route)).toBe(true)
    for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
      expect(isAllowed({ method, path: route.path })).toBe(false)
    }
  }
  for (const path of [
    "/accounts/{account_id}/registrar/domains",
    "/accounts/{account_id}/registrar/domains/{domain_name}",
  ]) {
    expect(isAllowed({ method: "GET", path })).toBe(false)
  }
})

test("Registrar paths fill from the account and accept only valid domain names", () => {
  expect(fillPath(ROUTES.registrarRegistrations, ACCOUNT_ID)).toBe(`/accounts/${ACCOUNT_ID}/registrar/registrations`)
  expect(fillPath(ROUTES.registrarRegistration, ACCOUNT_ID, { domain_name: DOMAIN_NAME })).toBe(
    `/accounts/${ACCOUNT_ID}/registrar/registrations/${DOMAIN_NAME}`,
  )
  for (const domain_name of ["", "localhost", "../registrations", `${DOMAIN_NAME}/extra`, "a b.net", "a".repeat(254)]) {
    expect(() => fillPath(ROUTES.registrarRegistration, ACCOUNT_ID, { domain_name })).toThrow(ToolError)
  }
})
