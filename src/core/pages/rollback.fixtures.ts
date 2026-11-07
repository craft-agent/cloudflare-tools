import { envFor } from "../cloudflare/client.fixtures"
import { fakeCloudflare, ok, type FakeReply, type FakeRequest, type FakeRoute } from "../cloudflare/testing"
import { DEPLOYMENT, DEPLOYMENT_ID, DEPLOYMENTS_PATH, PROJECT, PROJECT_ENTRY, PROJECT_PATH } from "./fixtures"
import { definePagesRollback } from "./rollback"

export { CTX, DEPLOYMENT, DEPLOYMENT_ID, DEPLOYMENTS_PATH, PROJECT, PROJECT_PATH } from "./fixtures"

export const TARGET_ID = "66666666-6666-4666-8666-666666666666"
export const NEWER_ID = "77777777-7777-4777-8777-777777777777"
export const OTHER_ID = "88888888-8888-4888-8888-888888888888"

export function deploymentPath(id: string = TARGET_ID): string {
  return `${DEPLOYMENTS_PATH}/${id}`
}

export function rollbackPath(id: string = TARGET_ID): string {
  return `${DEPLOYMENTS_PATH}/${id}/rollback`
}

export const TARGET_PATH = deploymentPath(TARGET_ID)
export const ROLLBACK_PATH = rollbackPath(TARGET_ID)

/** An earlier production deployment that built successfully: what a rollback goes back to. */
export const TARGET = {
  ...DEPLOYMENT,
  id: TARGET_ID,
  short_id: "66666666",
  url: "https://66666666.my-project.pages.dev",
  aliases: [],
  created_on: "2023-12-01T00:00:00Z",
  deployment_trigger: { type: "github:push", metadata: { branch: "release", commit_hash: "b".repeat(40) } },
}

/** A newer production deployment than `DEPLOYMENT`, which a project can be rolled forward to. */
export const NEWER = {
  ...DEPLOYMENT,
  id: NEWER_ID,
  short_id: "77777777",
  url: "https://77777777.my-project.pages.dev",
  created_on: "2024-02-01T00:00:00Z",
}

export const ARGS = { project: PROJECT, deployment: TARGET_ID, replaces: DEPLOYMENT_ID }

/** The project, serving `canonical` as its production deployment. */
export function projectRoute(canonical: unknown = DEPLOYMENT): FakeRoute {
  return { method: "GET", path: PROJECT_PATH, reply: ok({ ...PROJECT_ENTRY, canonical_deployment: canonical }) }
}

/** One deployment of the project, answering `reply`. */
export function deploymentRoute(reply: FakeReply = ok(TARGET), id: string = TARGET_ID): FakeRoute {
  return { method: "GET", path: deploymentPath(id), reply }
}

/** The rollback call, answering the deployment it switched to unless told otherwise. */
export function rollbackRoute(reply: FakeReply | (() => FakeReply) = ok(TARGET), id: string = TARGET_ID): FakeRoute {
  return { method: "POST", path: rollbackPath(id), reply }
}

/** The tool wired to a fake Cloudflare: the `routes` given first, then the project, `TARGET` and its rollback. */
export function rollbackFor(...routes: FakeRoute[]) {
  const { fetch, requests } = fakeCloudflare([...routes, projectRoute(), deploymentRoute(), rollbackRoute()])
  return { tool: definePagesRollback({ fetch, env: envFor() }), requests }
}

export function sent(requests: FakeRequest[], method: "GET" | "POST"): FakeRequest[] {
  return requests.filter((request) => request.method === method)
}
