import { describe, expect, test } from "bun:test"
import { rejection } from "../cloudflare/client.fixtures"
import { fail, ok } from "../cloudflare/testing"
import { invoke } from "../tool"
import { CTX } from "../zone/fixtures"
import { SCRIPT, SCRIPTS_PATH, SCRIPT_ENTRY, SETTINGS, SUBDOMAIN, errorOf, scriptPath, toolFor } from "./fixtures"

const settingsRoute = { method: "GET", path: scriptPath("settings"), reply: ok(SETTINGS) } as const
const subdomainRoute = { method: "GET", path: scriptPath("subdomain"), reply: ok(SUBDOMAIN) } as const

describe("cloudflareWorkersRead: list", () => {
  test("returns every Worker with the listed fields only", async () => {
    const { tool, requests } = toolFor({ method: "GET", path: SCRIPTS_PATH, reply: ok([SCRIPT_ENTRY]) })
    const result = await invoke(tool, { method: "list" }, CTX)

    expect(result).toEqual({
      label: "default",
      scripts: [
        {
          name: SCRIPT,
          created_on: "2024-01-01T00:00:00Z",
          modified_on: "2024-02-01T00:00:00Z",
          compatibility_date: "2024-01-15",
          usage_model: "standard",
          handlers: ["fetch", "scheduled"],
          has_assets: true,
        },
      ],
    })
    expect(requests).toHaveLength(1)
    expect(requests[0]!.query.size).toBe(0)
  })

  test("fills what Cloudflare left out or got odd", async () => {
    const { tool } = toolFor({
      method: "GET",
      path: SCRIPTS_PATH,
      reply: ok([{ id: "bare" }, { id: 5, created_on: 3, handlers: ["fetch", 1], has_assets: "yes" }, null]),
    })
    const result = await invoke(tool, { method: "list" }, CTX)
    const empty = {
      name: "",
      created_on: null,
      modified_on: null,
      compatibility_date: null,
      usage_model: null,
      handlers: [],
      has_assets: false,
    }

    expect(result.scripts).toEqual([{ ...empty, name: "bare" }, { ...empty, handlers: ["fetch"] }, empty])
  })

  test("an account without Workers gives an empty list", async () => {
    const { tool } = toolFor({ method: "GET", path: SCRIPTS_PATH, reply: ok([]) })

    expect(await invoke(tool, { method: "list" }, CTX)).toEqual({ label: "default", scripts: [] })
  })

  test("a result that is not a list is upstream_error", async () => {
    const { tool } = toolFor({ method: "GET", path: SCRIPTS_PATH, reply: ok({ not: "a list" }) })

    expect(errorOf(await rejection(invoke(tool, { method: "list" }, CTX))).code).toBe("upstream_error")
  })
})

describe("cloudflareWorkersRead: view", () => {
  test("reads the settings and the workers.dev switches of the Worker", async () => {
    const { tool, requests } = toolFor(settingsRoute, subdomainRoute)
    const result = await invoke(tool, { method: "view", script: SCRIPT }, CTX)

    expect(result).toEqual({
      label: "default",
      script: SCRIPT,
      compatibility_date: "2024-01-15",
      compatibility_flags: ["nodejs_compat"],
      usage_model: "standard",
      placement: "smart",
      observability: true,
      logpush: true,
      tail_consumers: [
        { service: "log-sink", environment: "production", namespace: null },
        { service: "other-sink", environment: null, namespace: "ns" },
      ],
      bindings: [
        { name: "KV", type: "kv_namespace" },
        { name: "GREETING", type: "plain_text" },
        { name: "API_KEY", type: "secret_text" },
      ],
      workers_dev: { enabled: true, previews_enabled: false },
    })
    expect(requests.map((request) => request.path).sort()).toEqual([scriptPath("settings"), scriptPath("subdomain")])
  })

  test("never returns a binding's value or any other field of a binding", async () => {
    const { tool } = toolFor(settingsRoute, subdomainRoute)
    const json = JSON.stringify(await invoke(tool, { method: "view", script: SCRIPT }, CTX))

    for (const leaked of ["plain-text-binding-value", "secret-binding-value", "namespace_id", "0123456789abcdef"]) {
      expect(json).not.toContain(leaked)
    }
  })

  test("fills what Cloudflare left out or got odd", async () => {
    const { tool } = toolFor(
      {
        method: "GET",
        path: scriptPath("settings"),
        reply: ok({
          compatibility_flags: ["a", 2],
          placement: "smart",
          observability: true,
          logpush: "yes",
          bindings: [null],
        }),
      },
      { method: "GET", path: scriptPath("subdomain"), reply: ok(null) },
    )
    const result = await invoke(tool, { method: "view", script: SCRIPT }, CTX)

    expect(result).toEqual({
      label: "default",
      script: SCRIPT,
      compatibility_date: null,
      compatibility_flags: ["a"],
      usage_model: null,
      placement: null,
      observability: false,
      logpush: false,
      tail_consumers: [],
      bindings: [{ name: "", type: "" }],
      workers_dev: { enabled: false, previews_enabled: false },
    })
  })

  test("a Worker the account does not have is not_found, pointing at list", async () => {
    const missing = fail(404, [{ code: 10007, message: "This Worker does not exist on your account." }])
    const { tool } = toolFor(
      { method: "GET", path: scriptPath("settings"), reply: missing },
      { method: "GET", path: scriptPath("subdomain"), reply: missing },
    )
    const error = errorOf(await rejection(invoke(tool, { method: "view", script: SCRIPT }, CTX)))

    expect(error).toEqual({
      code: "not_found",
      message: `No Worker ${SCRIPT} in the account default; cloudflare_workers_read list shows its Workers.`,
    })
  })

  test("another failure passes through unchanged", async () => {
    const { tool } = toolFor(settingsRoute, {
      method: "GET",
      path: scriptPath("subdomain"),
      reply: fail(500, [{ code: 1000, message: "boom" }]),
    })

    expect(errorOf(await rejection(invoke(tool, { method: "view", script: SCRIPT }, CTX))).code).toBe("upstream_error")
  })
})
