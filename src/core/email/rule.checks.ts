import type { CloudflareClient, Reply } from "../cloudflare/client"
import { sentence } from "../cloudflare/graphql"
import { isPlainObject } from "../cloudflare/reply"
import { ROUTES, type Route } from "../cloudflare/routes"
import { isAbortError, isToolError, ToolError } from "../errors"
import { shapeAddress, shapeRows, shapeRule, type Rule } from "./shape"

/** Rows per page of a listing; the most Cloudflare serves. */
const PER_PAGE_COUNT = 50

/** The most pages of a listing the checks read. */
const MAX_PAGES = 5

/** What a forbidden read of the zone's rules gains. */
export const RULES_READ_HINT = "The token needs Zone → Email Routing Rules → Read."

/** What a forbidden read of the account's destination addresses gains when it checks a forward. */
export const ADDRESSES_READ_HINT = "The token needs Account → Email Routing Addresses → Read to check the forward."

/** What a forbidden write of a zone's rules gains. */
export const RULES_EDIT_HINT = "The token needs Zone → Email Routing Rules → Edit."

/** How a destination address stands: confirmed by its owner, added but not confirmed, or not an address of the account. */
export type DestinationState = "verified" | "unverified" | "missing"

/** A forbidden failure gains the permission the call needs; any other failure is returned as it is. */
export function withHint(error: ToolError, hint: string): ToolError {
  if (error.code !== "forbidden") return error
  return new ToolError("forbidden", `${sentence(error.message)} ${hint}`, { cause: error })
}

type Listing<T> = {
  route: Route
  path?: Record<string, string>
  hint: string
  /** What the listing holds, for the messages: "routing rules". */
  what: string
  /** Names the owner of the listing in the message of a listing that is too long: "The zone", "The account". */
  owner: string
  shape(row: unknown): T | undefined
}

async function readPage<T>(client: CloudflareClient, listing: Listing<T>, page: number): Promise<Reply<unknown>> {
  try {
    return await client.request<unknown>(listing.route, {
      ...(listing.path ? { path: listing.path } : {}),
      query: { page, per_page: PER_PAGE_COUNT },
    })
  } catch (error) {
    throw isToolError(error) ? withHint(error, listing.hint) : error
  }
}

/** The first row of a listing that `matches`, reading at most {@link MAX_PAGES} pages; `undefined` when the listing ends without one. */
async function findInListing<T>(
  client: CloudflareClient,
  listing: Listing<T>,
  matches: (row: T) => boolean,
): Promise<T | undefined> {
  for (let page = 1; ; page += 1) {
    const reply = await readPage(client, listing, page)
    if (!Array.isArray(reply.result)) {
      throw new ToolError("upstream_error", `Cloudflare returned an unexpected ${listing.what} response.`)
    }
    const found = shapeRows(reply.result, listing.shape).find(matches)
    if (found !== undefined) return found

    const totalPages = reply.resultInfo?.total_pages
    if (typeof totalPages !== "number" || page >= totalPages) return undefined
    if (page >= MAX_PAGES) {
      throw new ToolError("upstream_error", `${listing.owner} has more ${listing.what} than this tool reads.`)
    }
  }
}

/** The rule of the zone that matches the address `to` (lowercase), a rule with a shape these tools do not change included. */
export function findRuleFor(client: CloudflareClient, zoneId: string, to: string): Promise<Rule | undefined> {
  return findInListing(
    client,
    {
      route: ROUTES.emailRoutingRules,
      path: { zone_id: zoneId },
      hint: RULES_READ_HINT,
      what: "routing rules",
      owner: "The zone",
      shape: shapeRule,
    },
    (rule) => rule.to === to,
  )
}

/** How the account's destination address `email` stands; addresses compare without regard to case. */
export async function destinationState(client: CloudflareClient, email: string): Promise<DestinationState> {
  const wanted = email.toLowerCase()
  const found = await findInListing(
    client,
    {
      route: ROUTES.emailRoutingAddresses,
      hint: ADDRESSES_READ_HINT,
      what: "destination addresses",
      owner: "The account",
      shape: shapeAddress,
    },
    (address) => address.email.toLowerCase() === wanted,
  )
  if (found === undefined) return "missing"
  return found.verified ? "verified" : "unverified"
}

/** Whether Email Routing is on for the zone; `null` when that cannot be told, since it never stops a call. A cancellation is passed on. */
export async function readRoutingEnabled(client: CloudflareClient, zoneId: string): Promise<boolean | null> {
  try {
    const { result } = await client.request<unknown>(ROUTES.emailRouting, { path: { zone_id: zoneId } })
    return isPlainObject(result) ? result.enabled === true : null
  } catch (error) {
    if (isAbortError(error)) throw error
    return null
  }
}
