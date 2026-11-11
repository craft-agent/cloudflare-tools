import type { z } from "zod"
import type { CloudflareClient, RequestOptions } from "../cloudflare/client"
import { sentence } from "../cloudflare/graphql"
import { isPlainObject, type ResultInfo } from "../cloudflare/reply"
import { ACCESS_APP_ID_PATTERN, ROUTES, type Route } from "../cloudflare/routes"
import { isToolError, ToolError } from "../errors"
import { shapeApp } from "./shape.app"
import { shapeRows } from "./shape"
import { shapePolicy, type policySchema } from "./shape.policy"

/** How many items one Access list request asks for. */
export const PER_PAGE_COUNT = 100
const MAX_PAGES = 10
const ACCOUNT_READ_HINT = "The token needs Account → Access: Apps and Policies → Read."
const ZONE_READ_HINT = "The token needs Zone → Access: Apps and Policies → Read."

/** Where Access applications are read: the account, or one zone. */
export type AccessScope = {
  apps: Route
  app: Route
  appPolicies: Route
  /** The path parameters the scope's routes name besides the application. */
  path: Record<string, string>
  hint: string
  /** How the scope reads in a message: "the account" or "the zone". */
  where: string
}

const ACCOUNT_SCOPE: AccessScope = {
  apps: ROUTES.accessApps,
  app: ROUTES.accessApp,
  appPolicies: ROUTES.accessAppPolicies,
  path: {},
  hint: ACCOUNT_READ_HINT,
  where: "the account",
}

/** The scope of a zone's applications, or of the account's when no zone is given. */
export function scopeOf(zone: { id: string } | undefined): AccessScope {
  if (!zone) return ACCOUNT_SCOPE
  return {
    apps: ROUTES.zoneAccessApps,
    app: ROUTES.zoneAccessApp,
    appPolicies: ROUTES.zoneAccessAppPolicies,
    path: { zone_id: zone.id },
    hint: ZONE_READ_HINT,
    where: "the zone",
  }
}

async function requestAccess(client: CloudflareClient, route: Route, options: RequestOptions, hint: string) {
  try {
    return await client.request<unknown>(route, options)
  } catch (error) {
    if (isToolError(error) && error.code === "forbidden") {
      throw new ToolError("forbidden", `${sentence(error.message)} ${hint}`, { cause: error })
    }
    throw error
  }
}

async function readRows(
  client: CloudflareClient,
  route: Route,
  options: RequestOptions,
  hint: string,
  what: string,
): Promise<{ rows: unknown[]; resultInfo: ResultInfo | undefined }> {
  const { result, resultInfo } = await requestAccess(client, route, options, hint)
  if (!Array.isArray(result)) {
    throw new ToolError("upstream_error", `Cloudflare returned an unexpected ${what} response.`)
  }
  return { rows: result as unknown[], resultInfo }
}

/** One page of the scope's applications, unshaped. */
export function listApps(client: CloudflareClient, scope: AccessScope, page: number) {
  return readRows(
    client,
    scope.apps,
    { path: scope.path, query: { page, per_page: PER_PAGE_COUNT } },
    scope.hint,
    "applications",
  )
}

/** One page of the account's reusable policies, unshaped. */
export function listPolicies(client: CloudflareClient, page: number) {
  return readRows(
    client,
    ROUTES.accessPolicies,
    { query: { page, per_page: PER_PAGE_COUNT } },
    ACCOUNT_READ_HINT,
    "policies",
  )
}

/**
 * The id an application reference names: a UUID as it is, else the one application with exactly that name.
 * Names need not be unique, so the whole bounded list is read and several matches are refused.
 */
export async function appIdOf(client: CloudflareClient, scope: AccessScope, ref: string): Promise<string> {
  if (ACCESS_APP_ID_PATTERN.test(ref)) return ref
  const ids = new Set<string>()
  let listEnd = false
  for (let page = 1; page <= MAX_PAGES && !listEnd; page++) {
    const { rows, resultInfo } = await listApps(client, scope, page)
    for (const row of rows) {
      if (isPlainObject(row) && row.name === ref && typeof row.id === "string") ids.add(row.id)
    }
    listEnd =
      rows.length < PER_PAGE_COUNT || (typeof resultInfo?.total_pages === "number" && page >= resultInfo.total_pages)
  }
  const [first, ...others] = ids
  if (first !== undefined && others.length === 0) return first
  if (first !== undefined) {
    throw new ToolError(
      "invalid_argument",
      `Several Access applications are named "${ref}" in ${scope.where}; pass one of their ids: ${[...ids].join(", ")}.`,
    )
  }
  throw new ToolError(
    "not_found",
    listEnd
      ? `No Access application named "${ref}" in ${scope.where}.`
      : `No Access application named "${ref}" among the first ${PER_PAGE_COUNT * MAX_PAGES} applications of ${scope.where}; pass its id.`,
  )
}

async function readAppPolicies(client: CloudflareClient, scope: AccessScope, appId: string) {
  const policies: z.output<typeof policySchema>[] = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { rows, resultInfo } = await readRows(
      client,
      scope.appPolicies,
      { path: { ...scope.path, app_id: appId }, query: { page, per_page: PER_PAGE_COUNT } },
      scope.hint,
      "policies",
    )
    policies.push(...shapeRows(rows, shapePolicy))
    if (typeof resultInfo?.total_pages !== "number" || page >= resultInfo.total_pages) return policies
  }
  throw new ToolError("upstream_error", "The application has more policies than this tool reads.")
}

/** One application with its policies, both read at once. */
export async function readApp(client: CloudflareClient, scope: AccessScope, appId: string) {
  const [reply, policies] = await Promise.all([
    requestAccess(client, scope.app, { path: { ...scope.path, app_id: appId } }, scope.hint),
    readAppPolicies(client, scope, appId),
  ])
  const app = shapeApp(reply.result)
  if (!app) throw new ToolError("upstream_error", "Cloudflare returned an unexpected application response.")
  return { ...app, policies }
}
