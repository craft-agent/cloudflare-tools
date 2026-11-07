import { envFor } from "../cloudflare/client.fixtures"
import { fakeCloudflare, ok, type FakeRequest, type FakeRoute } from "../cloudflare/testing"
import { DEPLOYMENT_ID, OLDER_DEPLOYMENT_ID, OLDER_VERSION_ID, SCRIPT, VERSION_ID, scriptPath } from "./fixtures"
import { defineWorkersRollback } from "./rollback"

export const VERSION_C = "55555555-5555-4555-8555-555555555555"
export const NEVER_SERVED_VERSION = "88888888-8888-4888-8888-888888888888"
export const OLDEST_DEPLOYMENT_ID = "66666666-6666-4666-8666-666666666666"
export const NEW_DEPLOYMENT_ID = "77777777-7777-4777-8777-777777777777"

export const SERVING_CREATED = "2024-03-01T00:00:00Z"
export const SPLIT_CREATED = "2024-02-01T00:00:00Z"
export const FIRST_CREATED = "2024-01-01T00:00:00Z"

export const DEPLOYMENTS_PATH = scriptPath("deployments")

/** A deployment as Cloudflare lists it, with its versions as `[version_id, percentage]` pairs. */
export function deployment(id: string, createdOn: string, versions: [string, number][]) {
  return {
    id,
    created_on: createdOn,
    source: "api",
    author_email: "ops@example.com",
    strategy: "percentage",
    annotations: { "workers/triggered_by": "deploy" },
    versions: versions.map(([version_id, percentage]) => ({ version_id, percentage })),
  }
}

export const SERVING = deployment(DEPLOYMENT_ID, SERVING_CREATED, [[VERSION_ID, 100]])
export const SPLIT = deployment(OLDER_DEPLOYMENT_ID, SPLIT_CREATED, [
  [OLDER_VERSION_ID, 75.5],
  [VERSION_C, 24.5],
])
export const FIRST = deployment(OLDEST_DEPLOYMENT_ID, FIRST_CREATED, [[OLDER_VERSION_ID, 100]])

/** Latest first: the serving deployment, then a split, then the first. */
export const HISTORY = [SERVING, SPLIT, FIRST]

export const NEW_DEPLOYMENT = {
  ...deployment(NEW_DEPLOYMENT_ID, "2024-03-02T00:00:00Z", [[OLDER_VERSION_ID, 100]]),
  annotations: { "workers/message": "Rolled back", "workers/triggered_by": "rollback" },
}

export const ARGS = {
  script: SCRIPT,
  versions: [{ version_id: OLDER_VERSION_ID, percentage: 100 }],
  replaces: DEPLOYMENT_ID,
}

/** `ARGS` with the versions given as `[version_id, percentage]` pairs. */
export function withVersions(...versions: [string, number][]) {
  return { ...ARGS, versions: versions.map(([version_id, percentage]) => ({ version_id, percentage })) }
}

/** The deployments list: page `n` answers `pages[n - 1]`, and an empty list beyond them. */
export function historyRoute(...pages: unknown[][]): FakeRoute {
  return {
    method: "GET",
    path: DEPLOYMENTS_PATH,
    reply: (request) => ok({ deployments: pages[Number(request.query.get("page")) - 1] ?? [] }),
  }
}

/** The deploy call, answering with the new deployment unless told otherwise. */
export function deployRoute(reply: FakeRoute["reply"] = ok(NEW_DEPLOYMENT)): FakeRoute {
  return { method: "POST", path: DEPLOYMENTS_PATH, reply }
}

/** Full page of deployments (the serving one first), as a Worker with a long history lists them. */
export function fullPage(first: unknown = SERVING): unknown[] {
  return [first, ...Array.from({ length: 99 }, () => SERVING)]
}

/** The tool wired to a fake Cloudflare that answers `routes`. */
export function rollbackFor(...routes: FakeRoute[]) {
  const { fetch, requests } = fakeCloudflare(routes)
  return { tool: defineWorkersRollback({ fetch, env: envFor() }), requests }
}

export function sent(requests: FakeRequest[], method: "GET" | "POST"): FakeRequest[] {
  return requests.filter((request) => request.method === method)
}
