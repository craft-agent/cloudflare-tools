import type { z } from "zod"
import { cloudflareClient, type CloudflareClient, type CloudflareDeps } from "../cloudflare/client"
import { ROUTES } from "../cloudflare/routes"
import { isAbortError } from "../errors"
import { ANY_TARGET } from "../targets"
import type { ToolContext } from "../tool"
import { MATCHER_MAX_LENGTH, plainAddress } from "./rule"
import { findInListing } from "./rule.checks"
import { shapeAddress, type addressSchema } from "./shape"

/** A destination address of the account, as the tools shape it. */
export type Address = z.output<typeof addressSchema>

/** What a forbidden read of the account's destination addresses gains. */
export const ADDRESS_READ_HINT = "The token needs Account → Email Routing Addresses → Read."

/** What a forbidden write of the account's destination addresses gains. */
export const ADDRESS_EDIT_HINT = "The token needs Account → Email Routing Addresses → Edit."

/** A destination address: a plain address, trimmed and lowercased; whether it exists is not checked. */
export const emailArg = plainAddress.describe(
  `The destination address, a plain email address such as owner@example.net; lowercased, at most ${MATCHER_MAX_LENGTH} characters.`,
)

/** How an address stands for a person: confirmed by its owner, or still waiting for them. */
export function standing(address: Pick<Address, "verified">): "verified" | "pending" {
  return address.verified ? "verified" : "pending"
}

/** The destination address of the account `email` names, without regard to case, or `undefined` when the account has none. */
export function findAddress(client: CloudflareClient, email: string): Promise<Address | undefined> {
  const wanted = email.toLowerCase()
  return findInListing(
    client,
    {
      route: ROUTES.emailRoutingAddresses,
      hint: ADDRESS_READ_HINT,
      what: "destination addresses",
      owner: "The account",
      shape: shapeAddress,
    },
    (address) => address.email.toLowerCase() === wanted,
  )
}

/** What a write to the destination address `email` names, as the permission rules of an entry point do. */
function addressTarget(accountId: string, email: string): string {
  return `${accountId}/email/addresses/${email}`
}

/** What a call about the destination address `args.email` (already normalised) writes to, with no reads; `*` when the account cannot be told. */
export function addressTargets(
  args: { account?: string; email: string },
  ctx: ToolContext,
  deps?: CloudflareDeps,
): string[] {
  try {
    const client = cloudflareClient(args.account, { ...deps, signal: ctx.signal })
    return [addressTarget(client.accountId, args.email)]
  } catch (error) {
    if (isAbortError(error)) throw error
    return [ANY_TARGET]
  }
}
