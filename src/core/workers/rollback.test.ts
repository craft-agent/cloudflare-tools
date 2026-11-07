import { describe, expect, test } from "bun:test"
import { ACCOUNT_ID, toolError } from "../cloudflare/client.fixtures"
import { writeTargets } from "../targets"
import { annotations, invoke, REQUIRES_USER_INTERACTION, toolMeta, type ConfirmRequest } from "../tool"
import { CTX } from "../zone/fixtures"
import { DEPLOYMENT_ID, OLDER_VERSION_ID, SCRIPT, VERSION_ID } from "./fixtures"
import { cloudflareWorkersRollback } from "./rollback"
import {
  ARGS,
  DEPLOYMENTS_PATH,
  HISTORY,
  NEW_DEPLOYMENT_ID,
  SERVING,
  SPLIT,
  SPLIT_CREATED,
  VERSION_C,
  deployRoute,
  fullPage,
  historyRoute,
  rollbackFor,
  sent,
  withVersions,
} from "./rollback.fixtures"

const SPLIT_ARGS = withVersions([OLDER_VERSION_ID, 75.5], [VERSION_C, 24.5])

/** Rolls back with `args` against `history`, approving the confirmation; returns what the person was asked. */
async function askedFor(args: unknown, history: unknown[]): Promise<ConfirmRequest[]> {
  const asked: ConfirmRequest[] = []
  const { tool } = rollbackFor(historyRoute(history), deployRoute())
  await invoke(tool, args, {
    ...CTX,
    confirm: async (request) => {
      asked.push(request)
      return true
    },
  })
  return asked
}

describe("cloudflareWorkersRollback", () => {
  test("has the administrative annotations, the interaction meta and the workers toolset", () => {
    expect(annotations(cloudflareWorkersRollback)).toEqual({
      title: "Roll back a Cloudflare Worker",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    })
    expect(toolMeta(cloudflareWorkersRollback)).toEqual({ [REQUIRES_USER_INTERACTION]: true })
    expect(cloudflareWorkersRollback.id).toBe("cloudflare_workers_rollback")
    expect(cloudflareWorkersRollback.toolset).toBe("workers")
  })

  test("rolls back to the single version of an earlier deployment with one read and one deploy", async () => {
    const { tool, requests } = rollbackFor(historyRoute(HISTORY), deployRoute())

    const result = await invoke(tool, ARGS, CTX)

    expect(result).toEqual({
      label: "default",
      script: SCRIPT,
      replaced: {
        id: DEPLOYMENT_ID,
        created_on: "2024-03-01T00:00:00Z",
        source: "api",
        author_email: "ops@example.com",
        message: null,
        triggered_by: "deploy",
        versions: [{ version_id: VERSION_ID, percentage: 100 }],
      },
      deployment: {
        id: NEW_DEPLOYMENT_ID,
        created_on: "2024-03-02T00:00:00Z",
        source: "api",
        author_email: "ops@example.com",
        message: "Rolled back",
        triggered_by: "rollback",
        versions: [{ version_id: OLDER_VERSION_ID, percentage: 100 }],
      },
    })
    const reads = sent(requests, "GET")
    expect(reads).toHaveLength(1)
    expect(reads[0]!.path).toBe(DEPLOYMENTS_PATH)
    expect(reads[0]!.query.get("per_page")).toBe("100")
    expect(reads[0]!.query.get("page")).toBe("1")
    const writes = sent(requests, "POST")
    expect(writes).toHaveLength(1)
    expect(writes[0]!.path).toBe(DEPLOYMENTS_PATH)
    expect(writes[0]!.query.toString()).toBe("")
    expect(writes[0]!.body).toEqual({
      strategy: "percentage",
      versions: [{ version_id: OLDER_VERSION_ID, percentage: 100 }],
      annotations: { "workers/message": "Rolled back" },
    })
  })

  test("sends a two-version split with a trimmed message", async () => {
    const { tool, requests } = rollbackFor(historyRoute(HISTORY), deployRoute())

    await invoke(tool, { ...SPLIT_ARGS, message: "  Back to the good one  " }, CTX)

    expect(sent(requests, "POST")[0]!.body).toEqual({
      strategy: "percentage",
      versions: [
        { version_id: OLDER_VERSION_ID, percentage: 75.5 },
        { version_id: VERSION_C, percentage: 24.5 },
      ],
      annotations: { "workers/message": "Back to the good one" },
    })
  })

  test("adds decimals up in hundredths and lowercases ids", async () => {
    const { tool, requests } = rollbackFor(historyRoute(HISTORY), deployRoute())

    await invoke(
      tool,
      {
        ...ARGS,
        replaces: DEPLOYMENT_ID.toUpperCase(),
        versions: [
          { version_id: OLDER_VERSION_ID.toUpperCase(), percentage: 0.1 },
          { version_id: VERSION_C, percentage: 99.9 },
        ],
      },
      CTX,
    )

    expect(sent(requests, "POST")[0]!.body).toMatchObject({
      versions: [
        { version_id: OLDER_VERSION_ID, percentage: 0.1 },
        { version_id: VERSION_C, percentage: 99.9 },
      ],
    })
  })

  test("fills the new deployment from what it sent when Cloudflare replies with its id alone", async () => {
    const reply = { body: { success: true, result: { id: NEW_DEPLOYMENT_ID } } }
    const { tool } = rollbackFor(historyRoute(HISTORY), deployRoute(reply))

    const result = await invoke(tool, { ...SPLIT_ARGS, message: "Back" }, CTX)

    expect(result.deployment).toEqual({
      id: NEW_DEPLOYMENT_ID,
      created_on: null,
      source: null,
      author_email: null,
      message: "Back",
      triggered_by: null,
      versions: [
        { version_id: OLDER_VERSION_ID, percentage: 75.5 },
        { version_id: VERSION_C, percentage: 24.5 },
      ],
    })
  })

  test("returns a null deployment when the reply holds none", async () => {
    const { tool } = rollbackFor(historyRoute(HISTORY), deployRoute({ body: { success: true, result: null } }))

    const result = await invoke(tool, ARGS, CTX)

    expect(result.deployment).toBeNull()
    expect(result.replaced.id).toBe(DEPLOYMENT_ID)
  })

  test("finds a version that served on the second page and stops at a short page", async () => {
    const { tool, requests } = rollbackFor(historyRoute(fullPage(), [SPLIT]), deployRoute())

    await invoke(tool, ARGS, CTX)

    const reads = sent(requests, "GET")
    expect(reads.map((request) => request.query.get("page"))).toEqual(["1", "2"])
    expect(reads.every((request) => request.query.get("per_page") === "100")).toBe(true)
    expect(sent(requests, "POST")).toHaveLength(1)
  })

  test("reads one page when the first is short", async () => {
    const { tool, requests } = rollbackFor(historyRoute(HISTORY, [SPLIT]), deployRoute())

    await invoke(tool, ARGS, CTX)

    expect(sent(requests, "GET")).toHaveLength(1)
  })
})

describe("cloudflareWorkersRollback: confirmation", () => {
  test("asks with one plain line naming the Worker, the account and the versions", async () => {
    const asked = await askedFor(ARGS, HISTORY)

    expect(asked).toEqual([
      {
        tool: "cloudflare_workers_rollback",
        message: `Roll back Worker ${SCRIPT} in the Cloudflare account default: serve ${OLDER_VERSION_ID} at 100% (served in a deployment of ${SPLIT_CREATED}) instead of ${VERSION_ID} at 100%. Visitors get that code at once; the Worker's secrets stay as they are now.`,
      },
    ])
  })

  test("lists both versions of a split with their shares", async () => {
    const asked = await askedFor(SPLIT_ARGS, [SERVING, SPLIT])

    expect(asked[0]!.message).toContain(
      `serve ${OLDER_VERSION_ID} at 75.5% (served in a deployment of ${SPLIT_CREATED}) and ${VERSION_C} at 24.5% (served in a deployment of ${SPLIT_CREATED}) instead of ${VERSION_ID} at 100%.`,
    )
  })

  test("sends nothing when the person declines", async () => {
    const { tool, requests } = rollbackFor(historyRoute(HISTORY), deployRoute())

    const error = await toolError(invoke(tool, ARGS, { ...CTX, confirm: async () => false }))

    expect(error.code).toBe("declined")
    expect(sent(requests, "POST")).toHaveLength(0)
  })

  test("goes on without a confirm hook, the harness having approved", async () => {
    const { tool, requests } = rollbackFor(historyRoute(HISTORY), deployRoute())

    await invoke(tool, ARGS, CTX)

    expect(sent(requests, "POST")).toHaveLength(1)
  })

  test("says so when the earlier deployment has no date", async () => {
    const asked = await askedFor(ARGS, [SERVING, { ...SPLIT, created_on: null }])

    expect(asked[0]!.message).toContain("(served in an earlier deployment)")
  })
})

describe("cloudflareWorkersRollback: targets", () => {
  test("names the account and the Worker without any request", async () => {
    const { tool, requests } = rollbackFor()

    expect(await writeTargets(tool, ARGS, CTX)).toEqual([`${ACCOUNT_ID}/workers/scripts/${SCRIPT}`])
    expect(requests).toHaveLength(0)
  })

  test("are `*` for an invalid script name", async () => {
    const { tool } = rollbackFor()

    expect(await tool.targets!({ ...ARGS, script: "Bad Name" }, CTX)).toEqual(["*"])
  })
})
