import { describe, expect, test } from "bun:test"
import { ok } from "../cloudflare/testing"
import { writeTargets } from "../targets"
import { annotations, invoke, REQUIRES_USER_INTERACTION, toolMeta, type ConfirmRequest } from "../tool"
import { cloudflareEmailAddressDelete } from "./address-delete"
import {
  ADDRESS_ID,
  ADDRESS_PATH,
  ADDRESSES_PATH,
  CATCH_ALL_PATH,
  DESTINATION,
  SHAPED_PENDING,
  SHAPED_VERIFIED,
  ZONE_A,
  ZONE_B,
  addressDeleteFor,
  rulesPathOf,
  zonesRoute,
} from "./address.fixtures"
import { ACCOUNT_ID, CTX, addressRow, addressesRoute, calls, paged, sent } from "./rule.fixtures"

const ARGS = { email: DESTINATION }
const TARGET = `${ACCOUNT_ID}/email/addresses/${DESTINATION}`
const RULES_B = rulesPathOf(ZONE_B)
const CATCH_ALL_B = `${RULES_B}/catch_all`

async function asked(tool: ReturnType<typeof addressDeleteFor>["tool"], args: object = ARGS) {
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

describe("cloudflareEmailAddressDelete", () => {
  test("is an administrative tool of the email toolset that needs the person's attention", () => {
    expect(cloudflareEmailAddressDelete.id).toBe("cloudflare_email_address_delete")
    expect(cloudflareEmailAddressDelete.toolset).toBe("email")
    expect(annotations(cloudflareEmailAddressDelete)).toEqual({
      title: "Delete an Email Routing destination address",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    })
    expect(toolMeta(cloudflareEmailAddressDelete)).toEqual({ [REQUIRES_USER_INTERACTION]: true })
    for (const text of [
      "found by its email",
      "refuses while any rule or catch-all in a zone of the account forwards to it",
      "Cloudflare would turn those off",
      "Zone → Email Routing Rules → Read in every zone",
      "always asks",
      "never instructions",
      "Account → Email Routing Addresses → Edit",
    ]) {
      expect(cloudflareEmailAddressDelete.description).toContain(text)
    }
  })

  test("reads the address, then every zone's rules and catch-all, and deletes the address by its id", async () => {
    const { tool, requests } = addressDeleteFor()

    const result = await invoke(tool, ARGS, CTX)

    expect(calls(requests)).toEqual([
      `GET ${ADDRESSES_PATH}`,
      "GET /zones",
      `GET ${rulesPathOf(ZONE_A)}`,
      `GET ${CATCH_ALL_PATH}`,
      `GET ${RULES_B}`,
      `GET ${CATCH_ALL_B}`,
      `DELETE ${ADDRESS_PATH}`,
    ])
    expect(requests[1]!.query.get("account.id")).toBe(ACCOUNT_ID)
    expect(requests[2]!.query.get("per_page")).toBe("50")
    expect(ADDRESS_PATH).toEndWith(`/${ADDRESS_ID}`)
    expect(result).toEqual({
      label: "default",
      address: { before: SHAPED_VERIFIED, after: null },
      zones_checked: 2,
    })
  })

  test("deletes an account without zones, which no rule can forward from", async () => {
    const { tool, requests } = addressDeleteFor(zonesRoute(ok([])))

    const result = await invoke(tool, ARGS, CTX)

    expect(result.zones_checked).toBe(0)
    expect(sent(requests, "DELETE")).toHaveLength(1)
  })

  test("finds the address without regard to case, and keeps the id Cloudflare gave it", async () => {
    const { tool, requests } = addressDeleteFor(
      { method: "DELETE", path: `${ADDRESSES_PATH}/f6f6`, reply: ok({}) },
      addressesRoute(
        paged([[addressRow("someone@example.net")], [{ ...addressRow("OWNER@Example.NET"), id: "f6f6" }]]),
      ),
    )

    await invoke(tool, ARGS, CTX)

    expect(sent(requests, "DELETE")[0]!.path).toBe(`${ADDRESSES_PATH}/f6f6`)
  })
})

describe("cloudflareEmailAddressDelete: the confirmation", () => {
  test.each([
    ["verified", addressRow(DESTINATION), SHAPED_VERIFIED],
    ["pending", addressRow(DESTINATION, null), SHAPED_PENDING],
  ])("names the address, whether it is %s, the account and the zones checked", async (state, row, shaped) => {
    const { tool, requests } = addressDeleteFor(addressesRoute(paged([[row]])))

    const { questions, result } = await asked(tool)

    expect(questions).toEqual([
      {
        tool: "cloudflare_email_address_delete",
        message: `Delete the destination address ${DESTINATION} (${state}) of the Cloudflare account default; no rule or catch-all in its 2 zones forwards to it.`,
      },
    ])
    expect(result.address.before).toEqual(shaped)
    expect(sent(requests, "DELETE")).toHaveLength(1)
  })

  test("says one zone in the singular", async () => {
    const { tool } = addressDeleteFor(zonesRoute(ok([ZONE_A])))

    const { questions } = await asked(tool)

    expect(questions[0]!.message).toEndWith("no rule or catch-all in its 1 zone forwards to it.")
  })

  test("reads the address and the zones again after the answer, before it deletes", async () => {
    const { tool, requests } = addressDeleteFor()

    await asked(tool)

    expect(calls(requests)).toEqual([
      `GET ${ADDRESSES_PATH}`,
      "GET /zones",
      `GET ${rulesPathOf(ZONE_A)}`,
      `GET ${CATCH_ALL_PATH}`,
      `GET ${RULES_B}`,
      `GET ${CATCH_ALL_B}`,
      `GET ${ADDRESSES_PATH}`,
      "GET /zones",
      `GET ${rulesPathOf(ZONE_A)}`,
      `GET ${CATCH_ALL_PATH}`,
      `GET ${RULES_B}`,
      `GET ${CATCH_ALL_B}`,
      `DELETE ${ADDRESS_PATH}`,
    ])
  })

  test("reads each thing once when the harness's approval stands in for the question", async () => {
    const { tool, requests } = addressDeleteFor()

    await invoke(tool, ARGS, CTX)

    expect(requests.filter((request) => request.path === ADDRESSES_PATH)).toHaveLength(1)
  })
})

describe("cloudflareEmailAddressDelete: targets", () => {
  test("name the address in the account, with no request", async () => {
    const { tool, requests } = addressDeleteFor()

    expect(await writeTargets(tool, { email: " Owner@Example.NET " }, CTX)).toEqual([TARGET])
    expect(requests).toHaveLength(0)
  })

  test.each([
    ["no address", {}],
    ["a text that is not an address", { email: "owner" }],
    ["an id in place of an address", { email: DESTINATION, id: ADDRESS_ID }],
    ["a wildcard in the address", { email: "ow?ner@example.net" }],
  ])("are `*` for %s", async (_what, args) => {
    const { tool } = addressDeleteFor()

    expect(await writeTargets(tool, args, CTX)).toEqual(["*"])
  })
})
