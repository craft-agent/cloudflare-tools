import { ToolError, isAbortError, type ErrorCode } from "../errors"

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

/** What a failed write's message gains: `nothing` when Cloudflare refused it, `maybe` when the failure does not tell. */
export type WriteFailureNotes = { readonly nothing: string; readonly maybe: string }

/** The failure of one write, with the note that says whether anything changed. A cancellation and anything not a ToolError pass untouched. */
export function failureOfWrite(error: unknown, notes: WriteFailureNotes): unknown {
  if (isAbortError(error) || !(error instanceof ToolError)) return error
  if (refusedByCloudflare(error)) {
    return new ToolError(error.code, `${error.message} ${notes.nothing}`, { cause: error })
  }
  if (error.code === "upstream_error") {
    return new ToolError("upstream_error", `${error.message} ${notes.maybe}`, { cause: error })
  }
  return error
}
