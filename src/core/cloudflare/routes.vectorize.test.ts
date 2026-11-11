import { expect, test } from "bun:test"
import { ToolError } from "../errors"
import { INDEX_NAME_PATTERN, PATH_PARAMS, ROUTES, isAllowed } from "./routes"
import { fillPath } from "./url"

const ACCOUNT_ID = "a".repeat(32)
const INDEX_NAME = "app-search"
const INDEXES_PATH = "/accounts/{account_id}/vectorize/v2/indexes"
const ROUTE_SUFFIXES = [
  [ROUTES.vectorizeIndexes, ""],
  [ROUTES.vectorizeIndex, "/{index_name}"],
  [ROUTES.vectorizeIndexInfo, "/{index_name}/info"],
  [ROUTES.vectorizeMetadataIndexes, "/{index_name}/metadata_index/list"],
] as const

test("Vectorize routes allow only the four account-scoped metadata GETs", () => {
  expect(PATH_PARAMS.index_name).toBe(INDEX_NAME_PATTERN)
  for (const [route, suffix] of ROUTE_SUFFIXES) {
    expect(route).toEqual({ method: "GET", path: `${INDEXES_PATH}${suffix}` })
    expect(isAllowed(route)).toBe(true)
    for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
      expect(isAllowed({ method, path: route.path })).toBe(false)
    }
    expect(fillPath(route, ACCOUNT_ID, suffix ? { index_name: INDEX_NAME } : {})).toBe(
      `/accounts/${ACCOUNT_ID}/vectorize/v2/indexes${suffix.replace("{index_name}", INDEX_NAME)}`,
    )
  }
  for (const suffix of ["query", "get_by_ids", "list", "vectors"]) {
    expect(isAllowed({ method: "GET", path: `${INDEXES_PATH}/{index_name}/${suffix}` })).toBe(false)
  }
})

test("Vectorize index names require 1–64 lowercase letters, digits and hyphens starting with a letter", () => {
  for (const index_name of ["a", "a-0", "a".repeat(64)]) {
    expect(INDEX_NAME_PATTERN.test(index_name)).toBe(true)
    expect(fillPath(ROUTES.vectorizeIndex, ACCOUNT_ID, { index_name })).toContain(index_name)
  }
  for (const index_name of ["", "A", "0abc", "-abc", "a_b", "../indexes", "a/extra", "a.b", "a".repeat(65)]) {
    expect(INDEX_NAME_PATTERN.test(index_name)).toBe(false)
    for (const [route] of ROUTE_SUFFIXES.slice(1)) {
      expect(() => fillPath(route, ACCOUNT_ID, { index_name })).toThrow(ToolError)
    }
  }
})
