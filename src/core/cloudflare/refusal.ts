import type { ErrorCode, ToolError } from "../errors"

/** Codes of a failure Cloudflare raised before it deployed anything. */
const REFUSED_CODES: readonly ErrorCode[] = [
  "invalid_argument",
  "not_found",
  "forbidden",
  "unauthenticated",
  "rate_limited",
  "stale",
]

/** An HTTP 4xx the client has no code for; Cloudflare refused that call too. */
const OTHER_REFUSAL = /^Cloudflare answered HTTP 4\d\d: /

/** Whether a failed write was a refusal by Cloudflare, which acted on nothing, rather than a failure that does not tell. */
export function refusedByCloudflare(error: ToolError): boolean {
  return REFUSED_CODES.includes(error.code) || (error.code === "upstream_error" && OTHER_REFUSAL.test(error.message))
}
