import { expect, test } from "bun:test"
import { ACCOUNT_ID, rejection, tokenStatus, VERIFY_USER_PATH } from "../cloudflare/client.fixtures"
import { D1_SCHEMA_SQL } from "../cloudflare/routes"
import { ok } from "../cloudflare/testing"
import { invoke } from "../tool"
import { MAX_TEXT_LENGTH } from "../workers/shape"
import { CTX, errorOf, refusalOf, toolFor } from "./fixtures"

const DATABASE = "12345678-1234-abcd-1234-123456789abc"
const DATABASES_PATH = `/accounts/${ACCOUNT_ID}/d1/database`
const DATABASE_PATH = `${DATABASES_PATH}/${DATABASE}`
const SCHEMA_PATH = `${DATABASE_PATH}/query`
const DATABASE_REPLY = { uuid: DATABASE, name: "app", created_at: "2024-01-01", version: "production" }
const LONG_NAME = "x".repeat(MAX_TEXT_LENGTH + 1)
const CLIPPED_NAME = `${"x".repeat(MAX_TEXT_LENGTH)}…`

test("databases: exact path and query, shaping and paging", async () => {
  const paging = { page: 2, per_page: 100, total_count: 101, total_pages: 2 }
  const { tool, requests } = toolFor({
    method: "GET",
    path: DATABASES_PATH,
    reply: ok([{ ...DATABASE_REPLY, name: LONG_NAME }, { uuid: "other" }, { name: "dropped" }, null], paging),
  })
  expect(await invoke(tool, { method: "databases", page: 2 }, CTX)).toEqual({
    label: "default",
    databases: [
      { id: DATABASE, name: CLIPPED_NAME, created: "2024-01-01", version: "production" },
      { id: "other", name: null, created: null, version: null },
    ],
    ...paging,
  })
  expect(Object.fromEntries(requests[0]!.query)).toEqual({ page: "2", per_page: "100" })
  await invoke(tool, { method: "databases" }, CTX)
  expect(Object.fromEntries(requests[1]!.query)).toEqual({ page: "1", per_page: "100" })
})

test("database: details first, then the fixed schema body; all four groups and whole SQL", async () => {
  const sql = `CREATE TABLE ${LONG_NAME} (value TEXT)`
  const { tool, requests } = toolFor(
    {
      method: "GET",
      path: DATABASE_PATH,
      reply: ok({ ...DATABASE_REPLY, file_size: 4096, read_replication: { mode: "auto" } }),
    },
    {
      method: "POST",
      path: SCHEMA_PATH,
      reply: ok([
        {
          success: true,
          results: [
            { type: "table", name: LONG_NAME, tbl_name: LONG_NAME, sql },
            { type: "index", name: "idx", tbl_name: LONG_NAME, sql: "CREATE INDEX idx ON app(value)" },
            { type: "view", name: "view", tbl_name: "view" },
            { type: "trigger", name: "trigger", tbl_name: "app", sql: null },
            { type: "table" },
            { type: "other", name: "dropped" },
            null,
          ],
        },
      ]),
    },
  )
  expect(await invoke(tool, { method: "database", database: DATABASE }, CTX)).toEqual({
    label: "default",
    database: {
      id: DATABASE,
      name: "app",
      created: "2024-01-01",
      version: "production",
      size: 4096,
      read_replication: "auto",
    },
    schema: {
      tables: [{ name: CLIPPED_NAME, table: null, sql }],
      indexes: [{ name: "idx", table: LONG_NAME, sql: "CREATE INDEX idx ON app(value)" }],
      views: [{ name: "view", table: null, sql: null }],
      triggers: [{ name: "trigger", table: "app", sql: null }],
    },
  })
  expect(
    requests.map(({ method, path, body, query }) => ({ method, path, body, query: Object.fromEntries(query) })),
  ).toEqual([
    { method: "GET", path: DATABASE_PATH, body: undefined, query: {} },
    { method: "POST", path: SCHEMA_PATH, body: { sql: D1_SCHEMA_SQL }, query: {} },
  ])
})

test("database: absent details and schema fields become null or empty", async () => {
  const { tool } = toolFor(
    { method: "GET", path: DATABASE_PATH, reply: ok({ uuid: DATABASE }) },
    { method: "POST", path: SCHEMA_PATH, reply: ok([{ success: true, results: [] }]) },
  )
  expect(await invoke(tool, { method: "database", database: DATABASE }, CTX)).toEqual({
    label: "default",
    database: { id: DATABASE, name: null, created: null, version: null, size: null, read_replication: null },
    schema: { tables: [], indexes: [], views: [], triggers: [] },
  })
  const { tool: list } = toolFor({ method: "GET", path: DATABASES_PATH, reply: ok([]) })
  expect(await invoke(list, { method: "databases" }, CTX)).toEqual({
    label: "default",
    databases: [],
    page: null,
    per_page: null,
    total_count: null,
    total_pages: null,
  })
})

test("D1: refuses malformed IDs, missing and wrong-method arguments before any request", async () => {
  const { tool, requests } = toolFor()
  for (const database of ["", "a".repeat(32), DATABASE.toUpperCase(), `${DATABASE}/query`]) {
    expect(await refusalOf(invoke(tool, { method: "database", database }, CTX))).toContain("database")
  }
  expect(await refusalOf(invoke(tool, { method: "database" }, CTX))).toContain("requires `database`")
  expect(await refusalOf(invoke(tool, { method: "database", database: DATABASE, page: 1 }, CTX))).toContain(
    "takes no `page`",
  )
  expect(
    await refusalOf(invoke(tool, { method: "database", database: DATABASE, sql: "DROP TABLE app" }, CTX)),
  ).toContain("sql")
  expect(await refusalOf(invoke(tool, { method: "databases", database: DATABASE }, CTX))).toContain(
    "takes no `database`",
  )
  expect(await refusalOf(invoke(tool, { method: "databases", cursor: "next" }, CTX))).toContain("takes no `cursor`")
  expect(requests).toEqual([])
})

test("D1: missing database passes through and no schema query is sent", async () => {
  const { tool, requests } = toolFor({
    method: "GET",
    path: DATABASE_PATH,
    reply: { status: 404, body: { success: false, errors: [{ message: "Database not found" }] } },
  })
  const error = errorOf(await rejection(invoke(tool, { method: "database", database: DATABASE }, CTX)))
  expect(error.code).toBe("not_found")
  expect(error.message).toContain("Database not found")
  expect(requests).toHaveLength(1)
})

test("D1: rejects unexpected listing, detail and schema replies", async () => {
  for (const result of [null, {}, "wrong"]) {
    const { tool } = toolFor({ method: "GET", path: DATABASES_PATH, reply: ok(result) })
    expect(errorOf(await rejection(invoke(tool, { method: "databases" }, CTX))).code).toBe("upstream_error")
    const { tool: detail, requests } = toolFor({ method: "GET", path: DATABASE_PATH, reply: ok(result) })
    expect(errorOf(await rejection(invoke(detail, { method: "database", database: DATABASE }, CTX))).code).toBe(
      "upstream_error",
    )
    expect(requests).toHaveLength(1)
  }
  for (const result of [
    null,
    {},
    [],
    [null],
    [{ success: false, results: [] }],
    [{ results: [] }],
    [{ success: true }],
    [{ success: true, results: {} }],
  ]) {
    const { tool } = toolFor(
      { method: "GET", path: DATABASE_PATH, reply: ok(DATABASE_REPLY) },
      { method: "POST", path: SCHEMA_PATH, reply: ok(result) },
    )
    const error = errorOf(await rejection(invoke(tool, { method: "database", database: DATABASE }, CTX)))
    expect(error.code).toBe("upstream_error")
    expect(error.message).toContain("D1 schema response")
  }
})

test("D1: forbidden replies on lists, details and the query name the permission", async () => {
  for (const path of [DATABASES_PATH, DATABASE_PATH, SCHEMA_PATH]) {
    const { tool } = toolFor(
      { method: "GET", path: VERIFY_USER_PATH, reply: tokenStatus("active") },
      {
        method: path === SCHEMA_PATH ? "POST" : "GET",
        path,
        reply: { status: 403, body: { success: false, errors: [{ message: "Denied" }] } },
      },
      { method: "GET", path: DATABASE_PATH, reply: ok(DATABASE_REPLY) },
    )
    const args = path === DATABASES_PATH ? { method: "databases" } : { method: "database", database: DATABASE }
    const error = errorOf(await rejection(invoke(tool, args, CTX)))
    expect(error.code).toBe("forbidden")
    expect(error.message).toEndWith("The token needs Account → D1 → Read.")
  }
})
