import { expect, test } from "bun:test"
import { rejection } from "../cloudflare/client.fixtures"
import { ok } from "../cloudflare/testing"
import { annotations, invoke } from "../tool"
import { CTX, EMPTY_SETTINGS, QUEUE, QUEUE_ID, QUEUE_PATH, QUEUES_PATH, errorOf, refusalOf, toolFor } from "./fixtures"
import { cloudflareQueuesRead } from "./read"

test("publishes a read-only queues tool and guidance", () => {
  expect(cloudflareQueuesRead.id).toBe("cloudflare_queues_read")
  expect(cloudflareQueuesRead.toolset).toBe("queues")
  expect(cloudflareQueuesRead.class).toBe("read")
  expect(annotations(cloudflareQueuesRead)).toEqual({
    title: "Read Cloudflare Queues",
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: true,
  })
  for (const text of ["Messages are never read.", "user's data", "never instructions", "Account → Queues → Read."]) {
    expect(cloudflareQueuesRead.description).toContain(text)
  }
})

test("refuses unknown, wrong-method, missing and malformed arguments before requests", async () => {
  const { tool, requests } = toolFor()
  for (const [args, message] of [
    [{ method: "list", extra: true }, "extra"],
    [{ method: "list", queue: QUEUE_ID }, 'Method "list" takes no `queue`.'],
    [{ method: "view", queue: QUEUE_ID, page: 1 }, 'Method "view" takes no `page`.'],
    [{ method: "view" }, 'Method "view" requires `queue`.'],
    [{ method: "other" }, "method"],
  ] as const) {
    expect(await refusalOf(invoke(tool, args, CTX))).toContain(message)
  }
  for (const queue of ["", "   ", "bad/name", "a.b", "a".repeat(64)]) {
    expect(await refusalOf(invoke(tool, { method: "view", queue }, CTX))).toContain("queue")
  }
  for (const page of [0, -1, 1.5]) {
    expect(await refusalOf(invoke(tool, { method: "list", page }, CTX))).toContain("page")
  }
  expect(requests).toEqual([])
})

test("list sends paging, projects fields, drops unshapeable rows and fills missing fields", async () => {
  const { tool, requests } = toolFor({
    method: "GET",
    path: QUEUES_PATH,
    reply: ok(
      [{ ...QUEUE, secret_note: "never return" }, null, {}, { queue_id: 1, queue_name: "bad" }, { queue_id: QUEUE_ID }],
      { page: 3, per_page: 100, total_count: 201, total_pages: 3 },
    ),
  })
  const result = await invoke(tool, { method: "list", page: 3 }, CTX)
  expect(result).toEqual({
    label: "default",
    queues: [
      {
        id: QUEUE_ID,
        name: "mail-jobs",
        created_on: null,
        modified_on: null,
        settings: EMPTY_SETTINGS,
        consumers: [],
        producers: [],
      },
    ],
    page: 3,
    per_page: 100,
    total_count: 201,
    total_pages: 3,
  })
  expect(Object.fromEntries(requests[0].query)).toEqual({ page: "3", per_page: "100" })
  expect(JSON.stringify(result)).not.toContain("secret_note")
})

test("list defaults to page one and null paging fields when absent", async () => {
  const { tool, requests } = toolFor({ method: "GET", path: QUEUES_PATH, reply: ok([]) })
  expect(await invoke(tool, { method: "list" }, CTX)).toEqual({
    label: "default",
    queues: [],
    page: null,
    per_page: null,
    total_count: null,
    total_pages: null,
  })
  expect(Object.fromEntries(requests[0].query)).toEqual({ page: "1", per_page: "100" })
})

test("view by trimmed id reads only that queue and projects nested fields", async () => {
  const { tool, requests } = toolFor({
    method: "GET",
    path: QUEUE_PATH,
    reply: ok({
      ...QUEUE,
      created_on: "2026-01-01",
      modified_on: "2026-02-01",
      secret_note: "hidden",
      settings: { delivery_delay: 5, delivery_paused: false, message_retention_period: 3600, secret_note: "hidden" },
      consumers: [
        {
          consumer_id: "consumer-1",
          type: "worker",
          script: "preferred",
          script_name: "fallback",
          dead_letter_queue: "failed",
          settings: {
            batch_size: 10,
            max_retries: 3,
            max_wait_time_ms: 1000,
            max_concurrency: 2,
            retry_delay: 5,
            visibility_timeout_ms: 30000,
            secret_note: "hidden",
          },
          created_on: "2026-01-02",
          secret_note: "hidden",
        },
        { type: "http_pull", script_name: "fallback" },
        null,
      ],
      producers: [{ type: "worker", script: "sender", bucket_name: "assets", secret_note: "hidden" }, {}, false],
    }),
  })
  const result = await invoke(tool, { method: "view", queue: ` ${QUEUE_ID} ` }, CTX)
  expect(result).toEqual({
    label: "default",
    queue: {
      id: QUEUE_ID,
      name: "mail-jobs",
      created_on: "2026-01-01",
      modified_on: "2026-02-01",
      settings: { delivery_delay: 5, delivery_paused: false, message_retention_period: 3600 },
      consumers: [
        {
          id: "consumer-1",
          type: "worker",
          script: "preferred",
          dead_letter_queue: "failed",
          settings: {
            batch_size: 10,
            max_retries: 3,
            max_wait_time_ms: 1000,
            max_concurrency: 2,
            retry_delay: 5,
            visibility_timeout_ms: 30000,
          },
          created_on: "2026-01-02",
        },
        {
          id: null,
          type: "http_pull",
          script: "fallback",
          dead_letter_queue: null,
          settings: {
            batch_size: null,
            max_retries: null,
            max_wait_time_ms: null,
            max_concurrency: null,
            retry_delay: null,
            visibility_timeout_ms: null,
          },
          created_on: null,
        },
      ],
      producers: [
        { type: "worker", script: "sender", bucket_name: "assets" },
        { type: null, script: null, bucket_name: null },
      ],
    },
  })
  expect(requests.map(({ path }) => path)).toEqual([QUEUE_PATH])
  expect(JSON.stringify(result)).not.toContain("secret_note")
})

test("view by name finds an exact match on page two then reads its id", async () => {
  const { tool, requests } = toolFor(
    {
      method: "GET",
      path: QUEUES_PATH,
      reply: (request) =>
        request.query.get("page") === "1"
          ? ok(
              Array.from({ length: 100 }, () => ({ ...QUEUE, queue_name: "MAIL-JOBS" })),
              { total_pages: 2 },
            )
          : ok([QUEUE]),
    },
    { method: "GET", path: QUEUE_PATH, reply: ok(QUEUE) },
  )
  const result = await invoke(tool, { method: "view", queue: " mail-jobs " }, CTX)
  expect(result.queue?.id).toBe(QUEUE_ID)
  expect(requests.map(({ path }) => path)).toEqual([QUEUES_PATH, QUEUES_PATH, QUEUE_PATH])
  expect(requests.slice(0, 2).map(({ query }) => Object.fromEntries(query))).toEqual([
    { page: "1", per_page: "100" },
    { page: "2", per_page: "100" },
  ])
})

test("name lookup stops on a short page or the reported last page", async () => {
  for (const reply of [
    ok([]),
    ok(
      Array.from({ length: 100 }, () => QUEUE),
      { total_pages: 1 },
    ),
  ]) {
    const { tool, requests } = toolFor({ method: "GET", path: QUEUES_PATH, reply })
    const error = errorOf(await rejection(invoke(tool, { method: "view", queue: "absent" }, CTX)))
    expect(error.code).toBe("not_found")
    expect(error.message).toBe('No queue named "absent" in the account.')
    expect(requests).toHaveLength(1)
  }
})

test("name lookup stops at ten full pages and suggests the id", async () => {
  const { tool, requests } = toolFor({
    method: "GET",
    path: QUEUES_PATH,
    reply: ok(Array.from({ length: 100 }, () => QUEUE)),
  })
  const error = errorOf(await rejection(invoke(tool, { method: "view", queue: "absent" }, CTX)))
  expect(error.code).toBe("not_found")
  expect(error.message).toBe('No queue named "absent" among the first 1000 queues of the account; pass its id.')
  expect(requests).toHaveLength(10)
})
