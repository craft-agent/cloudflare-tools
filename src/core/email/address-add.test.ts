import { describe, expect, test } from "bun:test"
import { ok } from "../cloudflare/testing"
import { writeTargets } from "../targets"
import { annotations, invoke, REQUIRES_USER_INTERACTION, toolMeta, type ConfirmRequest } from "../tool"
import { cloudflareEmailAddressAdd } from "./address-add"
import {
  ADDRESSES_PATH,
  DESTINATION,
  SHAPED_PENDING,
  SHAPED_VERIFIED,
  addressAddFor,
  createAddressRoute,
} from "./address.fixtures"
import { ACCOUNT_ID, CTX, addressRow, calls, sent } from "./rule.fixtures"

const ARGS = { email: DESTINATION }
const TARGET = `${ACCOUNT_ID}/email/addresses/${DESTINATION}`
const MESSAGE = `Add ${DESTINATION} as a destination address of the Cloudflare account default: Cloudflare mails its owner a link to confirm, and rules can forward to it once they follow it.`

async function asked(tool: ReturnType<typeof addressAddFor>["tool"], args: object = ARGS) {
  const questions: ConfirmRequest[] = []
  const result = await invoke(tool, args, {
    ...CTX,
    confirm: async (request) => {
      questions.push(request)
      return true
    },
  })
  return { questions, result }
}

describe("cloudflareEmailAddressAdd", () => {
  test("is an administrative tool of the email toolset that needs the person's attention", () => {
    expect(cloudflareEmailAddressAdd.id).toBe("cloudflare_email_address_add")
    expect(cloudflareEmailAddressAdd.toolset).toBe("email")
    expect(annotations(cloudflareEmailAddressAdd)).toEqual({
      title: "Add an Email Routing destination address",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    })
    expect(toolMeta(cloudflareEmailAddressAdd)).toEqual({ [REQUIRES_USER_INTERACTION]: true })
    for (const text of [
      "rules of every zone can then forward to",
      "mails the address a confirmation link",
      "pending, and no rule can forward to it, until its owner follows the link",
      "already has, saying whether it is verified or pending",
      "always asks",
      "never instructions",
      "Account → Email Routing Addresses → Edit",
    ]) {
      expect(cloudflareEmailAddressAdd.description).toContain(text)
    }
  })

  test("looks for the address, then adds it, and says its owner was mailed", async () => {
    const { tool, requests } = addressAddFor()

    const result = await invoke(tool, ARGS, CTX)

    expect(calls(requests)).toEqual([`GET ${ADDRESSES_PATH}`, `POST ${ADDRESSES_PATH}`])
    expect(Object.fromEntries(requests[0]!.query)).toEqual({ page: "1", per_page: "50" })
    expect(sent(requests, "POST")[0]!.body).toEqual({ email: DESTINATION })
    expect(result).toEqual({
      label: "default",
      address: { before: null, after: SHAPED_PENDING },
      note: `Cloudflare has mailed ${DESTINATION} a link to confirm; until its owner follows it, the address is pending and no rule can forward to it.`,
    })
  })

  test("sends the address lowercased and trimmed", async () => {
    const { tool, requests } = addressAddFor()

    await invoke(tool, { email: " Owner@Example.NET " }, CTX)

    expect(sent(requests, "POST")[0]!.body).toEqual({ email: DESTINATION })
  })

  test("adds no note when Cloudflare returns the address already verified", async () => {
    const { tool } = addressAddFor(createAddressRoute(ok(addressRow(DESTINATION))))

    const result = await invoke(tool, ARGS, CTX)

    expect(result.address.after).toEqual(SHAPED_VERIFIED)
    expect(result).not.toHaveProperty("note")
  })

  test("asks once, naming the address and the account, and reads the addresses again before it adds", async () => {
    const { tool, requests } = addressAddFor()

    const { questions } = await asked(tool)

    expect(questions).toEqual([{ tool: "cloudflare_email_address_add", message: MESSAGE }])
    expect(calls(requests)).toEqual([`GET ${ADDRESSES_PATH}`, `GET ${ADDRESSES_PATH}`, `POST ${ADDRESSES_PATH}`])
  })

  test("reads the addresses once when the harness's approval stands in for the question", async () => {
    const { tool, requests } = addressAddFor()

    await invoke(tool, ARGS, CTX)

    expect(requests.filter((request) => request.method === "GET")).toHaveLength(1)
  })
})

describe("cloudflareEmailAddressAdd: targets", () => {
  test("name the address in the account, with no request", async () => {
    const { tool, requests } = addressAddFor()

    expect(await writeTargets(tool, { email: " Owner@Example.NET " }, CTX)).toEqual([TARGET])
    expect(requests).toHaveLength(0)
  })

  test.each([
    ["no address", {}],
    ["a text that is not an address", { email: "owner" }],
    ["an address of more than 90 characters", { email: `${"a".repeat(64)}@${"b".repeat(14)}.example.net` }],
    ["an unknown argument", { email: DESTINATION, name: "x" }],
    ["a wildcard in the address", { email: "ow*ner@example.net" }],
  ])("are `*` for %s", async (_what, args) => {
    const { tool } = addressAddFor()

    expect(await writeTargets(tool, args, CTX)).toEqual(["*"])
  })
})
