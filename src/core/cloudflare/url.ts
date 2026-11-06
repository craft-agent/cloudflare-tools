import { ToolError } from "../errors"
import { PATH_PARAMS, type Route } from "./routes"

/** The root every Cloudflare path is relative to. */
export const BASE_URL = "https://api.cloudflare.com/client/v4"

/** Matches route template parameters such as `{account_id}`. */
export const TEMPLATE_PARAM_PATTERN = /\{([^{}]*)\}/g

const ACCOUNT_ID_PARAM = "account_id"

/** A query value; an array repeats the key once per item and `undefined` leaves the key out. */
export type QueryValue = string | number | boolean | readonly string[] | undefined

/**
 * Fills a route's `{name}` parts. `account_id` comes from `accountId` and a
 * caller may not give it; every other name must be given and match
 * `PATH_PARAMS`. Anything else is a bug in the calling tool.
 */
export function fillPath(route: Route, accountId: string, params: Record<string, string> = {}): string {
  const names = [...route.path.matchAll(TEMPLATE_PARAM_PATTERN)].map((match) => match[1] ?? "")
  const unknown = names.find((name) => !Object.hasOwn(PATH_PARAMS, name))
  if (unknown !== undefined) {
    throw new ToolError(
      "internal_error",
      `Route ${route.path} names the path parameter "${unknown}", which is not known.`,
    )
  }
  if (Object.hasOwn(params, ACCOUNT_ID_PARAM)) {
    throw new ToolError("internal_error", `${ACCOUNT_ID_PARAM} is filled from the credential, never from the caller.`)
  }
  const unused = Object.keys(params).find((name) => !names.includes(name))
  if (unused !== undefined) {
    throw new ToolError("internal_error", `Route ${route.path} has no path parameter "${unused}".`)
  }
  return route.path.replace(TEMPLATE_PARAM_PATTERN, (_match, name: string) => {
    if (name === ACCOUNT_ID_PARAM) return encodeURIComponent(accountId)
    const value = params[name]
    const pattern = PATH_PARAMS[name]
    if (typeof value !== "string" || !pattern?.test(value)) {
      throw new ToolError("invalid_argument", `The path parameter "${name}" is missing or malformed.`)
    }
    return encodeURIComponent(value)
  })
}

/** Serializes a query object into a URL query string, repeating array elements and omitting undefined values. */
export function buildQuery(query: Record<string, QueryValue>): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue
    if (typeof value === "object") {
      for (const item of value) params.append(key, item)
    } else {
      params.append(key, String(value))
    }
  }
  return params.toString()
}
