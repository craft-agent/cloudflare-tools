import { describe, expect, test } from "bun:test"
import { toolError } from "../cloudflare/client.fixtures"
import { fail, ok, type FakeRoute } from "../cloudflare/testing"
import { invoke } from "../tool"
import {
  ARGS,
  CTX,
  DEPLOYMENT_ID,
  OTHER_ID,
  PROJECT,
  PROJECT_PATH,
  TARGET,
  TARGET_ID,
  deploymentRoute,
  projectRoute,
  rollbackFor,
  sent,
} from "./rollback.fixtures"

/** Runs the call against `routes` and returns the error it refused with; nothing was POSTed. */
async function refusal(args: unknown, ...routes: FakeRoute[]) {
  const { tool, requests } = rollbackFor(...routes)
  const error = await toolError(invoke(tool, args, CTX))
  expect(sent(requests, "POST")).toHaveLength(0)
  return { error, requests }
}

describe("cloudflarePagesRollback: refusals from the project", () => {
  test("is stale when another deployment is serving, naming it", async () => {
    const { error, requests } = await refusal({ ...ARGS, replaces: OTHER_ID })

    expect(error.code).toBe("stale")
    expect(error.message).toBe(
      `Pages project ${PROJECT} is now serving deployment 11111111 (${DEPLOYMENT_ID}, 2024-01-01T00:00:00Z), not ${OTHER_ID}: another deployment or rollback came first. Read cloudflare_pages_read deployments again before rolling back.`,
    )
    expect(sent(requests, "GET").map((request) => request.path)).toEqual([PROJECT_PATH])
  })

  test.each([null, "11111111", {}, { short_id: "11111111" }])(
    "refuses a project whose canonical deployment is %p",
    async (canonical) => {
      const { error } = await refusal(ARGS, projectRoute(canonical))

      expect(error.code).toBe("invalid_argument")
      expect(error.message).toBe(
        `Pages project ${PROJECT} has no production deployment serving now, so there is nothing to roll back from.`,
      )
    },
  )

  test("refuses the deployment that is serving now", async () => {
    const { error, requests } = await refusal({ ...ARGS, deployment: DEPLOYMENT_ID })

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toBe(`Deployment 11111111 is already what Pages project ${PROJECT} serves.`)
    expect(sent(requests, "GET")).toHaveLength(1)
  })

  test("refuses a project that does not exist, pointing at the list", async () => {
    const { error } = await refusal(ARGS, {
      method: "GET",
      path: PROJECT_PATH,
      reply: fail(404, [{ code: 8000007, message: "Project not found" }]),
    })

    expect(error.code).toBe("not_found")
    expect(error.message).toBe(
      `No Pages project ${PROJECT} in the account default; cloudflare_pages_read list shows its projects.`,
    )
  })

  test("refuses a project reply that is not an object", async () => {
    const { error } = await refusal(ARGS, { method: "GET", path: PROJECT_PATH, reply: ok([]) })

    expect(error.code).toBe("upstream_error")
  })
})

describe("cloudflarePagesRollback: refusals from the deployment", () => {
  test("refuses a deployment that does not exist, pointing at the deployments", async () => {
    const { error } = await refusal(
      ARGS,
      deploymentRoute(fail(404, [{ code: 8000009, message: "Deployment not found" }])),
    )

    expect(error.code).toBe("not_found")
    expect(error.message).toBe(
      `No deployment ${TARGET_ID} in Pages project ${PROJECT} of the account default; cloudflare_pages_read deployments lists them.`,
    )
  })

  test("refuses a deployment reply that is not an object", async () => {
    const { error } = await refusal(ARGS, deploymentRoute(ok(null)))

    expect(error.code).toBe("upstream_error")
  })

  test("refuses a preview deployment", async () => {
    const { error } = await refusal(ARGS, deploymentRoute(ok({ ...TARGET, environment: "preview" })))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toBe(
      "Deployment 66666666 is a preview deployment; only a production deployment can serve production.",
    )
  })

  test("refuses a skipped deployment", async () => {
    const { error } = await refusal(ARGS, deploymentRoute(ok({ ...TARGET, is_skipped: true })))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toBe("Deployment 66666666 was skipped, so it has nothing to serve.")
  })

  test("refuses a build that did not succeed, naming the stage", async () => {
    const failed = { ...TARGET, latest_stage: { name: "build", status: "failure" } }
    const { error } = await refusal(ARGS, deploymentRoute(ok(failed)))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toBe("Deployment 66666666 did not build successfully (stage build: failure).")
  })

  test("refuses a deployment that has no build status", async () => {
    const { error } = await refusal(ARGS, deploymentRoute(ok({ ...TARGET, latest_stage: undefined })))

    expect(error.message).toBe("Deployment 66666666 did not build successfully (stage unknown: unknown).")
  })

  test("names the deployment by its id when it has no short id", async () => {
    const { error } = await refusal(ARGS, deploymentRoute(ok({ ...TARGET, short_id: undefined, is_skipped: true })))

    expect(error.message).toBe(`Deployment ${TARGET_ID} was skipped, so it has nothing to serve.`)
  })
})
