import { ACCOUNT_ID, envFor, rejection } from "../cloudflare/client.fixtures"
import { fakeCloudflare, type FakeRoute } from "../cloudflare/testing"
import { isToolError } from "../errors"
import { defineWorkersRead } from "./read"

export const SCRIPT = "my-worker"

export const SCRIPTS_PATH = `/accounts/${ACCOUNT_ID}/workers/scripts`

/** The path of one of a Worker's sub-resources. */
export function scriptPath(part: string, script: string = SCRIPT): string {
  return `${SCRIPTS_PATH}/${script}/${part}`
}

/** The tool wired to a fake Cloudflare that answers `routes`. */
export function toolFor(...routes: FakeRoute[]) {
  const { fetch, requests } = fakeCloudflare(routes)
  return { tool: defineWorkersRead({ fetch, env: envFor() }), requests }
}

/** The code and message of a `ToolError`, or nothing for any other error. */
export function errorOf(error: unknown): { code?: string; message?: string } {
  return isToolError(error) ? { code: error.code, message: error.message } : {}
}

/** The message of the `invalid_argument` a promise rejected with. */
export async function refusalOf(promise: Promise<unknown>): Promise<string> {
  const error = await rejection(promise)
  if (!isToolError(error) || error.code !== "invalid_argument") throw new Error(`Unexpected error: ${String(error)}`)
  return error.message
}

export const SCRIPT_ENTRY = {
  id: SCRIPT,
  created_on: "2024-01-01T00:00:00Z",
  modified_on: "2024-02-01T00:00:00Z",
  compatibility_date: "2024-01-15",
  usage_model: "standard",
  handlers: ["fetch", "scheduled"],
  has_assets: true,
  etag: "abc",
}

export const SETTINGS = {
  compatibility_date: "2024-01-15",
  compatibility_flags: ["nodejs_compat"],
  usage_model: "standard",
  placement: { mode: "smart" },
  observability: { enabled: true, head_sampling_rate: 1 },
  logpush: true,
  tail_consumers: [
    { service: "log-sink", environment: "production" },
    { service: "other-sink", namespace: "ns" },
  ],
  bindings: [
    { name: "KV", type: "kv_namespace", namespace_id: "f".repeat(32) },
    { name: "GREETING", type: "plain_text", text: "plain-text-binding-value" },
    { name: "API_KEY", type: "secret_text", text: "secret-binding-value" },
  ],
}

export const SUBDOMAIN = { enabled: true, previews_enabled: false }

export const DEPLOYMENT_ID = "11111111-1111-4111-8111-111111111111"
export const OLDER_DEPLOYMENT_ID = "22222222-2222-4222-8222-222222222222"
export const VERSION_ID = "33333333-3333-4333-8333-333333333333"
export const OLDER_VERSION_ID = "44444444-4444-4444-8444-444444444444"

export const DEPLOYMENTS = [
  {
    id: DEPLOYMENT_ID,
    created_on: "2024-02-01T00:00:00Z",
    source: "wrangler",
    author_email: "dev@example.com",
    strategy: "percentage",
    annotations: { "workers/message": "Ship it", "workers/triggered_by": "deploy" },
    versions: [
      { version_id: VERSION_ID, percentage: 70 },
      { version_id: OLDER_VERSION_ID, percentage: 30 },
    ],
  },
  {
    id: OLDER_DEPLOYMENT_ID,
    created_on: "2024-01-01T00:00:00Z",
    source: "api",
    author_email: "ops@example.com",
    annotations: { "workers/triggered_by": "rollback" },
    versions: [{ version_id: OLDER_VERSION_ID, percentage: 100 }],
  },
]

export const VERSIONS = [
  {
    id: VERSION_ID,
    number: 2,
    metadata: { created_on: "2024-02-01T00:00:00Z", source: "wrangler", author_email: "dev@example.com" },
    annotations: { "workers/message": "Second", "workers/tag": "v2" },
    resources: { script: { etag: "x" } },
  },
  {
    id: OLDER_VERSION_ID,
    number: 1,
    metadata: { created_on: "2024-01-01T00:00:00Z", source: "api", author_email: "ops@example.com" },
  },
]
