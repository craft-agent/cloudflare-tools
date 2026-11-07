import { describe, expect, test } from "bun:test"
import { rejection } from "../cloudflare/client.fixtures"
import { fail, ok } from "../cloudflare/testing"
import { isToolError } from "../errors"
import { invoke } from "../tool"
import { CTX } from "../zone/fixtures"
import {
  DEPLOYMENTS,
  DEPLOYMENT_ID,
  OLDER_DEPLOYMENT_ID,
  OLDER_VERSION_ID,
  SCRIPT,
  VERSIONS,
  VERSION_ID,
  errorOf,
  scriptPath,
  toolFor,
} from "./fixtures"

const INFO = { page: 2, per_page: 10, total_count: 25, total_pages: 3 }
const LONG = "é".repeat(250)
const CLIPPED = `${"é".repeat(200)}…`

describe("cloudflareWorkersRead: deployments", () => {
  test("returns the deployments in Cloudflare's order with the paging fields", async () => {
    const { tool } = toolFor({
      method: "GET",
      path: scriptPath("deployments"),
      reply: ok({ deployments: DEPLOYMENTS }, INFO),
    })
    const result = await invoke(tool, { method: "deployments", script: SCRIPT, page: 2, per_page: 10 }, CTX)

    expect(result).toEqual({
      label: "default",
      script: SCRIPT,
      deployments: [
        {
          id: DEPLOYMENT_ID,
          created_on: "2024-02-01T00:00:00Z",
          source: "wrangler",
          author_email: "dev@example.com",
          message: "Ship it",
          triggered_by: "deploy",
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
          message: null,
          triggered_by: "rollback",
          versions: [{ version_id: OLDER_VERSION_ID, percentage: 100 }],
        },
      ],
      ...INFO,
    })
  })

  test("asks for 20 per page unless told otherwise, and sends page only when given", async () => {
    const { tool, requests } = toolFor({
      method: "GET",
      path: scriptPath("deployments"),
      reply: ok({ deployments: [] }),
    })
    await invoke(tool, { method: "deployments", script: SCRIPT }, CTX)
    await invoke(tool, { method: "deployments", script: SCRIPT, page: 3, per_page: 100 }, CTX)

    expect(Object.fromEntries(requests[0]!.query)).toEqual({ per_page: "20" })
    expect(Object.fromEntries(requests[1]!.query)).toEqual({ per_page: "100", page: "3" })
  })

  test("clips a long message and fills what Cloudflare left out", async () => {
    const { tool } = toolFor({
      method: "GET",
      path: scriptPath("deployments"),
      reply: ok({
        deployments: [
          {
            id: "d",
            annotations: { "workers/message": LONG, "workers/triggered_by": 4 },
            versions: [{ percentage: "x" }, 7],
          },
          null,
        ],
      }),
    })
    const result = await invoke(tool, { method: "deployments", script: SCRIPT }, CTX)
    const empty = {
      id: "",
      created_on: null,
      source: null,
      author_email: null,
      message: null,
      triggered_by: null,
      versions: [],
    }

    expect(result.deployments).toEqual([
      {
        ...empty,
        id: "d",
        message: CLIPPED,
        versions: [
          { version_id: "", percentage: 0 },
          { version_id: "", percentage: 0 },
        ],
      },
      empty,
    ])
    expect(result.page).toBeNull()
  })

  test("a result without a deployments list is upstream_error", async () => {
    for (const result of [[], { items: [] }, { deployments: "x" }, null]) {
      const { tool } = toolFor({ method: "GET", path: scriptPath("deployments"), reply: ok(result) })

      expect(errorOf(await rejection(invoke(tool, { method: "deployments", script: SCRIPT }, CTX))).code).toBe(
        "upstream_error",
      )
    }
  })

  test("a Worker the account does not have is not_found, pointing at list", async () => {
    const { tool } = toolFor({
      method: "GET",
      path: scriptPath("deployments"),
      reply: fail(404, [{ code: 10007, message: "This Worker does not exist." }]),
    })
    const error = await rejection(invoke(tool, { method: "deployments", script: SCRIPT }, CTX))

    expect(errorOf(error).code).toBe("not_found")
    expect(isToolError(error) && error.message).toContain("cloudflare_workers_read list shows its Workers.")
  })
})

describe("cloudflareWorkersRead: versions", () => {
  test("returns the versions in Cloudflare's order with the paging fields", async () => {
    const { tool, requests } = toolFor({
      method: "GET",
      path: scriptPath("versions"),
      reply: ok({ items: VERSIONS }, INFO),
    })
    const result = await invoke(tool, { method: "versions", script: SCRIPT }, CTX)

    expect(result).toEqual({
      label: "default",
      script: SCRIPT,
      versions: [
        {
          id: VERSION_ID,
          number: 2,
          created_on: "2024-02-01T00:00:00Z",
          source: "wrangler",
          author_email: "dev@example.com",
          message: "Second",
          tag: "v2",
        },
        {
          id: OLDER_VERSION_ID,
          number: 1,
          created_on: "2024-01-01T00:00:00Z",
          source: "api",
          author_email: "ops@example.com",
          message: null,
          tag: null,
        },
      ],
      ...INFO,
    })
    expect(Object.fromEntries(requests[0]!.query)).toEqual({ per_page: "20" })
    expect(JSON.stringify(result)).not.toContain("resources")
  })

  test("clips a long message and tag, and fills what Cloudflare left out", async () => {
    const { tool } = toolFor({
      method: "GET",
      path: scriptPath("versions"),
      reply: ok({
        items: [{ id: "v", number: "1", annotations: { "workers/message": LONG, "workers/tag": LONG } }, 3],
      }),
    })
    const result = await invoke(tool, { method: "versions", script: SCRIPT, page: 1 }, CTX)
    const empty = { id: "", number: null, created_on: null, source: null, author_email: null, message: null, tag: null }

    expect(result.versions).toEqual([{ ...empty, id: "v", message: CLIPPED, tag: CLIPPED }, empty])
  })

  test("a result without an items list is upstream_error", async () => {
    for (const result of [[], { deployments: [] }, { items: {} }]) {
      const { tool } = toolFor({ method: "GET", path: scriptPath("versions"), reply: ok(result) })

      expect(errorOf(await rejection(invoke(tool, { method: "versions", script: SCRIPT }, CTX))).code).toBe(
        "upstream_error",
      )
    }
  })
})
