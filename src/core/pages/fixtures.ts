import { ACCOUNT_ID, envFor } from "../cloudflare/client.fixtures"
import { fakeCloudflare, type FakeRoute } from "../cloudflare/testing"
import { definePagesRead } from "./read"

export { errorOf, refusalOf } from "../workers/fixtures"

export { CTX } from "../zone/fixtures"

export const PROJECT = "my-project"
export const PROJECTS_PATH = `/accounts/${ACCOUNT_ID}/pages/projects`
export const PROJECT_PATH = `${PROJECTS_PATH}/${PROJECT}`
export const DEPLOYMENTS_PATH = `${PROJECT_PATH}/deployments`
export const DEPLOYMENT_ID = "11111111-1111-4111-8111-111111111111"
export const PREVIEW_ID = "22222222-2222-4222-8222-222222222222"
export const DEPLOYMENT_LOGS_PATH = `${PROJECT_PATH}/deployments/${DEPLOYMENT_ID}/history/logs`
export const DOMAINS_PATH = `${PROJECT_PATH}/domains`
export const ZONE_ID = "33333333333333333333333333333333"
export const PAGING = { page: 2, per_page: 25, total_count: 30, total_pages: 2 }

export const LOG_ENTRY = {
  ts: "2024-01-01T00:00:00Z",
  line: "Success: Compiled successfully.",
}

export const DOMAIN_ENTRY = {
  id: "44444444-4444-4444-8444-444444444444",
  domain_id: "55555555-5555-4555-8555-555555555555",
  name: "custom.example.com",
  status: "active",
  validation_data: {
    method: "txt",
    status: "active",
    txt_name: "_cf-custom-hostname.custom.example.com",
    txt_value: "txt-validation-value",
    error_message: null,
  },
  verification_data: {
    status: "active",
    error_message: null,
  },
  certificate_authority: "lets_encrypt",
  zone_tag: ZONE_ID,
  created_on: "2024-01-01T00:00:00Z",
}

/** The read tool with a fake Cloudflare answering only these routes. */
export function toolFor(...routes: FakeRoute[]) {
  const { fetch, requests } = fakeCloudflare(routes)
  return { tool: definePagesRead({ fetch, env: envFor() }), requests }
}

export const DEPLOYMENT = {
  id: DEPLOYMENT_ID,
  short_id: "11111111",
  environment: "production",
  url: "https://11111111.my-project.pages.dev",
  aliases: ["https://my-project.pages.dev"],
  created_on: "2024-01-01T00:00:00Z",
  latest_stage: { name: "deploy", status: "success" },
  is_skipped: false,
  deployment_trigger: {
    type: "github:push",
    metadata: { branch: "main", commit_hash: "a".repeat(40), commit_message: "Ship it", commit_dirty: false },
  },
}

export const PROJECT_ENTRY = {
  name: PROJECT,
  subdomain: "my-project.pages.dev",
  domains: ["my-project.pages.dev", "example.com"],
  production_branch: "main",
  source: { type: "github", config: { owner: "example", repo_name: "site" } },
  created_on: "2024-01-01T00:00:00Z",
  canonical_deployment: DEPLOYMENT,
  build_config: {
    build_command: "pnpm build",
    destination_dir: "dist",
    root_dir: "/",
    build_caching: true,
    web_analytics_token: "analytics-token-value",
    web_analytics_tag: "analytics-tag-value",
  },
  deployment_configs: {
    production: {
      compatibility_date: "2024-01-01",
      compatibility_flags: ["nodejs_compat"],
      env_vars: {
        Z_SECRET: { type: "secret_text", value: "secret-variable-value" },
        A_PLAIN: { type: "plain_text", value: "plain-variable-value" },
      },
      kv_namespaces: { Z_KV: { namespace_id: "f".repeat(32) }, A_KV: { namespace_id: "e".repeat(32) } },
      services: { API: { service: "service-target-value" } },
      ignored_binding: { NO: { value: "ignored-value" } },
    },
  },
}
