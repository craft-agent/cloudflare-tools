import { describe, expect, test } from "bun:test"
import { pagingFields, type ResultInfo } from "./reply"

describe("pagingFields", () => {
  test("keeps numeric paging fields", () => {
    expect(pagingFields({ page: 2, per_page: 50, total_count: 0, total_pages: 3 })).toEqual({
      page: 2,
      per_page: 50,
      total_count: 0,
      total_pages: 3,
    })
  })

  test("returns null for missing or non-number fields", () => {
    const info = { page: "2", per_page: null, total_count: false } as unknown as ResultInfo
    expect(pagingFields(info)).toEqual({ page: null, per_page: null, total_count: null, total_pages: null })
  })

  test("returns all null fields for undefined info", () => {
    expect(pagingFields(undefined)).toEqual({ page: null, per_page: null, total_count: null, total_pages: null })
  })
})
