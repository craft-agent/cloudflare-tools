import { describe, expect, test } from "bun:test"
import { rejection, tokenStatus, toolError, VERIFY_USER_PATH } from "../cloudflare/client.fixtures"
import { fail, ok } from "../cloudflare/testing"
import { writeTargets } from "../targets"
import { annotations, invoke, toolMeta } from "../tool"
import { cloudflareStorageCreate } from "./create"
import {
  ACCOUNT_ID,
  BUCKETS_PATH,
  BUCKET_NAME,
  CTX,
  DATABASES_PATH,
  DATABASE_ID,
  DATABASE_NAME,
  NAMESPACES_PATH,
  NAMESPACE_ID,
  NAMESPACE_TITLE,
  createFor,
  refusalOf,
} from "./write.fixtures"

const R2_ARGS = { kind: "r2", name: BUCKET_NAME } as const
const KV_ARGS = { kind: "kv", name: NAMESPACE_TITLE } as const
const D1_ARGS = { kind: "d1", name: DATABASE_NAME } as const

describe("cloudflareStorageCreate", () => {
  test("is an add tool of the storage toolset", () => {
    expect(annotations(cloudflareStorageCreate)).toEqual({
      title: "Create a Cloudflare R2 bucket, KV namespace or D1 database",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    })
    expect(toolMeta(cloudflareStorageCreate)).toBeUndefined()
    expect(cloudflareStorageCreate.id).toBe("cloudflare_storage_create")
    expect(cloudflareStorageCreate.toolset).toBe("storage")
  })

  test("r2: sends one POST with the name only and returns the name as the id", async () => {
    const { tool, requests } = createFor({ method: "POST", path: BUCKETS_PATH, reply: ok({ name: BUCKET_NAME }) })

    const result = await invoke(tool, R2_ARGS, CTX)

    expect(result).toEqual({ label: "default", created: { kind: "r2", name: BUCKET_NAME, id: BUCKET_NAME } })
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ method: "POST", path: BUCKETS_PATH, body: { name: BUCKET_NAME } })
    expect(requests[0]!.query.size).toBe(0)
    expect(Object.keys(requests[0]!.headers).filter((header) => header.startsWith("cf-"))).toEqual([])
  })

  test("kv: sends the name as the title and returns Cloudflare's id", async () => {
    const { tool, requests } = createFor({
      method: "POST",
      path: NAMESPACES_PATH,
      reply: ok({ id: NAMESPACE_ID, title: NAMESPACE_TITLE }),
    })

    const result = await invoke(tool, KV_ARGS, CTX)

    expect(result).toEqual({ label: "default", created: { kind: "kv", name: NAMESPACE_TITLE, id: NAMESPACE_ID } })
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ method: "POST", path: NAMESPACES_PATH, body: { title: NAMESPACE_TITLE } })
  })

  test("d1: sends the name only and returns the database's uuid", async () => {
    const { tool, requests } = createFor({
      method: "POST",
      path: DATABASES_PATH,
      reply: ok({ uuid: DATABASE_ID, name: DATABASE_NAME, created_at: "2024-01-01T00:00:00Z" }),
    })

    const result = await invoke(tool, D1_ARGS, CTX)

    expect(result).toEqual({ label: "default", created: { kind: "d1", name: DATABASE_NAME, id: DATABASE_ID } })
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ method: "POST", path: DATABASES_PATH, body: { name: DATABASE_NAME } })
  })

  test.each([
    ["kv", KV_ARGS, NAMESPACES_PATH, "namespaces", "KV namespace"],
    ["d1", D1_ARGS, DATABASES_PATH, "databases", "D1 database"],
  ] as const)(
    "%s: keeps the created store with id null and an error when the reply lacks the id",
    async (_kind, args, path, method, noun) => {
      const { tool } = createFor({ method: "POST", path, reply: ok({}) })

      const result = await invoke(tool, args, CTX)

      expect(result.created).toEqual({ kind: args.kind, name: args.name, id: null })
      expect(result.errors).toEqual({
        id: `upstream_error: Cloudflare created the ${noun} ${args.name} but its reply lacked the id; read cloudflare_storage_read ${method} to find it.`,
      })
    },
  )

  test.each([ok(null), ok("x"), ok({ id: "" }), ok({ id: 5 })])(
    "kv: a reply without a usable id keeps the store",
    async (reply) => {
      const { tool } = createFor({ method: "POST", path: NAMESPACES_PATH, reply })

      const result = await invoke(tool, KV_ARGS, CTX)

      expect(result.created.id).toBeNull()
      expect(Object.keys(result.errors ?? {})).toEqual(["id"])
    },
  )
})

describe("cloudflareStorageCreate: arguments", () => {
  test.each([
    ["r2", "ab", "3–63 lowercase letters"],
    ["r2", "My-Bucket", "3–63 lowercase letters"],
    ["r2", "-bucket", "starting and ending with a letter or digit"],
    ["r2", "a".repeat(64), "3–63 lowercase letters"],
    ["kv", "", "1–512 characters on one line"],
    ["kv", "x".repeat(513), "1–512 characters on one line"],
    ["kv", "two\nlines", "1–512 characters on one line"],
    ["kv", "tab\there", "1–512 characters on one line"],
    ["d1", "My-DB", "1–63 lowercase letters, digits, `-` and `_`"],
    ["d1", "_db", "starting with a letter or digit"],
    ["d1", "a".repeat(64), "1–63 lowercase letters"],
    ["d1", "", "1–63 lowercase letters"],
  ] as const)("refuses the %s name %j, saying the rule, before any request", async (kind, name, rule) => {
    const { tool, requests } = createFor()

    expect(await refusalOf(invoke(tool, { kind, name }, CTX))).toContain(rule)
    expect(requests).toEqual([])
  })

  test("accepts the longest and the oddest names the rules allow", async () => {
    const { tool } = createFor(
      { method: "POST", path: NAMESPACES_PATH, reply: ok({ id: NAMESPACE_ID }) },
      { method: "POST", path: DATABASES_PATH, reply: ok({ uuid: DATABASE_ID }) },
      { method: "POST", path: BUCKETS_PATH, reply: ok({}) },
    )

    await invoke(tool, { kind: "kv", name: "ü ".repeat(256) }, CTX)
    await invoke(tool, { kind: "d1", name: `0${"_-".repeat(31)}` }, CTX)
    await invoke(tool, { kind: "r2", name: "a".repeat(63) }, CTX)
  })

  test.each([
    ["a location hint", { ...R2_ARGS, location: "weur" }],
    ["a jurisdiction", { ...KV_ARGS, jurisdiction: "eu" }],
    ["a storage class", { ...R2_ARGS, storage_class: "InfrequentAccess" }],
    ["an unknown kind", { kind: "queue", name: "abc" }],
    ["no name", { kind: "r2" }],
  ])("refuses %s", async (_what, args) => {
    const { tool, requests } = createFor()

    expect((await toolError(invoke(tool, args, CTX))).code).toBe("invalid_argument")
    expect(requests).toEqual([])
  })
})

describe("cloudflareStorageCreate: targets", () => {
  test.each([
    [R2_ARGS, `${ACCOUNT_ID}/r2/buckets/${BUCKET_NAME}`],
    [KV_ARGS, `${ACCOUNT_ID}/kv/namespaces/${NAMESPACE_TITLE}`],
    [D1_ARGS, `${ACCOUNT_ID}/d1/databases/${DATABASE_NAME}`],
  ])("name the account and the store to be created, without any request", async (args, target) => {
    const { tool, requests } = createFor()

    expect(await writeTargets(tool, args, CTX)).toEqual([target])
    expect(requests).toEqual([])
  })

  test("are `*` for an invalid name or a name holding a wildcard", async () => {
    const { tool } = createFor()

    expect(await tool.targets!({ kind: "r2", name: "Bad Name" }, CTX)).toEqual(["*"])
    expect(await tool.targets!({ kind: "kv", name: "all?" }, CTX)).toEqual([`${ACCOUNT_ID}/kv/namespaces/all?`])
    expect(await writeTargets(tool, { kind: "kv", name: "all?" }, CTX)).toEqual(["*"])
  })
})

describe("cloudflareStorageCreate: failures", () => {
  test("a refused name says nothing was created", async () => {
    const taken = fail(409, [{ code: 10004, message: "The bucket you tried to create already exists" }])
    const { tool } = createFor({ method: "POST", path: BUCKETS_PATH, reply: taken })

    const error = await toolError(invoke(tool, R2_ARGS, CTX))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe(
      "Cloudflare answered HTTP 409: 10004: The bucket you tried to create already exists. Nothing was created.",
    )
  })

  test("Cloudflare's 400 for a bad name is invalid_argument with the nothing note", async () => {
    const { tool } = createFor({
      method: "POST",
      path: NAMESPACES_PATH,
      reply: fail(400, [{ code: 10014, message: "Invalid title" }]),
    })

    const error = await toolError(invoke(tool, KV_ARGS, CTX))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toEndWith("Invalid title. Nothing was created.")
  })

  test.each([
    ["r2", R2_ARGS, BUCKETS_PATH, "buckets"],
    ["kv", KV_ARGS, NAMESPACES_PATH, "namespaces"],
    ["d1", D1_ARGS, DATABASES_PATH, "databases"],
  ] as const)(
    "a %s failure that does not tell says Cloudflare may have created it",
    async (_kind, args, path, method) => {
      const { tool } = createFor({ method: "POST", path, reply: fail(502, [{ code: 1000, message: "Bad gateway" }]) })

      const error = await toolError(invoke(tool, args, CTX))

      expect(error.code).toBe("upstream_error")
      expect(error.message).toEndWith(
        `Cloudflare may or may not have created it; read cloudflare_storage_read ${method} before sending it again.`,
      )
      expect(error.message).not.toContain("Nothing was created")
    },
  )

  test.each([
    ["r2", R2_ARGS, BUCKETS_PATH, "Workers R2 Storage"],
    ["kv", KV_ARGS, NAMESPACES_PATH, "Workers KV Storage"],
    ["d1", D1_ARGS, DATABASES_PATH, "D1"],
  ] as const)(
    "a forbidden %s create names the Edit permission, then the nothing note",
    async (_kind, args, path, product) => {
      const { tool } = createFor(
        { method: "GET", path: VERIFY_USER_PATH, reply: tokenStatus("active") },
        { method: "POST", path, reply: fail(403, [{ code: 10000, message: "Authentication error" }]) },
      )

      const error = await toolError(invoke(tool, args, CTX))

      expect(error.code).toBe("forbidden")
      expect(error.message).toEndWith(
        `Authentication error (the token is active but lacks a permission this call needs). The token needs Account → ${product} → Edit. Nothing was created.`,
      )
    },
  )

  test("a cancellation passes untouched", async () => {
    const controller = new AbortController()
    const { tool } = createFor({
      method: "POST",
      path: BUCKETS_PATH,
      reply: () => {
        controller.abort()
        return ok({})
      },
    })

    const error = await rejection(invoke(tool, R2_ARGS, { ...CTX, signal: controller.signal }))

    expect((error as Error).name).toBe("AbortError")
  })
})
