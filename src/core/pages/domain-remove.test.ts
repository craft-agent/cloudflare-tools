import { describe, expect, test } from "bun:test"
import { toolError } from "../cloudflare/client.fixtures"
import { fail, ok } from "../cloudflare/testing"
import { writeTargets } from "../targets"
import { annotations, invoke, REQUIRES_USER_INTERACTION, toolMeta, type ConfirmRequest } from "../tool"
import { cloudflarePagesDomainRemove } from "./domain-remove"
import {
  ACTIVE_DOMAIN,
  ARGS,
  CTX,
  DOMAIN_PATH,
  DOMAIN_TARGET,
  EXPECTED_DNS,
  GONE_ERROR,
  NAME,
  NO_SUCH_DOMAIN,
  PAGES_CNAME,
  PROJECT,
  RECORDS_PATH,
  ZONE_PATH,
  domainRoute,
  recordsRoute,
  removeFor,
  sent,
} from "./domain.fixtures"
import { shapeDomain } from "./shape"

describe("cloudflarePagesDomainRemove", () => {
  test("has the administrative annotations, the interaction meta and the pages toolset", () => {
    expect(annotations(cloudflarePagesDomainRemove)).toEqual({
      title: "Remove a custom domain from a Cloudflare Pages project",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    })
    expect(toolMeta(cloudflarePagesDomainRemove)).toEqual({ [REQUIRES_USER_INTERACTION]: true })
    expect(cloudflarePagesDomainRemove.id).toBe("cloudflare_pages_domain_remove")
    expect(cloudflarePagesDomainRemove.toolset).toBe("pages")
  })

  test("reads the domain, sends one DELETE and returns the domain as it was with the records left", async () => {
    const { tool, requests } = removeFor(recordsRoute(ok([PAGES_CNAME])))

    const result = await invoke(tool, ARGS, CTX)

    expect(result).toEqual({
      label: "default",
      project: PROJECT,
      removed: shapeDomain(ACTIVE_DOMAIN),
      dns: EXPECTED_DNS,
    })
    expect(result.removed).toMatchObject({ name: NAME, status: "active" })
    expect(sent(requests, "GET").map((request) => request.path)).toEqual([DOMAIN_PATH, ZONE_PATH, RECORDS_PATH])
    const writes = sent(requests, "DELETE")
    expect(writes).toHaveLength(1)
    expect(writes[0]!.path).toBe(DOMAIN_PATH)
    expect(writes[0]!.body).toBeUndefined()
    expect(sent(requests, "POST")).toHaveLength(0)
    expect(Object.fromEntries(sent(requests, "GET").at(-1)!.query)).toEqual({ "name.exact": NAME, per_page: "100" })
  })

  test("trims, lowercases and drops the trailing dot of the name", async () => {
    const { tool, requests } = removeFor()

    await invoke(tool, { ...ARGS, name: ` ${NAME.toUpperCase()}. ` }, CTX)

    expect(sent(requests, "DELETE")[0]!.path).toBe(DOMAIN_PATH)
  })

  test("leaves `dns` null when the domain reports no zone_tag", async () => {
    const { tool } = removeFor(domainRoute(ok({ ...ACTIVE_DOMAIN, zone_tag: null })))

    const result = await invoke(tool, ARGS, CTX)

    expect(result.dns).toBeNull()
    expect(result.errors).toBeUndefined()
  })
})

describe("cloudflarePagesDomainRemove: the domain must be the project's", () => {
  test("is not_found, pointing at the domains, for a 404", async () => {
    const { tool, requests } = removeFor(domainRoute(fail(404, [{ code: 8000007, message: "Not found" }])))

    const error = await toolError(invoke(tool, ARGS, CTX))

    expect(error.code).toBe("not_found")
    expect(error.message).toBe(NO_SUCH_DOMAIN)
    expect(sent(requests, "DELETE")).toHaveLength(0)
  })

  test("is the same not_found for Cloudflare's HTTP 400 8000021", async () => {
    const { tool, requests } = removeFor(domainRoute(fail(400, [GONE_ERROR])))

    const error = await toolError(invoke(tool, ARGS, CTX))

    expect(error.code).toBe("not_found")
    expect(error.message).toBe(NO_SUCH_DOMAIN)
    expect((error.cause as Error).message).toContain("8000021")
    expect(sent(requests, "DELETE")).toHaveLength(0)
  })

  test("keeps any other 400 as it is", async () => {
    const { tool } = removeFor(domainRoute(fail(400, [{ code: 8000000, message: "Bad request" }])))

    const error = await toolError(invoke(tool, ARGS, CTX))

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toBe("8000000: Bad request")
  })

  test.each([ok(null), ok([]), ok("x")])("refuses a reply that is not an object", async (reply) => {
    const { tool, requests } = removeFor(domainRoute(reply))

    const error = await toolError(invoke(tool, ARGS, CTX))

    expect(error.code).toBe("upstream_error")
    expect(sent(requests, "DELETE")).toHaveLength(0)
  })
})

describe("cloudflarePagesDomainRemove: confirmation", () => {
  test("asks with one plain line naming the hostname, the project and the account", async () => {
    const asked: ConfirmRequest[] = []
    const { tool } = removeFor()

    await invoke(tool, ARGS, {
      ...CTX,
      confirm: async (request) => {
        asked.push(request)
        return true
      },
    })

    expect(asked).toEqual([
      {
        tool: "cloudflare_pages_domain_remove",
        message: `Remove ${NAME} from Pages project ${PROJECT} in the Cloudflare account default. Visitors to ${NAME} stop getting the site at once; its DNS records stay as they are.`,
      },
    ])
  })

  test("sends nothing when the person declines", async () => {
    const { tool, requests } = removeFor()

    const error = await toolError(invoke(tool, ARGS, { ...CTX, confirm: async () => false }))

    expect(error.code).toBe("declined")
    expect(sent(requests, "DELETE")).toHaveLength(0)
  })
})

describe("cloudflarePagesDomainRemove: targets", () => {
  test("name the account, the project and the normalized hostname without any request", async () => {
    const { tool, requests } = removeFor()

    expect(await writeTargets(tool, { ...ARGS, name: `${NAME.toUpperCase()}.` }, CTX)).toEqual([DOMAIN_TARGET])
    expect(requests).toHaveLength(0)
  })

  test("are `*` for an invalid project name or hostname", async () => {
    const { tool } = removeFor()

    expect(await tool.targets!({ ...ARGS, project: "Bad Name" }, CTX)).toEqual(["*"])
    expect(await tool.targets!({ ...ARGS, name: "*.example.com" }, CTX)).toEqual(["*"])
  })
})
