import { expect, test } from "bun:test"
import { rejection } from "../cloudflare/client.fixtures"
import { fail, ok } from "../cloudflare/testing"
import { invoke } from "../tool"
import {
  CTX,
  DEPLOYMENT,
  DEPLOYMENT_ID,
  DEPLOYMENTS_PATH,
  PAGING,
  PREVIEW_ID,
  PROJECT,
  PROJECT_ENTRY,
  PROJECT_PATH,
  errorOf,
  toolFor,
} from "./fixtures"
import { shapeDeployment, shapeLiveRef } from "./shape"

test("deployments mark canonical production live even when a newer preview comes first", async () => {
  const preview = { ...DEPLOYMENT, id: PREVIEW_ID, environment: "preview" }
  const { tool, requests } = toolFor(
    { method: "GET", path: PROJECT_PATH, reply: ok(PROJECT_ENTRY) },
    {
      method: "GET",
      path: DEPLOYMENTS_PATH,
      reply: ok([preview, DEPLOYMENT], PAGING),
    },
  )
  expect(
    await invoke(
      tool,
      { method: "deployments", project: ` ${PROJECT} `, environment: "preview", page: 2, per_page: 25 },
      CTX,
    ),
  ).toEqual({
    label: "default",
    project: PROJECT,
    live: shapeLiveRef(DEPLOYMENT),
    deployments: [shapeDeployment(preview, false), shapeDeployment(DEPLOYMENT, true)],
    ...PAGING,
  })
  expect(Object.fromEntries(requests.find((request) => request.path === DEPLOYMENTS_PATH)!.query)).toEqual({
    env: "preview",
    page: "2",
    per_page: "25",
  })
  expect(Object.fromEntries(requests.find((request) => request.path === PROJECT_PATH)!.query)).toEqual({})
})

test("no canonical deployment means no deployment is live, and omitted filters are not sent", async () => {
  const { tool, requests } = toolFor(
    { method: "GET", path: PROJECT_PATH, reply: ok({ name: PROJECT }) },
    { method: "GET", path: DEPLOYMENTS_PATH, reply: ok([DEPLOYMENT, null]) },
  )
  const result = await invoke(tool, { method: "deployments", project: PROJECT }, CTX)
  expect(result.live).toBeNull()
  expect(result.deployments?.map((entry) => entry.live)).toEqual([false, false])
  expect(Object.fromEntries(requests.find((request) => request.path === DEPLOYMENTS_PATH)!.query)).toEqual({
    per_page: "10",
  })
})

test("live reference is returned even when the current page is empty", async () => {
  const { tool } = toolFor(
    { method: "GET", path: PROJECT_PATH, reply: ok(PROJECT_ENTRY) },
    { method: "GET", path: DEPLOYMENTS_PATH, reply: ok([]) },
  )
  const result = await invoke(tool, { method: "deployments", project: PROJECT }, CTX)
  expect(result.live?.id).toBe(DEPLOYMENT_ID)
  expect(result.deployments).toEqual([])
})

test("both requests start in parallel before either finishes", async () => {
  let releaseProject!: () => void
  const projectPending = new Promise<void>((resolve) => {
    releaseProject = resolve
  })
  const { tool } = toolFor(
    {
      method: "GET",
      path: PROJECT_PATH,
      reply: async () => {
        await projectPending
        return ok(PROJECT_ENTRY)
      },
    },
    {
      method: "GET",
      path: DEPLOYMENTS_PATH,
      reply: () => {
        releaseProject()
        return ok([])
      },
    },
  )
  expect((await invoke(tool, { method: "deployments", project: PROJECT }, CTX)).deployments).toEqual([])
})

test("bad project or deployments responses fail as upstream_error", async () => {
  for (const [project, deployments] of [
    [null, []],
    [[], []],
    [PROJECT_ENTRY, {}],
    [PROJECT_ENTRY, null],
  ]) {
    const { tool } = toolFor(
      { method: "GET", path: PROJECT_PATH, reply: ok(project) },
      { method: "GET", path: DEPLOYMENTS_PATH, reply: ok(deployments) },
    )
    expect(errorOf(await rejection(invoke(tool, { method: "deployments", project: PROJECT }, CTX))).code).toBe(
      "upstream_error",
    )
  }
})

test("not_found on either route points at the project's list", async () => {
  for (const missing of [PROJECT_PATH, DEPLOYMENTS_PATH]) {
    const { tool } = toolFor(
      ...[PROJECT_PATH, DEPLOYMENTS_PATH].map((path) => ({
        method: "GET" as const,
        path,
        reply:
          path === missing
            ? fail(404, [{ code: 7003, message: "Missing" }])
            : ok(path === PROJECT_PATH ? PROJECT_ENTRY : []),
      })),
    )
    const error = errorOf(await rejection(invoke(tool, { method: "deployments", project: PROJECT }, CTX)))
    expect(error.code).toBe("not_found")
    expect(error.message).toContain("cloudflare_pages_read list")
  }
})
