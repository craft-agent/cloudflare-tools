import { describe, expect, test } from "bun:test"
import { ACCOUNT_ID, toolError } from "../cloudflare/client.fixtures"
import { ok } from "../cloudflare/testing"
import { writeTargets } from "../targets"
import { annotations, invoke, REQUIRES_USER_INTERACTION, toolMeta, type ConfirmRequest } from "../tool"
import { cloudflarePagesRollback } from "./rollback"
import {
  ARGS,
  CTX,
  DEPLOYMENT,
  DEPLOYMENT_ID,
  NEWER,
  NEWER_ID,
  PROJECT,
  PROJECT_PATH,
  ROLLBACK_PATH,
  TARGET,
  TARGET_ID,
  TARGET_PATH,
  deploymentRoute,
  projectRoute,
  rollbackFor,
  rollbackPath,
  rollbackRoute,
  sent,
} from "./rollback.fixtures"
import { shapeDeployment } from "./shape"

describe("cloudflarePagesRollback", () => {
  test("has the administrative annotations, the interaction meta and the pages toolset", () => {
    expect(annotations(cloudflarePagesRollback)).toEqual({
      title: "Roll back a Cloudflare Pages project",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    })
    expect(toolMeta(cloudflarePagesRollback)).toEqual({ [REQUIRES_USER_INTERACTION]: true })
    expect(cloudflarePagesRollback.id).toBe("cloudflare_pages_rollback")
    expect(cloudflarePagesRollback.toolset).toBe("pages")
  })

  test("rolls back to an older production deployment with two reads and one POST", async () => {
    const { tool, requests } = rollbackFor()

    const result = await invoke(tool, ARGS, CTX)

    expect(result).toEqual({
      label: "default",
      project: PROJECT,
      replaced: shapeDeployment(DEPLOYMENT, false),
      deployment: shapeDeployment(TARGET, true),
    })
    expect(result.replaced).toMatchObject({ id: DEPLOYMENT_ID, short_id: "11111111", live: false })
    expect(result.deployment).toMatchObject({ id: TARGET_ID, short_id: "66666666", live: true })
    expect(sent(requests, "GET").map((request) => request.path)).toEqual([PROJECT_PATH, TARGET_PATH])
    const writes = sent(requests, "POST")
    expect(writes).toHaveLength(1)
    expect(writes[0]!.path).toBe(ROLLBACK_PATH)
    expect(writes[0]!.query.toString()).toBe("")
    expect(writes[0]!.body).toBeUndefined()
  })

  test("rolls forward to a newer production deployment", async () => {
    const { tool, requests } = rollbackFor(
      projectRoute(TARGET),
      deploymentRoute(ok(NEWER), NEWER_ID),
      rollbackRoute(ok(NEWER), NEWER_ID),
    )

    const result = await invoke(tool, { ...ARGS, deployment: NEWER_ID, replaces: TARGET_ID }, CTX)

    expect(result.replaced.id).toBe(TARGET_ID)
    expect(result.deployment).toEqual(shapeDeployment(NEWER, true))
    expect(sent(requests, "POST").map((request) => request.path)).toEqual([rollbackPath(NEWER_ID)])
  })

  test("takes the deployment Cloudflare reports, and the one it read when the reply is not an object", async () => {
    const reported = { ...TARGET, aliases: ["https://my-project.pages.dev"] }

    const sameAsReported = await invoke(rollbackFor(rollbackRoute(ok(reported))).tool, ARGS, CTX)
    const fromRead = await invoke(rollbackFor(rollbackRoute(ok(null))).tool, ARGS, CTX)
    const withoutId = await invoke(rollbackFor(rollbackRoute(ok({ aliases: ["x"] }))).tool, ARGS, CTX)

    expect(sameAsReported.deployment).toEqual(shapeDeployment(reported, true))
    expect(fromRead.deployment).toEqual(shapeDeployment(TARGET, true))
    expect(withoutId.deployment).toEqual(shapeDeployment(TARGET, true))
  })

  test("trims and lowercases both ids", async () => {
    const { tool, requests } = rollbackFor()

    await invoke(
      tool,
      { project: ` ${PROJECT} `, deployment: ` ${TARGET_ID.toUpperCase()} `, replaces: DEPLOYMENT_ID.toUpperCase() },
      CTX,
    )

    expect(sent(requests, "POST")[0]!.path).toBe(ROLLBACK_PATH)
  })
})

describe("cloudflarePagesRollback: confirmation", () => {
  test("asks with one plain line naming the project, the account and both deployments", async () => {
    const asked: ConfirmRequest[] = []
    const { tool } = rollbackFor()

    await invoke(tool, ARGS, {
      ...CTX,
      confirm: async (request) => {
        asked.push(request)
        return true
      },
    })

    expect(asked).toEqual([
      {
        tool: "cloudflare_pages_rollback",
        message: `Roll back Pages project ${PROJECT} in the Cloudflare account default: serve deployment 66666666 (2023-12-01T00:00:00Z, branch release) instead of 11111111 (2024-01-01T00:00:00Z). Visitors get it at once; rolling back again to 11111111 undoes it.`,
      },
    ])
  })

  test("leaves the branch out when the deployment has none", async () => {
    const asked: ConfirmRequest[] = []
    const { tool } = rollbackFor(deploymentRoute(ok({ ...TARGET, deployment_trigger: undefined })))

    await invoke(tool, ARGS, {
      ...CTX,
      confirm: async (request) => {
        asked.push(request)
        return true
      },
    })

    expect(asked[0]!.message).toContain("serve deployment 66666666 (2023-12-01T00:00:00Z) instead of")
  })

  test("sends nothing when the person declines", async () => {
    const { tool, requests } = rollbackFor()

    const error = await toolError(invoke(tool, ARGS, { ...CTX, confirm: async () => false }))

    expect(error.code).toBe("declined")
    expect(sent(requests, "POST")).toHaveLength(0)
  })

  test("goes on without a confirm hook, the harness having approved", async () => {
    const { tool, requests } = rollbackFor()

    await invoke(tool, ARGS, CTX)

    expect(sent(requests, "POST")).toHaveLength(1)
  })
})

describe("cloudflarePagesRollback: targets", () => {
  test("names the account and the project without any request", async () => {
    const { tool, requests } = rollbackFor()

    expect(await writeTargets(tool, ARGS, CTX)).toEqual([`${ACCOUNT_ID}/pages/projects/${PROJECT}`])
    expect(requests).toHaveLength(0)
  })

  test("are `*` for an invalid project name", async () => {
    const { tool } = rollbackFor()

    expect(await tool.targets!({ ...ARGS, project: "Bad Name" }, CTX)).toEqual(["*"])
  })
})
