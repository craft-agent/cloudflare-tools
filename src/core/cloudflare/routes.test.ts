import { describe, expect, test } from "bun:test"
import { PATH_PARAMS, ROUTES, isAllowed } from "./routes"

describe("routes", () => {
  test("every template uses only known path parameters", () => {
    for (const route of Object.values(ROUTES)) {
      const names = [...route.path.matchAll(/\{([^{}]*)\}/g)].map((match) => match[1] ?? "")
      for (const name of names) expect(Object.hasOwn(PATH_PARAMS, name)).toBe(true)
    }
  })

  test("the tables are frozen", () => {
    expect(Object.isFrozen(ROUTES)).toBe(true)
    expect(Object.isFrozen(PATH_PARAMS)).toBe(true)
    for (const route of Object.values(ROUTES)) expect(Object.isFrozen(route)).toBe(true)
  })

  test("isAllowed accepts every listed route, also as a hand-made copy", () => {
    for (const route of Object.values(ROUTES)) {
      expect(isAllowed(route)).toBe(true)
      expect(isAllowed({ method: route.method, path: route.path })).toBe(true)
    }
  })

  test("isAllowed refuses a route that is not listed", () => {
    expect(isAllowed({ method: "GET", path: "/certificates" })).toBe(false)
    expect(isAllowed({ method: "DELETE", path: ROUTES.account.path })).toBe(false)
    expect(isAllowed({ method: "GET", path: "/accounts/0123/logs/audit" })).toBe(false)
  })
})
