import { describe, expect, test } from "bun:test"
import { toolError } from "../cloudflare/client.fixtures"
import { invoke } from "../tool"
import { ARGS, CTX, DEPLOYMENT_ID, rollbackFor } from "./rollback.fixtures"

const INVALID_IDS = ["", "11111111", "latest", `${DEPLOYMENT_ID}0`, "11111111-1111-4111-8111-11111111111g"] as const

/** The refusal of the arguments alone: nothing at all is sent. */
async function refusal(args: unknown) {
  const { tool, requests } = rollbackFor()
  const error = await toolError(invoke(tool, args, CTX))
  expect(requests).toHaveLength(0)
  return error
}

describe("cloudflarePagesRollback: arguments", () => {
  test.each(INVALID_IDS)("refuses the deployment id %p, naming `deployment`", async (deployment) => {
    const error = await refusal({ ...ARGS, deployment })

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("`deployment` must be a deployment's id (a UUID)")
  })

  test.each(INVALID_IDS)("refuses the id %p of `replaces`, naming `replaces`", async (replaces) => {
    const error = await refusal({ ...ARGS, replaces })

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("`replaces` must be the id (a UUID) of the production deployment serving now")
    expect(error.message).not.toContain("`deployment`")
  })

  test("refuses an invalid project name", async () => {
    const error = await refusal({ ...ARGS, project: "Bad Name" })

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("`project` must be")
  })

  test("refuses unknown and missing fields", async () => {
    expect((await refusal({ ...ARGS, force: true })).message).toContain("force: unknown argument")
    expect((await refusal({ project: ARGS.project, deployment: ARGS.deployment })).code).toBe("invalid_argument")
    expect((await refusal({ ...ARGS, replaces: undefined })).code).toBe("invalid_argument")
  })
})
