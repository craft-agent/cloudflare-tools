import { describe, expect, test } from "bun:test"
import { callDescription } from "../describe"
import { describing, refusing } from "../describe.fixtures"
import { BUCKET_NAME, CTX, DATABASE_NAME, NAMESPACE_TITLE, createFor } from "./write.fixtures"

const R2_ARGS = { kind: "r2", name: BUCKET_NAME } as const
const KV_ARGS = { kind: "kv", name: NAMESPACE_TITLE } as const
const D1_ARGS = { kind: "d1", name: DATABASE_NAME } as const

describe("cloudflareStorageCreate: describe", () => {
  test("states its intent", () => {
    expect(createFor().tool.intent).toBe("About to create a store")
  })

  test.each([
    ["r2", R2_ARGS, "About to create the R2 bucket {name}", BUCKET_NAME],
    ["kv", KV_ARGS, "About to create the KV namespace {name}", NAMESPACE_TITLE],
    ["d1", D1_ARGS, "About to create the D1 database {name}", DATABASE_NAME],
  ])(
    "%s: names the store to create, with no fact and no pin, and sends no request",
    async (_kind, args, text, name) => {
      const { tool, requests } = createFor()

      const { description, asked } = await describing(tool, args)

      expect(description).toEqual({ headline: { text, values: { name } }, facts: [] })
      expect(asked).toEqual([])
      expect(requests).toEqual([])
    },
  )

  test("gives the same description twice", async () => {
    const { tool } = createFor()

    const first = await describing(tool, KV_ARGS)
    const second = await describing(tool, KV_ARGS)

    expect(second.description).toEqual(first.description)
  })

  test("is accepted by the description check", async () => {
    const { tool } = createFor()

    for (const args of [R2_ARGS, KV_ARGS, D1_ARGS]) {
      const answer = await callDescription(tool, args, CTX)

      expect(answer?.headline?.values).toEqual({ name: args.name })
      expect(answer?.facts).toEqual([])
      expect(answer?.pins).toBeUndefined()
    }
  })
})

describe("cloudflareStorageCreate: describe refuses where execute would", () => {
  test.each([
    ["an r2 bucket name with a capital", { kind: "r2", name: "Bad Bucket" }, "R2 bucket"],
    ["an r2 bucket name that is too short", { kind: "r2", name: "ab" }, "R2 bucket"],
    ["an empty kv title", { kind: "kv", name: "" }, "KV namespace"],
    ["a kv title on two lines", { kind: "kv", name: "a\nb" }, "KV namespace"],
    ["a kv title over 512 characters", { kind: "kv", name: "x".repeat(513) }, "KV namespace"],
    ["a d1 database name with a capital", { kind: "d1", name: "Bad_Name" }, "D1 database"],
  ])("throws for %s, and sends and asks nothing", async (_what, args, noun) => {
    const { tool, requests } = createFor()

    const { error, asked } = await refusing(tool, args)

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toStartWith(`\`name\` of a ${noun} must be `)
    expect(asked).toEqual([])
    expect(requests).toEqual([])
  })

  test("gives nothing to the description check for a call execute would refuse", async () => {
    const { tool } = createFor()

    expect(await callDescription(tool, { kind: "r2", name: "Bad Bucket" }, CTX)).toBeUndefined()
  })
})
