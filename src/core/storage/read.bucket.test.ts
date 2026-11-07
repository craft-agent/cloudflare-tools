import { expect, test } from "bun:test"
import { rejection, tokenStatus, VERIFY_USER_PATH } from "../cloudflare/client.fixtures"
import { ok } from "../cloudflare/testing"
import { invoke } from "../tool"
import {
  BUCKET_NAME,
  BUCKET_PATH,
  CORS_PATH,
  CUSTOM_DOMAINS_PATH,
  CTX,
  LIFECYCLE_PATH,
  MANAGED_DOMAIN_PATH,
  errorOf,
  toolFor,
} from "./fixtures"

const BUCKET_RESPONSE = {
  name: BUCKET_NAME,
  creation_date: "2024-01-01T00:00:00Z",
  location: "wnam",
  storage_class: "Standard",
}

test("bucket: reads bucket details and all four sub-resources (the five paths)", async () => {
  const { tool, requests } = toolFor(
    { method: "GET", path: BUCKET_PATH, reply: ok(BUCKET_RESPONSE) },
    {
      method: "GET",
      path: MANAGED_DOMAIN_PATH,
      reply: ok({ bucketId: BUCKET_NAME, domain: "pub.r2.dev", enabled: true }),
    },
    {
      method: "GET",
      path: CUSTOM_DOMAINS_PATH,
      reply: ok({
        domains: [
          {
            domain: "cdn.example.com",
            enabled: true,
            status: { ownership: "active", ssl: "active" },
            zoneName: "example.com",
          },
          {
            enabled: true,
          },
          { domain: "pending.example.com" },
          null,
        ],
      }),
    },
    {
      method: "GET",
      path: CORS_PATH,
      reply: ok({
        rules: [
          {
            id: "rule-1",
            allowed: {
              origins: ["https://example.com", 123],
              methods: ["GET", "PUT", null],
              headers: ["*", false],
            },
            exposeHeaders: ["ETag", 123],
            maxAgeSeconds: 3600,
          },
          {
            id: null,
          },
          null,
        ],
      }),
    },
    {
      method: "GET",
      path: LIFECYCLE_PATH,
      reply: ok({
        rules: [
          {
            id: "lifecycle-1",
            enabled: true,
            conditions: { prefix: "logs/" },
            deleteObjectsTransition: { condition: { type: "Age", maxAge: 86400 } },
            abortMultipartUploadsTransition: { condition: { type: "Age", maxAge: 3600 } },
            storageClassTransitions: [
              { condition: { type: "Date", date: "2025-01-01" }, storageClass: "InfrequentAccess" },
              { condition: {} },
              null,
            ],
          },
          {
            id: null,
            enabled: null,
          },
          null,
        ],
      }),
    },
  )

  const result = await invoke(tool, { method: "bucket", bucket: BUCKET_NAME }, CTX)

  expect(result).toEqual({
    label: "default",
    bucket: {
      name: BUCKET_NAME,
      created: "2024-01-01T00:00:00Z",
      location: "wnam",
      storage_class: "Standard",
    },
    public: {
      r2_dev: {
        enabled: true,
        domain: "pub.r2.dev",
      },
      custom_domains: [
        {
          domain: "cdn.example.com",
          enabled: true,
          ownership: "active",
          ssl: "active",
          zone: "example.com",
        },
        { domain: "pending.example.com", enabled: null, ownership: null, ssl: null, zone: null },
      ],
    },
    cors: [
      {
        id: "rule-1",
        origins: ["https://example.com"],
        methods: ["GET", "PUT"],
        headers: ["*"],
        expose_headers: ["ETag"],
        max_age_seconds: 3600,
      },
      {
        id: null,
        origins: [],
        methods: [],
        headers: [],
        expose_headers: [],
        max_age_seconds: null,
      },
    ],
    lifecycle: [
      {
        id: "lifecycle-1",
        enabled: true,
        prefix: "logs/",
        delete_objects: {
          type: "Age",
          max_age_seconds: 86400,
          date: null,
        },
        abort_multipart_uploads: {
          type: "Age",
          max_age_seconds: 3600,
          date: null,
        },
        storage_class_transitions: [
          {
            storage_class: "InfrequentAccess",
            condition: {
              type: "Date",
              max_age_seconds: null,
              date: "2025-01-01",
            },
          },
          { storage_class: null, condition: { type: null, max_age_seconds: null, date: null } },
        ],
      },
      {
        id: null,
        enabled: null,
        prefix: null,
        delete_objects: null,
        abort_multipart_uploads: null,
        storage_class_transitions: [],
      },
    ],
  })

  expect(requests.map((req) => req.path)).toEqual([
    BUCKET_PATH,
    MANAGED_DOMAIN_PATH,
    CUSTOM_DOMAINS_PATH,
    CORS_PATH,
    LIFECYCLE_PATH,
  ])
})

test("bucket: parts not set (not_found on sub-resources) gives empty values", async () => {
  const notFoundReply = { status: 404, body: { success: false, errors: [{ code: 10006, message: "Not found" }] } }
  const { tool } = toolFor(
    { method: "GET", path: BUCKET_PATH, reply: ok(BUCKET_RESPONSE) },
    { method: "GET", path: MANAGED_DOMAIN_PATH, reply: notFoundReply },
    { method: "GET", path: CUSTOM_DOMAINS_PATH, reply: notFoundReply },
    { method: "GET", path: CORS_PATH, reply: notFoundReply },
    { method: "GET", path: LIFECYCLE_PATH, reply: notFoundReply },
  )

  const result = await invoke(tool, { method: "bucket", bucket: BUCKET_NAME }, CTX)

  expect(result.public).toEqual({
    r2_dev: { enabled: false, domain: null },
    custom_domains: [],
  })
  expect(result.cors).toEqual([])
  expect(result.lifecycle).toEqual([])
})

test("bucket: bucket's own not_found passes through as not_found", async () => {
  const { tool, requests } = toolFor({
    method: "GET",
    path: BUCKET_PATH,
    reply: {
      status: 404,
      body: { success: false, errors: [{ code: 10006, message: "The specified bucket does not exist." }] },
    },
  })

  const error = errorOf(await rejection(invoke(tool, { method: "bucket", bucket: BUCKET_NAME }, CTX)))
  expect(error.code).toBe("not_found")
  expect(error.message).toContain("The specified bucket does not exist.")

  // Sub-resources must not be called when bucket itself is not found
  expect(requests.length).toBe(1)
  expect(requests[0].path).toBe(BUCKET_PATH)
})

test("bucket: another failure of a part fails the call", async () => {
  const { tool } = toolFor(
    { method: "GET", path: BUCKET_PATH, reply: ok(BUCKET_RESPONSE) },
    { method: "GET", path: MANAGED_DOMAIN_PATH, reply: ok({ enabled: false, domain: null }) },
    { method: "GET", path: CUSTOM_DOMAINS_PATH, reply: ok({ domains: [] }) },
    {
      method: "GET",
      path: CORS_PATH,
      reply: { status: 500, body: { success: false, errors: [{ code: 10001, message: "Internal error" }] } },
    },
    { method: "GET", path: LIFECYCLE_PATH, reply: ok({ rules: [] }) },
  )

  const error = errorOf(await rejection(invoke(tool, { method: "bucket", bucket: BUCKET_NAME }, CTX)))
  expect(error.code).toBe("upstream_error")
})

test("bucket: unexpected response shapes produce upstream_error", async () => {
  const { tool: badBucketTool } = toolFor({ method: "GET", path: BUCKET_PATH, reply: ok(null) })
  const bucketError = errorOf(await rejection(invoke(badBucketTool, { method: "bucket", bucket: BUCKET_NAME }, CTX)))
  expect(bucketError.code).toBe("upstream_error")
  expect(bucketError.message).toBe("Cloudflare returned an unexpected R2 bucket response.")

  const parts = [
    { path: MANAGED_DOMAIN_PATH, name: "managed domain", empty: {} },
    { path: CUSTOM_DOMAINS_PATH, name: "custom domains", empty: { domains: [] } },
    { path: CORS_PATH, name: "CORS", empty: { rules: [] } },
    { path: LIFECYCLE_PATH, name: "lifecycle", empty: { rules: [] } },
  ]
  for (const invalid of parts) {
    const { tool } = toolFor(
      { method: "GET", path: BUCKET_PATH, reply: ok(BUCKET_RESPONSE) },
      ...parts.map((part) => ({
        method: "GET" as const,
        path: part.path,
        reply: ok(part === invalid ? null : part.empty),
      })),
    )
    const error = errorOf(await rejection(invoke(tool, { method: "bucket", bucket: BUCKET_NAME }, CTX)))
    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe(`Cloudflare returned an unexpected R2 ${invalid.name} response.`)
  }
})

test("bucket: missing managed domain fields default to disabled and null", async () => {
  const { tool } = toolFor(
    { method: "GET", path: BUCKET_PATH, reply: ok(BUCKET_RESPONSE) },
    { method: "GET", path: MANAGED_DOMAIN_PATH, reply: ok({ enabled: "true" }) },
    { method: "GET", path: CUSTOM_DOMAINS_PATH, reply: ok({ domains: [] }) },
    { method: "GET", path: CORS_PATH, reply: ok({ rules: [] }) },
    { method: "GET", path: LIFECYCLE_PATH, reply: ok({ rules: [] }) },
  )
  expect((await invoke(tool, { method: "bucket", bucket: BUCKET_NAME }, CTX)).public?.r2_dev).toEqual({
    enabled: false,
    domain: null,
  })
})

test("bucket: forbidden failure appends the R2 permission hint", async () => {
  const verify = { method: "GET" as const, path: VERIFY_USER_PATH, reply: tokenStatus("active") }
  const forbiddenReply = {
    status: 403,
    body: { success: false, errors: [{ code: 10000, message: "Authentication error" }] },
  }

  // Forbidden on bucket itself
  const { tool: bucketForbiddenTool } = toolFor(verify, { method: "GET", path: BUCKET_PATH, reply: forbiddenReply })
  const bucketError = errorOf(
    await rejection(invoke(bucketForbiddenTool, { method: "bucket", bucket: BUCKET_NAME }, CTX)),
  )
  expect(bucketError.code).toBe("forbidden")
  expect(bucketError.message).toEndWith(
    "Authentication error (the token is active but lacks a permission this call needs). The token needs Account → Workers R2 Storage → Read.",
  )

  // Forbidden on sub-resource
  const { tool: subForbiddenTool } = toolFor(
    verify,
    { method: "GET", path: BUCKET_PATH, reply: ok(BUCKET_RESPONSE) },
    { method: "GET", path: MANAGED_DOMAIN_PATH, reply: ok({ enabled: false, domain: null }) },
    { method: "GET", path: CUSTOM_DOMAINS_PATH, reply: ok({ domains: [] }) },
    { method: "GET", path: CORS_PATH, reply: forbiddenReply },
    { method: "GET", path: LIFECYCLE_PATH, reply: ok({ rules: [] }) },
  )
  const subError = errorOf(await rejection(invoke(subForbiddenTool, { method: "bucket", bucket: BUCKET_NAME }, CTX)))
  expect(subError.code).toBe("forbidden")
  expect(subError.message).toEndWith(
    "Authentication error (the token is active but lacks a permission this call needs). The token needs Account → Workers R2 Storage → Read.",
  )
})
