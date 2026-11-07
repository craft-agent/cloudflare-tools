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
export const PAGING = { page: 2, per_page: 25, total_count: 30, total_pages: 2 }

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
