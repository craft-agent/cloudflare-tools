import { describe, expect, test } from "bun:test"
import { ok, type FakeRoute } from "../cloudflare/testing"
import { callDescription } from "../describe"
import type { ErrorCode } from "../errors"
import { describing, refusing } from "../describe.fixtures"
import { ARGS, CTX, DEPLOYMENT_ID, OTHER_ID, TARGET, deploymentRoute, rollbackFor, sent } from "./rollback.fixtures"

const HEADLINE = { text: "About to roll back the Pages project {project}", values: { project: "my-project" } }
const EFFECT = { label: "Effect", value: { text: "visitors get it at once; rolling back again undoes it" } }
const SERVING = { label: "Serving now", value: "11111111  2024-01-01T00:00:00Z" }

describe("cloudflarePagesRollback: describe", () => {
  test("states its intent", () => {
    expect(rollbackFor().tool.intent).toBe("About to roll back a Pages project")
  })

  test("names the deployment serving now and the one to serve, with its date and branch, and writes nothing", async () => {
    const { tool, requests } = rollbackFor()

    const { description, asked } = await describing(tool, ARGS)

    expect(description).toEqual({
      headline: HEADLINE,
      facts: [SERVING, { label: "Serve instead", value: "66666666  2023-12-01T00:00:00Z  release" }, EFFECT],
    })
    expect(asked).toEqual([])
    expect(sent(requests, "POST")).toHaveLength(0)
  })

  test("leaves out the branch and the date the deployment does not have", async () => {
    const bare = { ...TARGET, created_on: null, deployment_trigger: { type: "ad_hoc", metadata: {} } }
    const { tool } = rollbackFor(deploymentRoute(ok(bare)))

    const { description } = await describing(tool, ARGS)

    expect(description.facts[1]).toEqual({ label: "Serve instead", value: "66666666" })
  })

  test("names the deployment by its id when it has no short id", async () => {
    const { tool } = rollbackFor(deploymentRoute(ok({ ...TARGET, short_id: null })))

    const { description } = await describing(tool, ARGS)

    expect(description.facts[1]!.value).toBe(`${TARGET.id}  2023-12-01T00:00:00Z  release`)
  })

  test("gives the same description twice for the same state", async () => {
    const { tool } = rollbackFor()

    const first = await describing(tool, ARGS)
    const second = await describing(tool, ARGS)

    expect(second.description).toEqual(first.description)
  })

  test("is accepted by the description check", async () => {
    const { tool } = rollbackFor()

    const answer = await callDescription(tool, ARGS, CTX)

    expect(answer?.headline).toEqual(HEADLINE)
    expect(answer?.facts).toHaveLength(3)
    expect(answer?.pins).toBeUndefined()
  })
})

describe("cloudflarePagesRollback: describe refuses where execute would", () => {
  const PREVIEW = { ...TARGET, environment: "preview" }
  const FAILED = { ...TARGET, latest_stage: { name: "build", status: "failure" } }

  test.each<[string, object, FakeRoute[], ErrorCode, string]>([
    ["a stale replaces", { ...ARGS, replaces: OTHER_ID }, [], "stale", "another deployment or rollback came first"],
    ["a preview deployment", ARGS, [deploymentRoute(ok(PREVIEW))], "invalid_argument", "is a preview deployment"],
    ["a failed build", ARGS, [deploymentRoute(ok(FAILED))], "invalid_argument", "did not build successfully"],
    ["the deployment serving now", { ...ARGS, deployment: DEPLOYMENT_ID }, [], "invalid_argument", "is already what"],
  ])("throws for %s, and writes and asks nothing", async (_what, args, routes, code, message) => {
    const { tool, requests } = rollbackFor(...routes)

    const { error, asked } = await refusing(tool, args)

    expect(error.code).toBe(code)
    expect(error.message).toContain(message)
    expect(asked).toEqual([])
    expect(sent(requests, "POST")).toHaveLength(0)
  })

  test("gives nothing to the description check for a call execute would refuse", async () => {
    const { tool } = rollbackFor()

    expect(await callDescription(tool, { ...ARGS, replaces: OTHER_ID }, CTX)).toBeUndefined()
  })
})
