import { describe, expect, test } from "bun:test"
import { callDescription } from "../describe"
import { describing, refusing } from "../describe.fixtures"
import type { ErrorCode } from "../errors"
import { CTX } from "../zone/fixtures"
import { DEPLOYMENT_ID, OLDER_VERSION_ID, SCRIPT, VERSION_ID } from "./fixtures"
import {
  ARGS,
  HISTORY,
  SERVING_CREATED,
  NEVER_SERVED_VERSION,
  VERSION_C,
  deployRoute,
  deployment,
  historyRoute,
  rollbackFor,
  sent,
  withVersions,
} from "./rollback.fixtures"

const HEADLINE = { text: "About to roll back the Worker {script}", values: { script: SCRIPT } }
const EFFECT = {
  label: "Effect",
  value: { text: "visitors get that code at once; the Worker's secrets stay as they are now" },
}

/** The tool answering the `HISTORY`. */
function rollbackWithHistory(history: unknown[] = HISTORY) {
  return rollbackFor(historyRoute(history), deployRoute())
}

describe("cloudflareWorkersRollback: describe", () => {
  test("states its intent", () => {
    expect(rollbackWithHistory().tool.intent).toBe("About to roll back a Worker")
  })

  test("names the version serving now, the one to serve and the default message, and deploys nothing", async () => {
    const { tool, requests } = rollbackWithHistory()

    const { description, asked } = await describing(tool, ARGS)

    expect(description).toEqual({
      headline: HEADLINE,
      facts: [
        { label: "Serving now", value: `${VERSION_ID} 100%` },
        { label: "Serve instead", value: `${OLDER_VERSION_ID} 100%` },
        EFFECT,
      ],
      text: { label: "Message", body: "Rolled back" },
    })
    expect(asked).toEqual([])
    expect(sent(requests, "POST")).toHaveLength(0)
  })

  test("shows the serving shares as the checks read them: rounded to hundredths, a share that rounds to none left out", async () => {
    const serving = deployment(DEPLOYMENT_ID, SERVING_CREATED, [
      [VERSION_ID.toUpperCase(), 99.996],
      [VERSION_C, 0.004],
    ])
    const { tool } = rollbackWithHistory([serving, ...HISTORY.slice(1)])

    const { description } = await describing(tool, ARGS)

    expect(description.facts[0]).toEqual({ label: "Serving now", value: `${VERSION_ID} 100%` })
  })

  test("names two versions with their shares and the message given", async () => {
    const { tool } = rollbackWithHistory()

    const { description } = await describing(tool, {
      ...withVersions([OLDER_VERSION_ID, 75.5], [VERSION_C, 24.5]),
      message: "  Back to the split  ",
    })

    expect(description.facts[1]).toEqual({
      label: "Serve instead",
      value: `${OLDER_VERSION_ID} 75.5%, ${VERSION_C} 24.5%`,
    })
    expect(description.text).toEqual({ label: "Message", body: "Back to the split" })
  })

  test("names every version serving now that has a share", async () => {
    const serving = {
      ...HISTORY[0]!,
      versions: [
        { version_id: VERSION_ID, percentage: 70 },
        { version_id: VERSION_C, percentage: 30 },
        { version_id: NEVER_SERVED_VERSION, percentage: 0 },
      ],
    }
    const { tool } = rollbackWithHistory([serving, ...HISTORY.slice(1)])

    const { description } = await describing(tool, ARGS)

    expect(description.facts[0]).toEqual({ label: "Serving now", value: `${VERSION_ID} 70%, ${VERSION_C} 30%` })
  })

  test("gives the same description twice for the same state", async () => {
    const { tool } = rollbackWithHistory()

    const first = await describing(tool, ARGS)
    const second = await describing(tool, ARGS)

    expect(second.description).toEqual(first.description)
  })

  test("is accepted by the description check", async () => {
    const { tool } = rollbackWithHistory()

    const answer = await callDescription(tool, ARGS, CTX)

    expect(answer?.headline).toEqual(HEADLINE)
    expect(answer?.facts).toHaveLength(3)
    expect(answer?.text).toEqual({ label: "Message", body: "Rolled back" })
    expect(answer?.pins).toBeUndefined()
  })
})

describe("cloudflareWorkersRollback: describe refuses where execute would", () => {
  test.each<[string, object, ErrorCode, string]>([
    ["a stale replaces", { ...ARGS, replaces: VERSION_ID }, "stale", "another deployment came first"],
    [
      "a version that never served",
      withVersions([OLDER_VERSION_ID, 50], [NEVER_SERVED_VERSION, 50]),
      "invalid_argument",
      "never served traffic",
    ],
    [
      "the split already serving",
      withVersions([VERSION_ID, 100]),
      "invalid_argument",
      "the split is already what Worker",
    ],
  ])("throws for %s, and deploys and asks nothing", async (_what, args, code, message) => {
    const servedBefore = { ...HISTORY[2]!, versions: [{ version_id: VERSION_ID, percentage: 100 }] }
    const { tool, requests } = rollbackWithHistory([...HISTORY, servedBefore])

    const { error, asked } = await refusing(tool, args)

    expect(error.code).toBe(code)
    expect(error.message).toContain(message)
    expect(asked).toEqual([])
    expect(sent(requests, "POST")).toHaveLength(0)
  })

  test("gives nothing to the description check for a call execute would refuse", async () => {
    const { tool } = rollbackWithHistory()

    expect(await callDescription(tool, { ...ARGS, replaces: VERSION_ID }, CTX)).toBeUndefined()
  })
})
