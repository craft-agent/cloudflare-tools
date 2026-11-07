import { describe, expect, test } from "bun:test"
import { tokenStatus, toolError, VERIFY_USER_PATH } from "../cloudflare/client.fixtures"
import { D1_SCHEMA_SQL } from "../cloudflare/routes"
import { fail, ok } from "../cloudflare/testing"
import { writeTargets } from "../targets"
import { annotations, invoke, REQUIRES_USER_INTERACTION, toolMeta, type ConfirmRequest } from "../tool"
import { cloudflareStorageDelete } from "./delete"
import {
  ACCOUNT_ID,
  BUCKET_NAME,
  BUCKET_PATH,
  CTX,
  DATABASE_ID,
  DATABASE_NAME,
  DATABASE_PATH,
  DELETE_ARGS,
  KEYS_PATH,
  NAMESPACE_ID,
  NAMESPACE_PATH,
  NAMESPACE_TITLE,
  OBJECTS_PATH,
  QUERY_PATH,
  calls,
  deleteFor,
  refusalOf,
  sent,
} from "./write.fixtures"

const KINDS = [
  {
    args: DELETE_ARGS.r2,
    path: BUCKET_PATH,
    proof: `GET ${OBJECTS_PATH}`,
    deleted: { kind: "r2", name: BUCKET_NAME, id: BUCKET_NAME },
    ask: `Delete R2 bucket ${BUCKET_NAME} in the Cloudflare account default. It was found empty, and deleting it is for good.`,
  },
  {
    args: DELETE_ARGS.kv,
    path: NAMESPACE_PATH,
    proof: `GET ${KEYS_PATH}`,
    deleted: { kind: "kv", name: NAMESPACE_TITLE, id: NAMESPACE_ID },
    ask: `Delete KV namespace ${NAMESPACE_TITLE} (${NAMESPACE_ID}) in the Cloudflare account default. It was found empty, and deleting it is for good.`,
  },
  {
    args: DELETE_ARGS.d1,
    path: DATABASE_PATH,
    proof: `POST ${QUERY_PATH}`,
    deleted: { kind: "d1", name: DATABASE_NAME, id: DATABASE_ID },
    ask: `Delete D1 database ${DATABASE_NAME} (${DATABASE_ID}) in the Cloudflare account default. It was found empty, and deleting it is for good.`,
  },
] as const

describe("cloudflareStorageDelete", () => {
  test("has the administrative annotations, the interaction meta and the storage toolset", () => {
    expect(annotations(cloudflareStorageDelete)).toEqual({
      title: "Delete an empty Cloudflare R2 bucket, KV namespace or D1 database",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    })
    expect(toolMeta(cloudflareStorageDelete)).toEqual({ [REQUIRES_USER_INTERACTION]: true })
    expect(cloudflareStorageDelete.id).toBe("cloudflare_storage_delete")
    expect(cloudflareStorageDelete.toolset).toBe("storage")
  })

  test.each(KINDS)("$args.kind: reads the store, proves it empty, then sends one DELETE", async (kind) => {
    const { tool, requests } = deleteFor()

    const result = await invoke(tool, kind.args, CTX)

    expect(result).toEqual({ label: "default", deleted: kind.deleted })
    expect(calls(requests)).toEqual([`GET ${kind.path}`, kind.proof, `DELETE ${kind.path}`])
    expect(requests.at(-1)!.body).toBeUndefined()
  })

  test("d1: the proof sends the fixed schema statement and nothing else", async () => {
    const { tool, requests } = deleteFor()

    await invoke(tool, DELETE_ARGS.d1, CTX)

    expect(requests[1]!.body).toEqual({ sql: D1_SCHEMA_SQL })
  })

  test("a store Cloudflare reports without a name is named by its id", async () => {
    const { tool } = deleteFor({ method: "GET", path: NAMESPACE_PATH, reply: ok({ id: NAMESPACE_ID }) })

    const result = await invoke(tool, DELETE_ARGS.kv, CTX)

    expect(result.deleted).toEqual({ kind: "kv", name: null, id: NAMESPACE_ID })
  })
})

describe("cloudflareStorageDelete: confirmation", () => {
  test.each(KINDS)("$args.kind: asks after the proof and before the DELETE, with one plain line", async (kind) => {
    const asked: ConfirmRequest[] = []
    const seen: string[][] = []
    const { tool, requests } = deleteFor()

    await invoke(tool, kind.args, {
      ...CTX,
      confirm: async (request) => {
        asked.push(request)
        seen.push(calls(requests))
        return true
      },
    })

    expect(asked).toEqual([{ tool: "cloudflare_storage_delete", message: kind.ask }])
    expect(seen).toEqual([[`GET ${kind.path}`, kind.proof]])
    expect(sent(requests, "DELETE")).toHaveLength(1)
  })

  test.each(KINDS)("$args.kind: sends no DELETE when the person declines", async (kind) => {
    const { tool, requests } = deleteFor()

    const error = await toolError(invoke(tool, kind.args, { ...CTX, confirm: async () => false }))

    expect(error.code).toBe("declined")
    expect(sent(requests, "DELETE")).toHaveLength(0)
  })

  test.each(KINDS)("$args.kind: does not ask about a store that does not exist", async (kind) => {
    const asked: ConfirmRequest[] = []
    const confirm = async (request: ConfirmRequest) => (asked.push(request), true)
    const missing = deleteFor({ method: "GET", path: kind.path, reply: fail(404, [{ code: 10006, message: "Gone" }]) })

    await toolError(invoke(missing.tool, kind.args, { ...CTX, confirm }))

    expect(asked).toEqual([])
  })
})

describe("cloudflareStorageDelete: the store must exist", () => {
  test.each(KINDS)("$args.kind: a missing store is not_found, and nothing else is sent", async (kind) => {
    const { tool, requests } = deleteFor({
      method: "GET",
      path: kind.path,
      reply: fail(404, [{ code: 10006, message: "The specified store does not exist" }]),
    })

    const error = await toolError(invoke(tool, kind.args, CTX))

    expect(error.code).toBe("not_found")
    expect(error.message).toContain("The specified store does not exist")
    expect(calls(requests)).toEqual([`GET ${kind.path}`])
  })

  test.each(KINDS)("$args.kind: a reply that is not a store is upstream_error", async (kind) => {
    const { tool, requests } = deleteFor({ method: "GET", path: kind.path, reply: ok(null) })

    expect((await toolError(invoke(tool, kind.args, CTX))).code).toBe("upstream_error")
    expect(sent(requests, "DELETE")).toHaveLength(0)
  })
})

describe("cloudflareStorageDelete: arguments", () => {
  test.each([
    [{ kind: "r2" }, 'Kind "r2" requires `bucket`.'],
    [{ kind: "kv" }, 'Kind "kv" requires `namespace`.'],
    [{ kind: "d1" }, 'Kind "d1" requires `database`.'],
    [{ kind: "r2", namespace: NAMESPACE_ID }, 'Kind "r2" takes `bucket`, not `namespace`.'],
    [{ kind: "r2", bucket: BUCKET_NAME, database: DATABASE_ID }, 'Kind "r2" takes `bucket`, not `database`.'],
    [{ kind: "kv", bucket: BUCKET_NAME }, 'Kind "kv" takes `namespace`, not `bucket`.'],
    [{ kind: "kv", namespace: NAMESPACE_ID, database: DATABASE_ID }, 'Kind "kv" takes `namespace`, not `database`.'],
    [{ kind: "d1", namespace: NAMESPACE_ID }, 'Kind "d1" takes `database`, not `namespace`.'],
    [{ kind: "d1", database: DATABASE_ID, bucket: BUCKET_NAME }, 'Kind "d1" takes `database`, not `bucket`.'],
  ])("refuses %j, naming the argument the kind takes, before any request", async (args, message) => {
    const { tool, requests } = deleteFor()

    expect(await refusalOf(invoke(tool, args, CTX))).toBe(message)
    expect(requests).toEqual([])
  })

  test.each([
    { kind: "r2", bucket: "Bad Bucket" },
    { kind: "kv", namespace: "A".repeat(32) },
    { kind: "d1", database: "not-a-uuid" },
    { kind: "r2", bucket: BUCKET_NAME, name: "x" },
  ])("refuses the invalid or unknown argument in %j", async (args) => {
    const { tool, requests } = deleteFor()

    expect((await toolError(invoke(tool, args, CTX))).code).toBe("invalid_argument")
    expect(requests).toEqual([])
  })
})

describe("cloudflareStorageDelete: targets", () => {
  test.each([
    [DELETE_ARGS.r2, `${ACCOUNT_ID}/r2/buckets/${BUCKET_NAME}`],
    [DELETE_ARGS.kv, `${ACCOUNT_ID}/kv/namespaces/${NAMESPACE_ID}`],
    [DELETE_ARGS.d1, `${ACCOUNT_ID}/d1/databases/${DATABASE_ID}`],
  ])("name the account and the store without any request", async (args, target) => {
    const { tool, requests } = deleteFor()

    expect(await writeTargets(tool, args, CTX)).toEqual([target])
    expect(requests).toEqual([])
  })

  test("are `*` when the store key does not fit the kind", async () => {
    const { tool } = deleteFor()

    expect(await tool.targets!({ kind: "r2" }, CTX)).toEqual(["*"])
    expect(await tool.targets!({ kind: "kv", bucket: BUCKET_NAME }, CTX)).toEqual(["*"])
  })
})

describe("cloudflareStorageDelete: failures", () => {
  test("Cloudflare's refusal of the DELETE says nothing was deleted", async () => {
    const refusal = fail(409, [{ code: 10008, message: "The bucket you tried to delete is not empty" }])
    const { tool, requests } = deleteFor({ method: "DELETE", path: BUCKET_PATH, reply: refusal })

    const error = await toolError(invoke(tool, DELETE_ARGS.r2, CTX))

    expect(error.message).toBe(
      "Cloudflare answered HTTP 409: 10008: The bucket you tried to delete is not empty. Nothing was deleted.",
    )
    expect(sent(requests, "DELETE")).toHaveLength(1)
  })

  test.each([
    [DELETE_ARGS.r2, BUCKET_PATH, "bucket"],
    [DELETE_ARGS.kv, NAMESPACE_PATH, "namespaces"],
    [DELETE_ARGS.d1, DATABASE_PATH, "databases"],
  ])("a DELETE failure that does not tell says Cloudflare may have deleted it", async (args, path, method) => {
    const { tool } = deleteFor({ method: "DELETE", path, reply: fail(500, [{ code: 1000, message: "Boom" }]) })

    const error = await toolError(invoke(tool, args, CTX))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toEndWith(
      `Cloudflare may or may not have deleted it; read cloudflare_storage_read ${method} before sending it again.`,
    )
  })

  test.each([
    [DELETE_ARGS.r2, BUCKET_PATH, "Workers R2 Storage"],
    [DELETE_ARGS.kv, NAMESPACE_PATH, "Workers KV Storage"],
    [DELETE_ARGS.d1, DATABASE_PATH, "D1"],
  ])("a forbidden DELETE names the Edit permission, then the nothing note", async (args, path, product) => {
    const { tool } = deleteFor(
      { method: "GET", path: VERIFY_USER_PATH, reply: tokenStatus("active") },
      { method: "DELETE", path, reply: fail(403, [{ code: 10000, message: "Authentication error" }]) },
    )

    const error = await toolError(invoke(tool, args, CTX))

    expect(error.code).toBe("forbidden")
    expect(error.message).toEndWith(`The token needs Account → ${product} → Edit. Nothing was deleted.`)
  })

  test.each([
    [DELETE_ARGS.r2, BUCKET_PATH, "Workers R2 Storage"],
    [DELETE_ARGS.kv, NAMESPACE_PATH, "Workers KV Storage"],
    [DELETE_ARGS.d1, DATABASE_PATH, "D1"],
  ])("a forbidden read of the store names the Edit permission and sends no DELETE", async (args, path, product) => {
    const { tool, requests } = deleteFor(
      { method: "GET", path: VERIFY_USER_PATH, reply: tokenStatus("active") },
      { method: "GET", path, reply: fail(403, [{ code: 10000, message: "Authentication error" }]) },
    )

    const error = await toolError(invoke(tool, args, CTX))

    expect(error.code).toBe("forbidden")
    expect(error.message).toEndWith(`The token needs Account → ${product} → Edit.`)
    expect(sent(requests, "DELETE")).toHaveLength(0)
  })
})
