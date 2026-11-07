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

  test("the DNS record routes are listed and their id parameter takes 32 hex digits only", () => {
    expect(ROUTES.dnsRecord.path).toBe("/zones/{zone_id}/dns_records/{dns_record_id}")
    expect(ROUTES.dnsRecordsExport.path).toBe("/zones/{zone_id}/dns_records/export")
    expect(ROUTES.dnsRecordsBatch).toEqual({ method: "POST", path: "/zones/{zone_id}/dns_records/batch" })
    expect(PATH_PARAMS.dns_record_id?.test("a".repeat(32))).toBe(true)
    expect(PATH_PARAMS.dns_record_id?.test("export")).toBe(false)
  })

  test("the Workers routes are listed and their script parameter takes a Worker name only", () => {
    expect(ROUTES.workersScripts).toEqual({ method: "GET", path: "/accounts/{account_id}/workers/scripts" })
    expect(ROUTES.workersVersions.path).toBe("/accounts/{account_id}/workers/scripts/{script_name}/versions")
    for (const name of ["a", "my-worker_2", "a".repeat(63)]) expect(PATH_PARAMS.script_name?.test(name)).toBe(true)
    for (const name of ["", "A", "a b", "a/b", "..", "a.b", "a".repeat(64)]) {
      expect(PATH_PARAMS.script_name?.test(name)).toBe(false)
    }
  })

  test("isAllowed refuses a route that is not listed", () => {
    expect(isAllowed({ method: "GET", path: "/certificates" })).toBe(false)
    expect(isAllowed({ method: "DELETE", path: ROUTES.account.path })).toBe(false)
    expect(isAllowed({ method: "GET", path: "/accounts/0123/logs/audit" })).toBe(false)
  })
})
