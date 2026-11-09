import type { CloudflareClient, Reply } from "../cloudflare/client"
import { sentence } from "../cloudflare/graphql"
import { isPlainObject } from "../cloudflare/reply"
import { ROUTES, type Route } from "../cloudflare/routes"
import { isAbortError, isToolError, ToolError } from "../errors"
import { NOTHING_CHANGED } from "./rule"
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

/** A paged Cloudflare listing the checks read: its route, what it holds and how a row is shaped. */
export type Listing<T> = {
  route: Route
  path?: Record<string, string>
  /** Query parameters sent with every page, besides the paging ones. */
  query?: Record<string, string>
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
      query: { ...listing.query, page, per_page: PER_PAGE_COUNT },
    })
  } catch (error) {
    throw isToolError(error) ? withHint(error, listing.hint) : error
  }
}

/**
 * Hands the shaped rows of each page of a listing to `visit`, at most {@link MAX_PAGES} pages, until `visit` returns
 * true or the listing ends. A listing longer than that is `upstream_error`, since what is left would go unread.
 */
export async function scanListing<T>(
  client: CloudflareClient,
  listing: Listing<T>,
  visit: (rows: T[]) => boolean,
): Promise<void> {
  for (let page = 1; ; page += 1) {
    const reply = await readPage(client, listing, page)
    if (!Array.isArray(reply.result)) {
      throw new ToolError("upstream_error", `Cloudflare returned an unexpected ${listing.what} response.`)
    }
    if (visit(shapeRows(reply.result, listing.shape))) return

    const totalPages = reply.resultInfo?.total_pages
    if (typeof totalPages !== "number" || page >= totalPages) return
    if (page >= MAX_PAGES) {
      throw new ToolError("upstream_error", `${listing.owner} has more ${listing.what} than this tool reads.`)
    }
  }
}

/** The first row of a listing that `matches`, reading at most {@link MAX_PAGES} pages; `undefined` when the listing ends without one. */
export async function findInListing<T>(
  client: CloudflareClient,
  listing: Listing<T>,
  matches: (row: T) => boolean,
): Promise<T | undefined> {
  let found: T | undefined
  await scanListing(client, listing, (rows) => {
    found = rows.find(matches)
    return found !== undefined
  })
  return found
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

/** The rule in a Cloudflare result; a result that is not a rule is `upstream_error`. */
export function shapedRule(result: unknown): Rule {
  const rule = shapeRule(result)
  if (rule === undefined)
    throw new ToolError("upstream_error", "Cloudflare returned an unexpected routing rule response.")
  return rule
}

/** Refuses an address that already has a rule other than `ownId`, since Cloudflare uses only the first rule for an address. */
export async function assertNoRuleFor(
  client: CloudflareClient,
  zoneId: string,
  to: string,
  ownId?: string,
): Promise<void> {
  const existing = await findRuleFor(client, zoneId, to)
  if (existing === undefined || existing.id === ownId) return
  throw new ToolError(
    "invalid_argument",
    `${to} already has a routing rule (${existing.id}, ${existing.name ?? "unnamed"}), and Cloudflare uses only the first rule for an address; change that one instead. ${NOTHING_CHANGED}`,
  )
}

/** Refuses a forward to an address that is not a verified destination address of the account. */
export async function assertVerifiedDestination(client: CloudflareClient, address: string): Promise<void> {
  const state = await destinationState(client, address)
  if (state === "missing") {
    throw new ToolError(
      "invalid_argument",
      `${address} is not a destination address of this account. cloudflare_email_address_add adds it; Cloudflare then mails its owner, and a rule can forward to it once they confirm. ${NOTHING_CHANGED}`,
    )
  }
  if (state === "unverified") {
    throw new ToolError(
      "invalid_argument",
      `${address} is a destination address whose owner has not confirmed Cloudflare's mail yet; a rule can forward only to a verified address. ${NOTHING_CHANGED}`,
    )
  }
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
