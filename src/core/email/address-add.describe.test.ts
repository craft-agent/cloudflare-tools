import { describe, expect, test } from "bun:test"
import { callDescription } from "../describe"
import { ADDRESSES_PATH, DESTINATION, addressAddFor } from "./address.fixtures"
import { describing, readsOf, refusing, writes } from "./describe.fixtures"
import { CTX, addressRow, addressesRoute, paged } from "./rule.fixtures"

const ARGS = { email: DESTINATION }
const HEADLINE = { text: "About to add the destination address {email}", values: { email: DESTINATION } }

describe("cloudflareEmailAddressAdd: describe", () => {
  test("states its intent", () => {
    expect(addressAddFor().tool.intent).toBe("About to add a destination address")
  })

  test("names the address and says what its owner has to do, with no pins", async () => {
    const { tool, requests } = addressAddFor()

    const { description, asked } = await describing(tool, ARGS)

    expect(description).toEqual({
      headline: HEADLINE,
      facts: [{ label: "Next step", value: { text: "its owner follows the link Cloudflare mails to it" } }],
    })
    expect(asked).toEqual([])
    expect(writes(requests)).toEqual([])
  })

  test("names the address as the call will send it: trimmed and lowercased", async () => {
    const { tool } = addressAddFor()

    const { description } = await describing(tool, { email: `  ${DESTINATION.toUpperCase()} ` })

    expect(description.headline!.values).toEqual({ email: DESTINATION })
  })

  test("looks the addresses up once, and does not read them again as an answer would make it", async () => {
    const { tool, requests } = addressAddFor()

    await describing(tool, ARGS)

    expect(readsOf(requests, ADDRESSES_PATH)).toBe(1)
  })

  test("gives the same description twice for the same state", async () => {
    const { tool } = addressAddFor()

    const first = await describing(tool, ARGS)
    const second = await describing(tool, ARGS)

    expect(second.description).toEqual(first.description)
  })

  test("is accepted by the description check", async () => {
    const { tool } = addressAddFor()

    const answer = await callDescription(tool, ARGS, CTX)

    expect(answer?.headline).toEqual(HEADLINE)
    expect(answer?.pins).toBeUndefined()
  })
})

describe("cloudflareEmailAddressAdd: describe refuses where execute would", () => {
  const PENDING = "still waiting for its owner to confirm Cloudflare's mail"

  test.each([
    ["a verified address", addressRow(DESTINATION), "verified"],
    ["a pending address", addressRow(DESTINATION, null), PENDING],
    ["an address of another case", addressRow(DESTINATION.toUpperCase()), "verified"],
  ])("throws for %s the account already has, and writes and asks nothing", async (_what, row, state) => {
    const { tool, requests } = addressAddFor(addressesRoute(paged([[row]])))

    const { error, asked } = await refusing(tool, ARGS)

    expect(error.code).toBe("invalid_argument")
    expect(error.message).toBe(
      `${DESTINATION} is already a destination address of this account, ${state}. Nothing was changed.`,
    )
    expect(asked).toEqual([])
    expect(writes(requests)).toEqual([])
  })

  test("gives nothing to the description check for a call execute would refuse", async () => {
    const { tool } = addressAddFor(addressesRoute(paged([[addressRow(DESTINATION)]])))

    expect(await callDescription(tool, ARGS, CTX)).toBeUndefined()
  })
})
