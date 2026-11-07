import { describe, expect, test } from "bun:test"
import { toolError } from "../cloudflare/client.fixtures"
import { ok } from "../cloudflare/testing"
import { writeTargets } from "../targets"
import { annotations, invoke, REQUIRES_USER_INTERACTION, toolMeta, type ConfirmRequest } from "../tool"
import { cloudflarePagesDomainAdd } from "./domain-add"
import {
  ACCOUNT_ZONE_ID,
  ARGS,
  CTX,
  DOMAINS_PATH,
  DOMAIN_TARGET,
  EMPTY_DNS,
  EXPECTED_CNAME,
  EXPECTED_DNS,
  NAME,
  NEW_DOMAIN,
  PAGES_CNAME,
  PROJECT,
  PROJECT_PATH,
  RECORDS_PATH,
  SUBDOMAIN,
  ZONE_NAME,
  ZONE_PATH,
  addFor,
  addRoute,
  recordsRoute,
  sent,
} from "./domain.fixtures"
import { shapeDomain } from "./shape"

describe("cloudflarePagesDomainAdd", () => {
  test("has the administrative annotations, the interaction meta and the pages toolset", () => {
    expect(annotations(cloudflarePagesDomainAdd)).toEqual({
      title: "Add a custom domain to a Cloudflare Pages project",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    })
    expect(toolMeta(cloudflarePagesDomainAdd)).toEqual({ [REQUIRES_USER_INTERACTION]: true })
    expect(cloudflarePagesDomainAdd.id).toBe("cloudflare_pages_domain_add")
    expect(cloudflarePagesDomainAdd.toolset).toBe("pages")
  })

  test("reads the project, sends one POST with the name and returns the domain, the CNAME it waits for and the DNS", async () => {
    const { tool, requests } = addFor(recordsRoute(ok([PAGES_CNAME])))

    const result = await invoke(tool, ARGS, CTX)

    expect(result).toEqual({
      label: "default",
      project: PROJECT,
      domain: shapeDomain(NEW_DOMAIN),
      cname: EXPECTED_CNAME,
      dns: EXPECTED_DNS,
    })
    expect(result.domain).toMatchObject({ name: NAME, status: "initializing", zone_id: ACCOUNT_ZONE_ID })
    expect(sent(requests, "GET").map((request) => request.path)).toEqual([PROJECT_PATH, ZONE_PATH, RECORDS_PATH])
    const writes = sent(requests, "POST")
    expect(writes).toHaveLength(1)
    expect(writes[0]!.path).toBe(DOMAINS_PATH)
    expect(writes[0]!.body).toEqual({ name: NAME })
  })

  test("lists only the records named exactly like the hostname", async () => {
    const { tool, requests } = addFor()

    const result = await invoke(tool, ARGS, CTX)

    expect(result.dns).toEqual(EMPTY_DNS)
    const read = sent(requests, "GET").find((request) => request.path === RECORDS_PATH)!
    expect(Object.fromEntries(read.query)).toEqual({ "name.exact": NAME, per_page: "100" })
  })

  test("sends the normalized name: trimmed, lowercased, without the trailing dot, an IDN as punycode", async () => {
    const { tool, requests } = addFor()

    const result = await invoke(tool, { ...ARGS, name: ` Shop.BÜCHER.${ZONE_NAME}. ` }, CTX)

    expect(sent(requests, "POST")[0]!.body).toEqual({ name: `shop.xn--bcher-kva.${ZONE_NAME}` })
    expect(result.cname.name).toBe(`shop.xn--bcher-kva.${ZONE_NAME}`)
    expect(sent(requests, "GET").at(-1)!.query.get("name.exact")).toBe(`shop.xn--bcher-kva.${ZONE_NAME}`)
  })

  test("leaves `dns` null, and reads no zone, when the domain reports no zone_tag", async () => {
    const { tool, requests } = addFor(addRoute(ok({ ...NEW_DOMAIN, zone_tag: undefined })))

    const result = await invoke(tool, ARGS, CTX)

    expect(result.dns).toBeNull()
    expect(result.errors).toBeUndefined()
    expect(sent(requests, "GET").map((request) => request.path)).toEqual([PROJECT_PATH])
  })

  test("returns the name with nothing else known when the reply is not an object", async () => {
    const { tool } = addFor(addRoute(ok(null)))

    const result = await invoke(tool, ARGS, CTX)

    expect(result.domain).toEqual({
      name: NAME,
      status: null,
      validation: null,
      verification: null,
      certificate_authority: null,
      zone_id: null,
      created_on: null,
    })
    expect(result.dns).toBeNull()
    expect(result.cname).toEqual(EXPECTED_CNAME)
  })
})

describe("cloudflarePagesDomainAdd: confirmation", () => {
  test("asks with one plain line naming the hostname, the project, the account and the CNAME", async () => {
    const asked: ConfirmRequest[] = []
    const { tool } = addFor()

    await invoke(tool, ARGS, {
      ...CTX,
      confirm: async (request) => {
        asked.push(request)
        return true
      },
    })

    expect(asked).toEqual([
      {
        tool: "cloudflare_pages_domain_add",
        message: `Add ${NAME} to Pages project ${PROJECT} in the Cloudflare account default. Once a CNAME record ${NAME} → ${SUBDOMAIN} exists, visitors to ${NAME} get the project's site.`,
      },
    ])
  })

  test("sends nothing when the person declines", async () => {
    const { tool, requests } = addFor()

    const error = await toolError(invoke(tool, ARGS, { ...CTX, confirm: async () => false }))

    expect(error.code).toBe("declined")
    expect(sent(requests, "POST")).toHaveLength(0)
  })

  test("goes on without a confirm hook, the harness having approved", async () => {
    const { tool, requests } = addFor()

    await invoke(tool, ARGS, CTX)

    expect(sent(requests, "POST")).toHaveLength(1)
  })
})

describe("cloudflarePagesDomainAdd: targets", () => {
  test("name the account, the project and the normalized hostname without any request", async () => {
    const { tool, requests } = addFor()

    expect(await writeTargets(tool, { ...ARGS, name: `${NAME.toUpperCase()}.` }, CTX)).toEqual([DOMAIN_TARGET])
    expect(requests).toHaveLength(0)
  })

  test.each([
    ["an invalid project name", { ...ARGS, project: "Bad Name" }],
    ["a wildcard", { ...ARGS, name: `*.${ZONE_NAME}` }],
    ["an invalid hostname", { ...ARGS, name: "nodot" }],
  ])("are `*` for %s", async (_what, args) => {
    const { tool } = addFor()

    expect(await tool.targets!(args, CTX)).toEqual(["*"])
  })
})
