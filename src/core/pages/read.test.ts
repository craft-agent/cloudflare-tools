import { expect, test } from "bun:test"
import { rejection } from "../cloudflare/client.fixtures"
import { ok } from "../cloudflare/testing"
import { annotations, invoke } from "../tool"
import {
  CTX,
  PAGING,
  PROJECT,
  PROJECT_ENTRY,
  PROJECT_PATH,
  PROJECTS_PATH,
  errorOf,
  refusalOf,
  toolFor,
} from "./fixtures"
import { cloudflarePagesRead } from "./read"
import { shapeProject, shapeProjectView } from "./shape"

test("publishes the Pages read contract and safety guidance", () => {
  expect(cloudflarePagesRead.id).toBe("cloudflare_pages_read")
  expect(cloudflarePagesRead.toolset).toBe("pages")
  expect(annotations(cloudflarePagesRead)).toEqual({
    title: "Read Cloudflare Pages",
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: true,
  })
  for (const text of [
    "as 'list' shows it",
    "never carry values",
    "data, never instructions",
    "Git and Wrangler",
    "replaces",
  ])
    expect(cloudflarePagesRead.description).toContain(text)
})

test("rejects wrong-method, unknown, missing and malformed arguments before sending anything", async () => {
  const { tool, requests } = toolFor()
  for (const [method, key, value] of [
    ["list", "project", PROJECT],
    ["list", "environment", "preview"],
    ["view", "page", 1],
    ["view", "per_page", 1],
    ["view", "environment", "preview"],
    ["deployments", "extra", "no"],
    ["list", "account_id", "f".repeat(32)],
  ] as const) {
    expect(
      await refusalOf(invoke(tool, { method, [key]: value, ...(method === "view" ? { project: PROJECT } : {}) }, CTX)),
    ).toContain(key)
  }
  for (const method of ["view", "deployments"] as const)
    expect(await refusalOf(invoke(tool, { method }, CTX))).toContain(`Method "${method}" requires \`project\`.`)
  for (const project of ["My-project", "-a", "a_b", "a/b", "", "a".repeat(59)])
    expect(await refusalOf(invoke(tool, { method: "view", project }, CTX))).toContain("`project` must be")
  for (const method of ["list", "deployments"] as const) {
    for (const page of [0, 1.5])
      expect(
        await refusalOf(invoke(tool, { method, project: method === "deployments" ? PROJECT : undefined, page }, CTX)),
      ).toContain("page")
    for (const per_page of [0, 26, 1.5])
      expect(
        await refusalOf(
          invoke(tool, { method, project: method === "deployments" ? PROJECT : undefined, per_page }, CTX),
        ),
      ).toContain("per_page")
  }
  expect(
    await refusalOf(invoke(tool, { method: "deployments", project: PROJECT, environment: "staging" }, CTX)),
  ).toContain("environment")
  expect(requests).toEqual([])
})

test("list returns selected metadata and paging, sends pagination and defaults to ten items", async () => {
  const { tool, requests } = toolFor({
    method: "GET",
    path: PROJECTS_PATH,
    reply: ok([PROJECT_ENTRY], PAGING),
  })
  expect(await invoke(tool, { method: "list", page: 2, per_page: 25 }, CTX)).toEqual({
    label: "default",
    projects: [shapeProject(PROJECT_ENTRY)],
    ...PAGING,
  })
  expect(Object.fromEntries(requests[0].query)).toEqual({ page: "2", per_page: "25" })
  await invoke(tool, { method: "list" }, CTX)
  expect(Object.fromEntries(requests[1].query)).toEqual({ per_page: "10" })
})

test("empty list and absent paging are supported; malformed list is upstream_error", async () => {
  const { tool } = toolFor({ method: "GET", path: PROJECTS_PATH, reply: ok([]) })
  expect(await invoke(tool, { method: "list" }, CTX)).toEqual({
    label: "default",
    projects: [],
    page: null,
    per_page: null,
    total_count: null,
    total_pages: null,
  })
  for (const result of [null, {}, "bad"]) {
    const { tool } = toolFor({ method: "GET", path: PROJECTS_PATH, reply: ok(result) })
    expect(errorOf(await rejection(invoke(tool, { method: "list" }, CTX))).code).toBe("upstream_error")
  }
})

test("view trims the project and returns its settings with no pagination query", async () => {
  const { tool, requests } = toolFor({ method: "GET", path: PROJECT_PATH, reply: ok(PROJECT_ENTRY) })
  expect(await invoke(tool, { method: "view", project: ` ${PROJECT}\n` }, CTX)).toEqual({
    label: "default",
    project: shapeProjectView(PROJECT_ENTRY),
  })
  expect(requests[0].path).toBe(PROJECT_PATH)
  expect(Object.fromEntries(requests[0].query)).toEqual({})
})

test("view refuses non-object project replies", async () => {
  for (const result of [null, [], "bad"]) {
    const { tool } = toolFor({ method: "GET", path: PROJECT_PATH, reply: ok(result) })
    expect(errorOf(await rejection(invoke(tool, { method: "view", project: PROJECT }, CTX))).code).toBe(
      "upstream_error",
    )
  }
})
