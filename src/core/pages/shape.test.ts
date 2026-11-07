import { expect, test } from "bun:test"
import { DEPLOYMENT, PROJECT_ENTRY } from "./fixtures"
import {
  deploymentSchema,
  projectViewSchema,
  shapeDeployment,
  shapeLiveRef,
  shapeProject,
  shapeProjectView,
} from "./shape"

test("projects expose source and the canonical deployment, or null for direct upload and no live deployment", () => {
  expect(shapeProject(PROJECT_ENTRY)).toEqual({
    name: "my-project",
    subdomain: "my-project.pages.dev",
    domains: ["my-project.pages.dev", "example.com"],
    production_branch: "main",
    source: { type: "github", owner: "example", repo: "site" },
    created_on: "2024-01-01T00:00:00Z",
    live: shapeLiveRef(DEPLOYMENT),
  })
  expect(shapeProject({}).source).toBeNull()
  for (const value of [null, [], {}, { id: 3 }]) expect(shapeLiveRef(value)).toBeNull()
  expect(shapeLiveRef({ id: "live" })).toEqual({
    id: "live",
    short_id: null,
    created_on: null,
    branch: null,
    commit_hash: null,
  })
})

test("view selects build fields and names and types only, sorted, with no secret or binding values anywhere", () => {
  const result = shapeProjectView(PROJECT_ENTRY)
  expect(result.build_config).toEqual({
    build_command: "pnpm build",
    destination_dir: "dist",
    root_dir: "/",
    build_caching: true,
  })
  expect(result.environments.production).toEqual({
    compatibility_date: "2024-01-01",
    compatibility_flags: ["nodejs_compat"],
    env_vars: [
      { name: "A_PLAIN", type: "plain_text" },
      { name: "Z_SECRET", type: "secret_text" },
    ],
    bindings: [
      { name: "A_KV", type: "kv_namespace" },
      { name: "Z_KV", type: "kv_namespace" },
      { name: "API", type: "service" },
    ],
  })
  expect(result.environments.preview).toBeNull()
  const json = JSON.stringify(result)
  for (const value of [
    "plain-variable-value",
    "secret-variable-value",
    "f".repeat(32),
    "e".repeat(32),
    "analytics-token-value",
    "analytics-tag-value",
    "service-target-value",
    "ignored-value",
  ])
    expect(json).not.toContain(value)
  expect(projectViewSchema.safeParse(result).success).toBe(true)
  expect(
    projectViewSchema.safeParse({ ...result, build_config: { ...result.build_config, web_analytics_token: "no" } })
      .success,
  ).toBe(false)
})

test("every supported binding collection is mapped and unknown collections are ignored", () => {
  const types = {
    kv_namespaces: "kv_namespace",
    d1_databases: "d1_database",
    r2_buckets: "r2_bucket",
    services: "service",
    durable_object_namespaces: "durable_object_namespace",
    queue_producers: "queue_producer",
    analytics_engine_datasets: "analytics_engine",
    ai_bindings: "ai",
    hyperdrive_bindings: "hyperdrive",
    vectorize_bindings: "vectorize",
    browsers: "browser",
    mtls_certificates: "mtls_certificate",
  }
  const config = Object.fromEntries(Object.keys(types).map((key) => [key, { BINDING: { value: "never-return" } }]))
  const result = shapeProjectView({ deployment_configs: { production: config } })
  expect(result.environments.production?.bindings).toEqual(
    Object.values(types)
      .sort((a, b) => a.localeCompare(b))
      .map((type) => ({ name: "BINDING", type })),
  )
})

test("odd project fields become null and arrays contain only strings", () => {
  const result = shapeProjectView({
    domains: ["example.com", 1],
    build_config: { build_command: 2, build_caching: "true" },
    deployment_configs: {
      production: { compatibility_flags: ["flag", 1], env_vars: { ODD: null }, kv_namespaces: [] },
      preview: [],
    },
  })
  expect(result.name).toBeNull()
  expect(result.domains).toEqual(["example.com"])
  expect(result.build_config).toEqual({
    build_command: null,
    destination_dir: null,
    root_dir: null,
    build_caching: null,
  })
  expect(result.environments.production).toEqual({
    compatibility_date: null,
    compatibility_flags: ["flag"],
    env_vars: [{ name: "ODD", type: null }],
    bindings: [],
  })
  expect(result.environments.preview).toBeNull()
  expect(shapeProjectView(null).build_config).toBeNull()
})

test("deployments select metadata, clip messages by character, and exclude configuration", () => {
  const result = shapeDeployment(
    {
      ...DEPLOYMENT,
      env_vars: { KEY: "do-not-copy" },
      build_config: { token: "do-not-copy" },
      source: "do-not-copy",
      stages: ["do-not-copy"],
      deployment_trigger: {
        ...DEPLOYMENT.deployment_trigger,
        metadata: { ...DEPLOYMENT.deployment_trigger.metadata, commit_message: "🙂".repeat(201) },
      },
    },
    true,
  )
  expect(result.trigger.commit_message).toBe(`${"🙂".repeat(200)}…`)
  expect(result.status).toEqual({ stage: "deploy", status: "success" })
  expect(result.live).toBe(true)
  expect(result.trigger.commit_dirty).toBe(false)
  expect(JSON.stringify(result)).not.toContain("do-not-copy")
  expect(deploymentSchema.safeParse(result).success).toBe(true)
  expect(deploymentSchema.safeParse({ ...result, trigger: { ...result.trigger, value: "no" } }).success).toBe(false)
})

test("odd deployments become null, empty arrays and false", () => {
  expect(shapeDeployment(null, false)).toEqual({
    id: null,
    short_id: null,
    environment: null,
    url: null,
    aliases: [],
    created_on: null,
    status: { stage: null, status: null },
    skipped: false,
    trigger: { type: null, branch: null, commit_hash: null, commit_message: null, commit_dirty: null },
    live: false,
  })
  expect(
    shapeDeployment(
      {
        aliases: ["url", 1],
        is_skipped: "true",
        deployment_trigger: { metadata: { commit_dirty: 1, commit_message: "data" } },
      },
      false,
    ),
  ).toMatchObject({ aliases: ["url"], skipped: false, trigger: { commit_dirty: null, commit_message: "data" } })
})
