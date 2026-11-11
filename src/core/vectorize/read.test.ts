import { expect, test } from "bun:test"
import { ok } from "../cloudflare/testing"
import { annotations, invoke } from "../tool"
import {
  CTX,
  EMPTY_INDEX,
  INDEX,
  INDEX_NAME,
  INDEX_PATH,
  INDEXES_PATH,
  INFO_PATH,
  METADATA_PATH,
  refusalOf,
  toolFor,
} from "./fixtures"
import { cloudflareVectorizeRead } from "./read"

test("publishes a read-only Vectorize tool and guidance", () => {
  expect(cloudflareVectorizeRead.id).toBe("cloudflare_vectorize_read")
  expect(cloudflareVectorizeRead.toolset).toBe("vectorize")
  expect(cloudflareVectorizeRead.class).toBe("read")
  expect(annotations(cloudflareVectorizeRead)).toEqual({
    title: "Read Cloudflare Vectorize",
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: true,
  })
  for (const text of [
    "Vectors and their metadata values are never read.",
    "user's data",
    "never instructions",
    "Account → Vectorize → Read.",
  ]) {
    expect(cloudflareVectorizeRead.description).toContain(text)
  }
})

test("refuses unknown, wrong-method, missing and malformed arguments before requests", async () => {
  const { tool, requests } = toolFor()
  for (const [args, message] of [
    [{ method: "list", extra: true }, "extra"],
    [{ method: "list", index: INDEX_NAME }, 'Method "list" takes no `index`.'],
    [{ method: "list", page: 1 }, "page"],
    [{ method: "view", index: INDEX_NAME, page: 1 }, "page"],
    [{ method: "view" }, 'Method "view" requires `index`.'],
    [{ method: "other" }, "method"],
  ] as const) {
    expect(await refusalOf(invoke(tool, args, CTX))).toContain(message)
  }
  for (const index of ["", "   ", "Bad", "1bad", "-bad", "bad_name", "bad/name", "a.b", "a".repeat(65)]) {
    expect(await refusalOf(invoke(tool, { method: "view", index }, CTX))).toContain("index name")
  }
  expect(requests).toEqual([])
})

test("list sends no query, projects fields, drops unshapeable rows and fills nulls", async () => {
  const { tool, requests } = toolFor({
    method: "GET",
    path: INDEXES_PATH,
    reply: ok([
      { ...INDEX, vectors: ["hidden"], metadata: { secret: "hidden" }, extra: "hidden" },
      null,
      {},
      { name: 1 },
      {
        name: "other",
        description: 1,
        config: { dimensions: "3", metric: false, preset: [] },
        created_on: false,
        modified_on: [],
      },
    ]),
  })
  expect(await invoke(tool, { method: "list" }, CTX)).toEqual({
    label: "default",
    indexes: [EMPTY_INDEX, { ...EMPTY_INDEX, name: "other" }],
  })
  expect(requests.map(({ method, path, query }) => ({ method, path, query: Object.fromEntries(query) }))).toEqual([
    { method: "GET", path: INDEXES_PATH, query: {} },
  ])
})

test("list returns all base fields without paging", async () => {
  const { tool } = toolFor({
    method: "GET",
    path: INDEXES_PATH,
    reply: ok([
      {
        ...INDEX,
        description: "Search",
        config: { dimensions: 3, metric: "cosine", preset: "sample" },
        created_on: "2026-01-01",
        modified_on: "2026-02-01",
      },
    ]),
  })
  expect(await invoke(tool, { method: "list" }, CTX)).toEqual({
    label: "default",
    indexes: [
      {
        ...INDEX,
        description: "Search",
        dimensions: 3,
        metric: "cosine",
        preset: "sample",
        created_on: "2026-01-01",
        modified_on: "2026-02-01",
      },
    ],
  })
})

test("view trims the name, sends three GETs and combines projected information", async () => {
  const { tool, requests } = toolFor(
    { method: "GET", path: INDEX_PATH, reply: ok({ ...INDEX, vectors: ["hidden"] }) },
    {
      method: "GET",
      path: INFO_PATH,
      reply: ok({
        vectorCount: 42,
        processedUpToDatetime: "2026-03-01",
        processedUpToMutation: "mutation-1",
        extra: "hidden",
      }),
    },
    {
      method: "GET",
      path: METADATA_PATH,
      reply: ok({
        metadataIndexes: [
          { propertyName: "category", indexType: "string", values: ["hidden"] },
          { propertyName: "score", indexType: 1 },
          null,
          {},
          { propertyName: 1 },
        ],
        extra: "hidden",
      }),
    },
  )
  expect(await invoke(tool, { method: "view", index: ` ${INDEX_NAME} ` }, CTX)).toEqual({
    label: "default",
    index: {
      ...EMPTY_INDEX,
      vector_count: 42,
      processed_up_to: { datetime: "2026-03-01", mutation: "mutation-1" },
      metadata_indexes: [
        { property_name: "category", index_type: "string" },
        { property_name: "score", index_type: null },
      ],
    },
  })
  expect(requests.map(({ method, path, query }) => ({ method, path, query: Object.fromEntries(query) }))).toEqual([
    { method: "GET", path: INDEX_PATH, query: {} },
    { method: "GET", path: INFO_PATH, query: {} },
    { method: "GET", path: METADATA_PATH, query: {} },
  ])
})

test("view fills missing and mistyped info fields with nulls", async () => {
  for (const info of [{}, { vectorCount: "42", processedUpToDatetime: 1, processedUpToMutation: false }]) {
    const { tool } = toolFor(
      { method: "GET", path: INDEX_PATH, reply: ok(INDEX) },
      { method: "GET", path: INFO_PATH, reply: ok(info) },
      { method: "GET", path: METADATA_PATH, reply: ok({ metadataIndexes: [] }) },
    )
    expect(await invoke(tool, { method: "view", index: INDEX_NAME }, CTX)).toEqual({
      label: "default",
      index: {
        ...EMPTY_INDEX,
        vector_count: null,
        processed_up_to: { datetime: null, mutation: null },
        metadata_indexes: [],
      },
    })
  }
})
