import { describe, expect, test } from "bun:test"
import { fail, ok } from "../cloudflare/testing"
import { callDescription } from "../describe"
import { describing, refusing } from "../describe.fixtures"
import {
  ACTIVE_DOMAIN,
  ARGS,
  CTX,
  GONE_ERROR,
  NAME,
  NO_SUCH_DOMAIN,
  PROJECT_ROUTE,
  SUBDOMAIN,
  addFor,
  domainRoute,
  removeFor,
  sent,
} from "./domain.fixtures"
import { PROJECT_ENTRY } from "./fixtures"

const ADD_HEADLINE = {
  text: "About to add {name} to the Pages project {project}",
  values: { name: NAME, project: "my-project" },
}
const REMOVE_HEADLINE = {
  text: "About to remove {name} from the Pages project {project}",
  values: { name: NAME, project: "my-project" },
}
const REMOVE_EFFECT = {
  label: "Effect",
  value: { text: "visitors stop getting the site at once; its DNS records stay" },
}

describe("cloudflarePagesDomainAdd: describe", () => {
  test("states its intent", () => {
    expect(addFor().tool.intent).toBe("About to add a custom domain")
  })

  test("names the hostname, the project and the CNAME record the domain waits for, and writes nothing", async () => {
    const { tool, requests } = addFor()

    const { description, asked } = await describing(tool, ARGS)

    expect(description).toEqual({
      headline: ADD_HEADLINE,
      facts: [{ label: "DNS record needed", value: `${NAME} CNAME ${SUBDOMAIN}  proxied` }],
    })
    expect(asked).toEqual([])
    expect(sent(requests, "POST")).toHaveLength(0)
  })

  test("normalizes the hostname and the project as execute does", async () => {
    const { tool } = addFor()

    const { description } = await describing(tool, { project: "my-project", name: NAME.toUpperCase() })

    expect(description.headline!.values).toEqual({ name: NAME, project: "my-project" })
  })

  test("gives the same description twice for the same state", async () => {
    const { tool } = addFor()

    const first = await describing(tool, ARGS)
    const second = await describing(tool, ARGS)

    expect(second.description).toEqual(first.description)
  })

  test("is accepted by the description check", async () => {
    const { tool } = addFor()

    const answer = await callDescription(tool, ARGS, CTX)

    expect(answer?.headline).toEqual(ADD_HEADLINE)
    expect(answer?.facts).toHaveLength(1)
    expect(answer?.pins).toBeUndefined()
  })

  test("throws for a project without a pages.dev address, as execute does, and writes nothing", async () => {
    const { tool, requests } = addFor({ ...PROJECT_ROUTE, reply: ok({ ...PROJECT_ENTRY, subdomain: "" }) })

    const { error, asked } = await refusing(tool, ARGS)

    expect(error.code).toBe("upstream_error")
    expect(asked).toEqual([])
    expect(sent(requests, "POST")).toHaveLength(0)
  })
})

describe("cloudflarePagesDomainRemove: describe", () => {
  test("states its intent", () => {
    expect(removeFor().tool.intent).toBe("About to remove a custom domain")
  })

  test("names the hostname, its status and the effect, and writes nothing", async () => {
    const { tool, requests } = removeFor()

    const { description, asked } = await describing(tool, ARGS)

    expect(description).toEqual({
      headline: REMOVE_HEADLINE,
      facts: [{ label: "Status", value: "active" }, REMOVE_EFFECT],
    })
    expect(asked).toEqual([])
    expect(sent(requests, "DELETE")).toHaveLength(0)
  })

  test("leaves the status out when Cloudflare reports none", async () => {
    const { tool } = removeFor(domainRoute(ok({ ...ACTIVE_DOMAIN, status: null })))

    const { description } = await describing(tool, ARGS)

    expect(description.facts).toEqual([REMOVE_EFFECT])
  })

  test("gives the same description twice for the same state", async () => {
    const { tool } = removeFor()

    const first = await describing(tool, ARGS)
    const second = await describing(tool, ARGS)

    expect(second.description).toEqual(first.description)
  })

  test("is accepted by the description check", async () => {
    const { tool } = removeFor()

    const answer = await callDescription(tool, ARGS, CTX)

    expect(answer?.headline).toEqual(REMOVE_HEADLINE)
    expect(answer?.facts).toHaveLength(2)
    expect(answer?.pins).toBeUndefined()
  })

  test("throws for a domain the project does not hold, as execute does, and writes and asks nothing", async () => {
    const { tool, requests } = removeFor(domainRoute(fail(400, [GONE_ERROR])))

    const { error, asked } = await refusing(tool, ARGS)

    expect(error.code).toBe("not_found")
    expect(error.message).toBe(NO_SUCH_DOMAIN)
    expect(asked).toEqual([])
    expect(sent(requests, "DELETE")).toHaveLength(0)
  })
})
