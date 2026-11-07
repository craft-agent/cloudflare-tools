import { describe, expect, test } from "bun:test"
import { toolError } from "../cloudflare/client.fixtures"
import { invoke } from "../tool"
import { CTX } from "../zone/fixtures"
import { OLDER_VERSION_ID } from "./fixtures"
import { ARGS, HISTORY, VERSION_C, deployRoute, historyRoute, rollbackFor, withVersions } from "./rollback.fixtures"

/** The refusal of the arguments alone: nothing at all is sent. */
async function refusal(args: unknown) {
  const { tool, requests } = rollbackFor(historyRoute(HISTORY), deployRoute())
  const error = await toolError(invoke(tool, args, CTX))
  expect(requests).toHaveLength(0)
  return error
}

describe("cloudflareWorkersRollback: arguments", () => {
  test("refuses percentages that do not add up to 100", async () => {
    const error = await refusal(withVersions([OLDER_VERSION_ID, 50], [VERSION_C, 40]))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toBe("versions: the percentages add up to 90, not 100.")
  })

  test("refuses a single version below 100", async () => {
    expect((await refusal(withVersions([OLDER_VERSION_ID, 99.99]))).message).toContain("add up to 99.99")
  })

  test.each([0, -5, 100.01, 0.005, 33.333, 1.005])("refuses the percentage %p", async (percentage) => {
    const error = await refusal(withVersions([OLDER_VERSION_ID, percentage], [VERSION_C, 100 - percentage]))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toBe("versions[0]: percentage must be a number from 0.01 to 100 with at most two decimals.")
  })

  test("names the entry whose percentage is wrong", async () => {
    const error = await refusal(withVersions([OLDER_VERSION_ID, 66.667], [VERSION_C, 33.333]))

    expect(error.message).toContain("versions[0]: percentage")
  })

  test("refuses the same version twice, whatever the case", async () => {
    const error = await refusal(withVersions([OLDER_VERSION_ID, 50], [OLDER_VERSION_ID.toUpperCase(), 50]))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toBe(`versions[1] repeats versions[0]: the version ${OLDER_VERSION_ID} can be listed once.`)
  })

  test.each(["not-a-uuid", "", ` ${OLDER_VERSION_ID}`, OLDER_VERSION_ID.replaceAll("-", "")])(
    "refuses the version id %p",
    async (versionId) => {
      const error = await refusal(withVersions([OLDER_VERSION_ID, 50], [versionId, 50]))

      expect(error.code).toBe("invalid_argument")
      expect(error.message).toContain("versions[1].version_id must be a UUID")
    },
  )

  test("refuses a `replaces` that is not a UUID", async () => {
    const error = await refusal({ ...ARGS, replaces: "latest" })

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("`replaces` must be a UUID")
  })

  test.each(["first\nsecond", "first\r", "\n", "   ", "", "x".repeat(101)])(
    "refuses the message %p",
    async (message) => {
      const error = await refusal({ ...ARGS, message })

      expect(error.code).toBe("invalid_argument")
      expect(error.message).toContain("`message` must be one line of 1 to 100 characters")
    },
  )

  test("takes a message of exactly 100 characters, counted as characters", async () => {
    const { tool, requests } = rollbackFor(historyRoute(HISTORY), deployRoute())

    await invoke(tool, { ...ARGS, message: "é".repeat(100) }, CTX)

    expect(requests.find((request) => request.method === "POST")!.body).toMatchObject({
      annotations: { "workers/message": "é".repeat(100) },
    })
  })

  test("refuses an invalid Worker name", async () => {
    const error = await refusal({ ...ARGS, script: "Bad Name" })

    expect(error.code).toBe("invalid_argument")
  })

  test("refuses three versions, none and unknown fields", async () => {
    const three = withVersions([OLDER_VERSION_ID, 40], [VERSION_C, 40], ["99999999-9999-4999-8999-999999999999", 20])

    expect((await refusal(three)).code).toBe("invalid_argument")
    expect((await refusal({ ...ARGS, versions: [] })).code).toBe("invalid_argument")
    expect((await refusal({ ...ARGS, force: true })).message).toContain("force: unknown argument")
    expect(
      (await refusal({ ...ARGS, versions: [{ version_id: OLDER_VERSION_ID, percentage: 100, extra: 1 }] })).message,
    ).toContain("versions.0.extra: unknown argument")
  })
})
