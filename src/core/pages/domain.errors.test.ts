import { describe, expect, test } from "bun:test"
import { rejection, toolError } from "../cloudflare/client.fixtures"
import { fail, ok, type FakeReply, type FakeRequest } from "../cloudflare/testing"
import { isAbortError, isToolError } from "../errors"
import { invoke, type ToolSpec } from "../tool"
import { OTHER_ACCOUNT_ID } from "../zone/fixtures"
import {
  ACCOUNT_ZONE_ID,
  ACTIVE_DOMAIN,
  ARGS,
  CTX,
  GONE_ERROR as GONE,
  NAME,
  NEW_DOMAIN,
  PAGES_CNAME,
  PROJECT_PATH,
  RECORDS_PATH,
  SHAPED_PAGES_CNAME,
  ZONE_NAME,
  ZONE_PATH,
  addFor,
  addRoute,
  recordsRoute,
  removeFor,
  removeRoute,
  sent,
} from "./domain.fixtures"
import { shapeDomain } from "./shape"

const RESERVED = { code: 8000015, message: "This domain is reserved and unavailable for use" }

/** Adds with the POST answering `reply`; returns the error it failed with, having sent exactly one POST. */
async function addFailedWith(reply: FakeReply | (() => FakeReply)) {
  const { tool, requests } = addFor(addRoute(reply))
  const error = await toolError(invoke(tool, ARGS, CTX))
  expect(sent(requests, "POST")).toHaveLength(1)
  return error
}

/** Removes with the DELETE answering `reply`; returns the error it failed with, having sent exactly one DELETE. */
async function removeFailedWith(reply: FakeReply | (() => FakeReply)) {
  const { tool, requests } = removeFor(removeRoute(reply))
  const error = await toolError(invoke(tool, ARGS, CTX))
  expect(sent(requests, "DELETE")).toHaveLength(1)
  return error
}

/** Both tools, each wired to its own fake Cloudflare. */
function bothTools(): { tool: ToolSpec; requests: FakeRequest[] }[] {
  return [addFor(), removeFor()]
}

describe("domain add and remove: Cloudflare's refusal", () => {
  test("add keeps the code of a 400 and says nothing was added", async () => {
    const error = await addFailedWith(fail(400, [RESERVED]))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toBe(`${RESERVED.code}: ${RESERVED.message} Nothing was added.`)
    expect(isToolError(error.cause)).toBe(true)
  })

  test("remove keeps the code of a 400 and says nothing was removed", async () => {
    const error = await removeFailedWith(fail(400, [GONE]))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toBe(`${GONE.code}: ${GONE.message} Nothing was removed.`)
  })

  test.each([
    [404, "not_found"],
    [403, "forbidden"],
    [429, "rate_limited"],
  ] as const)("both keep the code of a %p", async (status, code) => {
    const added = await addFailedWith(fail(status, [{ code: 10002, message: "Refused" }]))
    const removed = await removeFailedWith(fail(status, [{ code: 10002, message: "Refused" }]))

    expect(added.code).toBe(code)
    expect(added.message).toEndWith(" Nothing was added.")
    expect(removed.code).toBe(code)
    expect(removed.message).toEndWith(" Nothing was removed.")
  })

  test("both say nothing happened for a 4xx the client has no code for", async () => {
    const added = await addFailedWith(fail(409, [{ code: 10003, message: "Conflict" }]))
    const removed = await removeFailedWith(fail(409, [{ code: 10003, message: "Conflict" }]))

    expect(added.code).toBe("upstream_error")
    expect(added.message).toBe("Cloudflare answered HTTP 409: 10003: Conflict Nothing was added.")
    expect(removed.message).toBe("Cloudflare answered HTTP 409: 10003: Conflict Nothing was removed.")
  })
})

describe("domain add and remove: failures that do not tell", () => {
  test("add says Cloudflare may or may not have added it after a 500", async () => {
    const error = await addFailedWith(fail(500, [{ code: 1000, message: "Down" }]))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe(
      "Cloudflare answered HTTP 500: 1000: Down Cloudflare may or may not have added it; read cloudflare_pages_read domains before sending it again.",
    )
  })

  test("remove says Cloudflare may or may not have removed it when the network fails", async () => {
    const error = await removeFailedWith(() => {
      throw new Error("connection reset")
    })

    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe(
      "Cloudflare could not be reached: connection reset Cloudflare may or may not have removed it; read cloudflare_pages_read domains before sending it again.",
    )
  })

  test.each([
    ["add", addFor, addRoute],
    ["remove", removeFor, removeRoute],
  ] as const)("a cancellation during the write of %s passes on untouched", async (_tool, toolFor, routeFor) => {
    const controller = new AbortController()
    const { tool } = toolFor(
      routeFor(() => {
        controller.abort()
        return ok(null)
      }),
    )

    const error = await rejection(invoke(tool as ToolSpec, ARGS, { ...CTX, signal: controller.signal }))

    expect(isAbortError(error)).toBe(true)
    expect(isToolError(error)).toBe(false)
  })
})

describe("domain add and remove: a failed DNS read does not lose the write", () => {
  test("add returns the domain with the error under `dns` when the records cannot be read", async () => {
    const { tool, requests } = addFor(recordsRoute(fail(403, [{ code: 10000, message: "Authentication error" }])))

    const result = await invoke(tool, ARGS, CTX)

    expect(result.domain).toEqual(shapeDomain(NEW_DOMAIN))
    expect(result.cname.name).toBe(NAME)
    expect(result.dns).toBeNull()
    expect(result.errors).toEqual({ dns: "forbidden: 10000: Authentication error" })
    expect(sent(requests, "POST")).toHaveLength(1)
  })

  test("remove returns the domain with the error under `dns` when the records cannot be read", async () => {
    const { tool, requests } = removeFor(recordsRoute(fail(500, [{ code: 1000, message: "Down" }])))

    const result = await invoke(tool, ARGS, CTX)

    expect(result.removed).toEqual(shapeDomain(ACTIVE_DOMAIN))
    expect(result.dns).toBeNull()
    expect(result.errors).toEqual({ dns: "upstream_error: Cloudflare answered HTTP 500: 1000: Down" })
    expect(sent(requests, "DELETE")).toHaveLength(1)
  })

  test("a records reply that is not a list is recorded the same way", async () => {
    const { tool } = addFor(recordsRoute(ok({ not: "a list" })))

    const result = await invoke(tool, ARGS, CTX)

    expect(result.errors).toEqual({ dns: "upstream_error: Cloudflare returned an unexpected DNS records response." })
  })

  test("a zone_tag of a zone in another account lands in `errors.dns` and no records are read", async () => {
    const foreign = { id: ACCOUNT_ZONE_ID, name: ZONE_NAME, account: { id: OTHER_ACCOUNT_ID } }
    const added = addFor({ method: "GET", path: ZONE_PATH, reply: ok(foreign) })
    const removed = removeFor({ method: "GET", path: ZONE_PATH, reply: ok(foreign) })

    const afterAdd = await invoke(added.tool, ARGS, CTX)
    const afterRemove = await invoke(removed.tool, ARGS, CTX)

    for (const result of [afterAdd, afterRemove]) {
      expect(result.dns).toBeNull()
      expect(result.errors?.dns).toStartWith("not_found: ")
      expect(result.errors?.dns).toContain("is not in the Cloudflare account default")
    }
    expect(added.requests.some((request) => request.path === RECORDS_PATH)).toBe(false)
    expect(removed.requests.some((request) => request.path === RECORDS_PATH)).toBe(false)
  })

  test("keeps the records, and no error, when the DNS read works", async () => {
    const { tool } = addFor(recordsRoute(ok([PAGES_CNAME])))

    const result = await invoke(tool, ARGS, CTX)

    expect(result.dns?.records).toEqual([SHAPED_PAGES_CNAME])
    expect(result.errors).toBeUndefined()
  })
})

describe("domain add and remove: arguments and the project", () => {
  test.each([
    ["a wildcard", `*.${ZONE_NAME}`, "a wildcard `*` is not allowed here"],
    ["a name without a dot", "shop", "it needs at least one dot, as in mail.example.com"],
    ["an empty name", "  ", "it is empty"],
    ["an invalid label", "-a.example.com", 'label "-a" starts or ends with `-`'],
  ])("both refuse %s before any request", async (_what, name, problem) => {
    for (const { tool, requests } of bothTools()) {
      const error = await toolError(invoke(tool, { ...ARGS, name }, CTX))

      expect(error.code).toBe("invalid_argument")
      expect(error.message).toBe(`\`name\` must be a hostname: ${problem}.`)
      expect(requests).toHaveLength(0)
    }
  })

  test("both refuse an invalid project name, an unknown field and a missing name before any request", async () => {
    for (const { tool, requests } of bothTools()) {
      expect((await toolError(invoke(tool, { ...ARGS, project: "Bad Name" }, CTX))).message).toContain(
        "`project` must be",
      )
      expect((await toolError(invoke(tool, { ...ARGS, force: true }, CTX))).message).toContain(
        "force: unknown argument",
      )
      expect((await toolError(invoke(tool, { project: ARGS.project }, CTX))).code).toBe("invalid_argument")
      expect(requests).toHaveLength(0)
    }
  })

  test("add refuses a project that does not exist, pointing at the list, and sends nothing", async () => {
    const { tool, requests } = addFor({
      method: "GET",
      path: PROJECT_PATH,
      reply: fail(404, [{ code: 8000007, message: "Project not found" }]),
    })

    const error = await toolError(invoke(tool, ARGS, CTX))

    expect(error.code).toBe("not_found")
    expect(error.message).toBe(
      "No Pages project my-project in the account default; cloudflare_pages_read list shows its projects.",
    )
    expect(sent(requests, "POST")).toHaveLength(0)
  })

  test.each([
    ["has no subdomain", { name: "my-project" }],
    ["has an empty subdomain", { name: "my-project", subdomain: "" }],
    ["is not an object", ["my-project"]],
  ])("add refuses a project reply that %s, and sends nothing", async (_what, project) => {
    const { tool, requests } = addFor({ method: "GET", path: PROJECT_PATH, reply: ok(project) })

    const error = await toolError(invoke(tool, ARGS, CTX))

    expect(error.code).toBe("upstream_error")
    expect(sent(requests, "POST")).toHaveLength(0)
  })
})
