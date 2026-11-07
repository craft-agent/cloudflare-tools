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
    expect(ROUTES.workersDeploy).toEqual({
      method: "POST",
      path: "/accounts/{account_id}/workers/scripts/{script_name}/deployments",
    })
    expect(ROUTES.workersVersions.path).toBe("/accounts/{account_id}/workers/scripts/{script_name}/versions")
    expect(ROUTES.workersRoutes).toEqual({ method: "GET", path: "/zones/{zone_id}/workers/routes" })
    expect(ROUTES.workersDomains).toEqual({ method: "GET", path: "/accounts/{account_id}/workers/domains" })
    expect(ROUTES.workersSchedules).toEqual({
      method: "GET",
      path: "/accounts/{account_id}/workers/scripts/{script_name}/schedules",
    })
    expect(ROUTES.workersSecrets).toEqual({
      method: "GET",
      path: "/accounts/{account_id}/workers/scripts/{script_name}/secrets",
    })
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

  test("the GraphQL route is a POST without path parameters", () => {
    expect(ROUTES.graphql).toEqual({ method: "POST", path: "/graphql" })
  })

  test("the Pages routes use a project name and deployment id", () => {
    expect(ROUTES.pagesProjects).toEqual({ method: "GET", path: "/accounts/{account_id}/pages/projects" })
    expect(ROUTES.pagesProject).toEqual({ method: "GET", path: "/accounts/{account_id}/pages/projects/{project_name}" })
    expect(ROUTES.pagesDeployments).toEqual({
      method: "GET",
      path: "/accounts/{account_id}/pages/projects/{project_name}/deployments",
    })
    expect(ROUTES.pagesDeployment).toEqual({
      method: "GET",
      path: "/accounts/{account_id}/pages/projects/{project_name}/deployments/{deployment_id}",
    })
    expect(ROUTES.pagesRollback).toEqual({
      method: "POST",
      path: "/accounts/{account_id}/pages/projects/{project_name}/deployments/{deployment_id}/rollback",
    })
    expect(ROUTES.pagesDeploymentLogs).toEqual({
      method: "GET",
      path: "/accounts/{account_id}/pages/projects/{project_name}/deployments/{deployment_id}/history/logs",
    })
    expect(ROUTES.pagesDomains).toEqual({
      method: "GET",
      path: "/accounts/{account_id}/pages/projects/{project_name}/domains",
    })
    expect(ROUTES.pagesDomain).toEqual({
      method: "GET",
      path: "/accounts/{account_id}/pages/projects/{project_name}/domains/{domain_name}",
    })
    expect(ROUTES.pagesDomainAdd).toEqual({
      method: "POST",
      path: "/accounts/{account_id}/pages/projects/{project_name}/domains",
    })
    expect(ROUTES.pagesDomainRemove).toEqual({
      method: "DELETE",
      path: "/accounts/{account_id}/pages/projects/{project_name}/domains/{domain_name}",
    })
    for (const name of ["a.io", "shop.example.com", "xn--bcher-kva.example", "a_b-c.d", `${"a".repeat(250)}.io`]) {
      expect(PATH_PARAMS.domain_name?.test(name)).toBe(true)
    }
    const invalid = [
      "",
      ".",
      "..",
      "a",
      "a..io",
      ".a.io",
      "a.io.",
      "A.io",
      "a b",
      "a/b",
      "a?b",
      "a#b",
      "a%2fb",
      "*.a.io",
    ]
    for (const name of [...invalid, `${"a".repeat(251)}.io`]) {
      expect(PATH_PARAMS.domain_name?.test(name)).toBe(false)
    }
    for (const name of ["a", "0", "my-project-2", "a-", "a".repeat(58)]) {
      expect(PATH_PARAMS.project_name?.test(name)).toBe(true)
    }
    for (const name of ["", "A", "-a", "a_b", "a b", "a/b", "..", "a.b", "a".repeat(59)]) {
      expect(PATH_PARAMS.project_name?.test(name)).toBe(false)
    }
    expect(PATH_PARAMS.deployment_id?.test("11111111-1111-4111-8111-111111111111")).toBe(true)
    for (const id of [
      "",
      "11111111",
      "11111111-1111-4111-8111-11111111111",
      "11111111-1111-4111-8111-1111111111111",
      "11111111-1111-4111-8111-11111111111G",
      "11111111-1111-4111-8111-AAAAAAAAAAAA",
    ]) {
      expect(PATH_PARAMS.deployment_id?.test(id)).toBe(false)
    }
  })

  test("the R2 routes are listed and their bucket parameter takes a bucket name only", () => {
    expect(ROUTES.r2Buckets).toEqual({ method: "GET", path: "/accounts/{account_id}/r2/buckets" })
    expect(ROUTES.r2Bucket).toEqual({ method: "GET", path: "/accounts/{account_id}/r2/buckets/{bucket_name}" })
    expect(ROUTES.r2BucketManagedDomain).toEqual({
      method: "GET",
      path: "/accounts/{account_id}/r2/buckets/{bucket_name}/domains/managed",
    })
    expect(ROUTES.r2BucketCustomDomains).toEqual({
      method: "GET",
      path: "/accounts/{account_id}/r2/buckets/{bucket_name}/domains/custom",
    })
    expect(ROUTES.r2BucketCors).toEqual({
      method: "GET",
      path: "/accounts/{account_id}/r2/buckets/{bucket_name}/cors",
    })
    expect(ROUTES.r2BucketLifecycle).toEqual({
      method: "GET",
      path: "/accounts/{account_id}/r2/buckets/{bucket_name}/lifecycle",
    })
    expect(ROUTES.r2BucketObjects).toEqual({
      method: "GET",
      path: "/accounts/{account_id}/r2/buckets/{bucket_name}/objects",
    })
    for (const name of ["my-bucket", "a-b", "012", "a".repeat(63)]) {
      expect(PATH_PARAMS.bucket_name?.test(name)).toBe(true)
    }
    for (const name of ["", "a", "ab", "A-bucket", "-ab", "ab-", "a_b", "a/b", "a b", "a".repeat(64)]) {
      expect(PATH_PARAMS.bucket_name?.test(name)).toBe(false)
    }
  })
})
