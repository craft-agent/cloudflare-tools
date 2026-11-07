import { describe, expect, test } from "bun:test"
import { tokenStatus, toolError, VERIFY_USER_PATH } from "../cloudflare/client.fixtures"
import { fail, ok } from "../cloudflare/testing"
import { invoke } from "../tool"
import {
  CTX,
  DATABASE_ID,
  DATABASE_NAME,
  DATABASE_PATH,
  DELETE_ARGS,
  QUERY_PATH,
  calls,
  deleteFor,
  schemaReply,
  sent,
} from "./write.fixtures"

const REFUSAL_RULE = "only a database without tables is deleted here; drop them first."

describe("cloudflareStorageDelete: a D1 database", () => {
  test("is empty when the schema holds no table, whatever indexes, views or triggers it has", async () => {
    const { tool, requests } = deleteFor({
      method: "POST",
      path: QUERY_PATH,
      reply: ok([
        {
          success: true,
          results: [
            { type: "index", name: "idx", tbl_name: "gone", sql: null },
            { type: "view", name: "v", tbl_name: "v", sql: "CREATE VIEW v" },
            { type: "trigger", name: "t", tbl_name: "gone", sql: "CREATE TRIGGER t" },
          ],
        },
      ]),
    })

    const result = await invoke(tool, DELETE_ARGS.d1, CTX)

    expect(result.deleted).toEqual({ kind: "d1", name: DATABASE_NAME, id: DATABASE_ID })
    expect(sent(requests, "DELETE")).toHaveLength(1)
  })

  test("a database holding tables is refused, naming them, and nothing is deleted", async () => {
    const { tool, requests } = deleteFor({
      method: "POST",
      path: QUERY_PATH,
      reply: schemaReply("users", "orders"),
    })

    const error = await toolError(invoke(tool, DELETE_ARGS.d1, CTX))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toBe(`D1 database ${DATABASE_NAME} still holds tables (users, orders): ${REFUSAL_RULE}`)
    expect(calls(requests)).toEqual([`GET ${DATABASE_PATH}`, `POST ${QUERY_PATH}`])
  })

  test("names ten tables as they are, and more than ten with an ellipsis", async () => {
    const names = Array.from({ length: 11 }, (_, index) => `t${index + 1}`)
    const ten = deleteFor({ method: "POST", path: QUERY_PATH, reply: schemaReply(...names.slice(0, 10)) })
    const eleven = deleteFor({ method: "POST", path: QUERY_PATH, reply: schemaReply(...names) })

    expect((await toolError(invoke(ten.tool, DELETE_ARGS.d1, CTX))).message).toContain(
      `tables (${names.slice(0, 10).join(", ")}):`,
    )
    expect((await toolError(invoke(eleven.tool, DELETE_ARGS.d1, CTX))).message).toContain(
      `tables (${names.slice(0, 10).join(", ")}, …):`,
    )
  })

  test.each([ok(null), ok([]), ok([{ success: false, results: [] }]), ok([{ success: true }])])(
    "refuses a schema reply it cannot read, so the database is not proven empty",
    async (reply) => {
      const { tool, requests } = deleteFor({ method: "POST", path: QUERY_PATH, reply })

      expect((await toolError(invoke(tool, DELETE_ARGS.d1, CTX))).code).toBe("upstream_error")
      expect(sent(requests, "DELETE")).toHaveLength(0)
    },
  )

  test("a failed schema query is thrown as it is, with no write note", async () => {
    const { tool, requests } = deleteFor({
      method: "POST",
      path: QUERY_PATH,
      reply: fail(500, [{ code: 1000, message: "Boom" }]),
    })

    const error = await toolError(invoke(tool, DELETE_ARGS.d1, CTX))

    expect(error.message).toBe("Cloudflare answered HTTP 500: 1000: Boom")
    expect(sent(requests, "DELETE")).toHaveLength(0)
  })

  test("a forbidden schema query names the Edit permission", async () => {
    const { tool } = deleteFor(
      { method: "GET", path: VERIFY_USER_PATH, reply: tokenStatus("active") },
      { method: "POST", path: QUERY_PATH, reply: fail(403, [{ code: 10000, message: "Denied" }]) },
    )

    const error = await toolError(invoke(tool, DELETE_ARGS.d1, CTX))

    expect(error.code).toBe("forbidden")
    expect(error.message).toEndWith("The token needs Account → D1 → Edit.")
  })
})
