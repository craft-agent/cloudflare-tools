import { describe, expect, test } from "bun:test"
import { fail, ok, type FakeRoute } from "../cloudflare/testing"
import { callDescription } from "../describe"
import { describing, refusing } from "../describe.fixtures"
import type { ErrorCode } from "../errors"
import type { CallFact } from "../tool"
import {
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
  schemaReply,
  sent,
} from "./write.fixtures"

const CONTENTS = { label: "Contents", value: { text: "empty, as checked just now" } }
const EFFECT = { label: "Effect", value: { text: "deleting it is for good" } }

const KINDS: {
  args: object
  text: string
  name: string
  facts: CallFact[]
  reads: string[]
}[] = [
  {
    args: DELETE_ARGS.r2,
    text: "About to delete the R2 bucket {name}",
    name: BUCKET_NAME,
    facts: [CONTENTS, EFFECT],
    reads: [`GET ${BUCKET_PATH}`, `GET ${OBJECTS_PATH}`],
  },
  {
    args: DELETE_ARGS.kv,
    text: "About to delete the KV namespace {name}",
    name: NAMESPACE_TITLE,
    facts: [CONTENTS, EFFECT],
    reads: [`GET ${NAMESPACE_PATH}`, `GET ${KEYS_PATH}`],
  },
  {
    args: DELETE_ARGS.d1,
    text: "About to delete the D1 database {name}",
    name: DATABASE_NAME,
    facts: [CONTENTS, EFFECT],
    reads: [`GET ${DATABASE_PATH}`, `POST ${QUERY_PATH}`],
  },
]

describe("cloudflareStorageDelete: describe", () => {
  test("states its intent", () => {
    expect(deleteFor().tool.intent).toBe("About to delete an empty store")
  })

  test.each(KINDS)("$args.kind: names the store and what it was proven, and only reads", async (kind) => {
    const { tool, requests } = deleteFor()

    const { description, asked } = await describing(tool, kind.args)

    expect(description).toEqual({
      headline: { text: kind.text, values: { name: kind.name } },
      facts: kind.facts,
    })
    expect(asked).toEqual([])
    expect(calls(requests)).toEqual(kind.reads)
  })

  test("a namespace without a title is named by its id", async () => {
    const { tool } = deleteFor({ method: "GET", path: NAMESPACE_PATH, reply: ok({ id: NAMESPACE_ID }) })

    const { description } = await describing(tool, DELETE_ARGS.kv)

    expect(description.headline!.values).toEqual({ name: NAMESPACE_ID })
  })

  test("a store is named as Cloudflare reports it, not as the call gave its key", async () => {
    const { tool } = deleteFor({
      method: "GET",
      path: DATABASE_PATH,
      reply: ok({ uuid: DATABASE_ID, name: "renamed-db", file_size: 12288 }),
    })

    const { description } = await describing(tool, DELETE_ARGS.d1)

    expect(description.headline!.values).toEqual({ name: "renamed-db" })
  })

  test("proves the store empty once, as execute does before it asks", async () => {
    const { tool, requests } = deleteFor()

    await describing(tool, DELETE_ARGS.kv)

    expect(requests.filter((request) => request.path === KEYS_PATH)).toHaveLength(1)
  })

  test.each(KINDS)("$args.kind: gives the same description twice", async (kind) => {
    const { tool } = deleteFor()

    const first = await describing(tool, kind.args)
    const second = await describing(tool, kind.args)

    expect(second.description).toEqual(first.description)
  })

  test.each(KINDS)("$args.kind: is accepted by the description check", async (kind) => {
    const { tool } = deleteFor()

    const answer = await callDescription(tool, kind.args, CTX)

    expect(answer?.headline).toEqual({ text: kind.text, values: { name: kind.name } })
    expect(answer?.facts).toEqual(kind.facts)
    expect(answer?.pins).toBeUndefined()
  })
})

describe("cloudflareStorageDelete: describe refuses where execute would", () => {
  const NOT_FOUND = fail(404, [{ code: 10006, message: "The specified store does not exist" }])

  test.each<[string, object, FakeRoute[], ErrorCode, string, string[]]>([
    ["no key for the kind", { kind: "r2" }, [], "invalid_argument", 'Kind "r2" requires `bucket`.', []],
    [
      "a key of another kind",
      { kind: "kv", namespace: NAMESPACE_ID, bucket: BUCKET_NAME },
      [],
      "invalid_argument",
      'Kind "kv" takes `namespace`, not `bucket`.',
      [],
    ],
    [
      "an r2 bucket that does not exist",
      DELETE_ARGS.r2,
      [{ method: "GET", path: BUCKET_PATH, reply: NOT_FOUND }],
      "not_found",
      "The specified store does not exist",
      [`GET ${BUCKET_PATH}`],
    ],
    [
      "a kv namespace that does not exist",
      DELETE_ARGS.kv,
      [{ method: "GET", path: NAMESPACE_PATH, reply: NOT_FOUND }],
      "not_found",
      "The specified store does not exist",
      [`GET ${NAMESPACE_PATH}`],
    ],
    [
      "a d1 database that does not exist",
      DELETE_ARGS.d1,
      [{ method: "GET", path: DATABASE_PATH, reply: NOT_FOUND }],
      "not_found",
      "The specified store does not exist",
      [`GET ${DATABASE_PATH}`],
    ],
    [
      "an r2 bucket that holds an object",
      DELETE_ARGS.r2,
      [{ method: "GET", path: OBJECTS_PATH, reply: ok([{ key: "a" }], { is_truncated: false }) }],
      "invalid_argument",
      `R2 bucket ${BUCKET_NAME} still holds objects`,
      [`GET ${BUCKET_PATH}`, `GET ${OBJECTS_PATH}`],
    ],
    [
      "a kv namespace that holds a key",
      DELETE_ARGS.kv,
      [{ method: "GET", path: KEYS_PATH, reply: ok([{ name: "a" }], { cursor: "" }) }],
      "invalid_argument",
      `KV namespace ${NAMESPACE_TITLE} (${NAMESPACE_ID}) still holds keys`,
      [`GET ${NAMESPACE_PATH}`, `GET ${KEYS_PATH}`],
    ],
    [
      "a d1 database that holds a table",
      DELETE_ARGS.d1,
      [{ method: "POST", path: QUERY_PATH, reply: schemaReply("users") }],
      "invalid_argument",
      `D1 database ${DATABASE_NAME} still holds tables (users)`,
      [`GET ${DATABASE_PATH}`, `POST ${QUERY_PATH}`],
    ],
  ])("throws for %s, and deletes and asks nothing", async (_what, args, routes, code, message, reads) => {
    const { tool, requests } = deleteFor(...routes)

    const { error, asked } = await refusing(tool, args)

    expect(error.code).toBe(code)
    expect(error.message).toContain(message)
    expect(asked).toEqual([])
    expect(calls(requests)).toEqual(reads)
    expect(sent(requests, "DELETE")).toHaveLength(0)
  })

  test("gives nothing to the description check for a call execute would refuse", async () => {
    const { tool } = deleteFor({ method: "GET", path: KEYS_PATH, reply: ok([{ name: "a" }], { cursor: "" }) })

    expect(await callDescription(tool, DELETE_ARGS.kv, CTX)).toBeUndefined()
  })
})
