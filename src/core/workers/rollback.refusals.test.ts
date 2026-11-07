import { describe, expect, test } from "bun:test"
import { toolError } from "../cloudflare/client.fixtures"
import { fail, ok, type FakeRoute } from "../cloudflare/testing"
import { invoke } from "../tool"
import { CTX } from "../zone/fixtures"
import { DEPLOYMENT_ID, OLDER_DEPLOYMENT_ID, OLDER_VERSION_ID, SCRIPT, VERSION_ID } from "./fixtures"
import {
  ARGS,
  DEPLOYMENTS_PATH,
  FIRST,
  FIRST_CREATED,
  HISTORY,
  NEVER_SERVED_VERSION,
  OLDEST_DEPLOYMENT_ID,
  SERVING,
  SERVING_CREATED,
  SPLIT_CREATED,
  VERSION_C,
  deployment,
  deployRoute,
  fullPage,
  historyRoute,
  rollbackFor,
  sent,
  withVersions,
} from "./rollback.fixtures"

/** Runs the call against `routes` and returns the error it refused with and what was sent. */
async function refusal(args: unknown, ...routes: FakeRoute[]) {
  const { tool, requests } = rollbackFor(...routes, deployRoute())
  const error = await toolError(invoke(tool, args, CTX))
  expect(sent(requests, "POST")).toHaveLength(0)
  return { error, requests }
}

describe("cloudflareWorkersRollback: refusals from the history", () => {
  test("is stale when another deployment came first", async () => {
    const { error } = await refusal({ ...ARGS, replaces: OLDER_DEPLOYMENT_ID }, historyRoute(HISTORY))

    expect(error.code).toBe("stale")
    expect(error.message).toBe(
      `Worker ${SCRIPT} is now serving deployment ${DEPLOYMENT_ID} (${SERVING_CREATED}), not ${OLDER_DEPLOYMENT_ID}: another deployment came first. Read cloudflare_workers_read deployments again before rolling back.`,
    )
  })

  test("refuses a version that never served, naming its place", async () => {
    const { error } = await refusal(
      withVersions([OLDER_VERSION_ID, 50], [NEVER_SERVED_VERSION, 50]),
      historyRoute(HISTORY),
    )

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toBe(
      `versions[1]: version ${NEVER_SERVED_VERSION} never served traffic before the deployment serving now, so this is not a rollback; deploying new code stays with Wrangler (wrangler versions deploy).`,
    )
  })

  test("refuses a version that served only in the deployment serving now", async () => {
    const { error } = await refusal(withVersions([OLDER_VERSION_ID, 50], [VERSION_ID, 50]), historyRoute(HISTORY))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain(`versions[1]: version ${VERSION_ID} never served traffic before`)
  })

  test("refuses a version that had a zero share in every earlier deployment", async () => {
    const zero = deployment(OLDER_DEPLOYMENT_ID, SPLIT_CREATED, [
      [OLDER_VERSION_ID, 100],
      [VERSION_C, 0],
    ])
    const { error } = await refusal(withVersions([VERSION_C, 100]), historyRoute([SERVING, zero]))

    expect(error.message).toContain(`versions[0]: version ${VERSION_C} never served traffic`)
  })

  test("refuses the same single version as now", async () => {
    const { error } = await refusal(
      withVersions([OLDER_VERSION_ID, 100]),
      historyRoute([deployment(DEPLOYMENT_ID, SERVING_CREATED, [[OLDER_VERSION_ID, 100]]), FIRST]),
    )

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain(`is already what Worker ${SCRIPT} serves`)
  })

  test("refuses the same split as now, in any order", async () => {
    const serving = deployment(DEPLOYMENT_ID, SERVING_CREATED, [
      [OLDER_VERSION_ID, 75.5],
      [VERSION_C, 24.5],
    ])
    const earlier = [
      deployment(OLDER_DEPLOYMENT_ID, SPLIT_CREATED, [[VERSION_C, 100]]),
      deployment(OLDEST_DEPLOYMENT_ID, FIRST_CREATED, [[OLDER_VERSION_ID, 100]]),
    ]
    const { error } = await refusal(
      withVersions([VERSION_C, 24.5], [OLDER_VERSION_ID, 75.5]),
      historyRoute([serving, ...earlier]),
    )

    expect(error.message).toContain(`is already what Worker ${SCRIPT} serves`)
  })

  test("refuses a Worker without deployments", async () => {
    const { error } = await refusal(ARGS, historyRoute([]))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("no deployment")
  })

  test("refuses a Worker that does not exist, pointing at the list", async () => {
    const { error } = await refusal(ARGS, {
      method: "GET",
      path: DEPLOYMENTS_PATH,
      reply: fail(404, [{ code: 10007, message: "This Worker does not exist" }]),
    })

    expect(error.code).toBe("not_found")
    expect(error.message).toContain(`No Worker ${SCRIPT} in the account default`)
  })

  test("reads at most ten pages", async () => {
    const { error, requests } = await refusal(withVersions([NEVER_SERVED_VERSION, 100]), {
      method: "GET",
      path: DEPLOYMENTS_PATH,
      reply: ok({ deployments: fullPage() }),
    })

    expect(error.message).toContain("never served traffic")
    expect(sent(requests, "GET")).toHaveLength(10)
  })

  test("refuses a reply whose deployments are not a list", async () => {
    const { error } = await refusal(ARGS, { method: "GET", path: DEPLOYMENTS_PATH, reply: ok({ deployments: "none" }) })

    expect(error.code).toBe("upstream_error")
  })
})
