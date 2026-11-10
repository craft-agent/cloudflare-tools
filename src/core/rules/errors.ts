import { sentence } from "../cloudflare/graphql"
import { ToolError } from "../errors"

/** What a refusal ends with: the call sent nothing that changes the zone. */
export const NOTHING_CHANGED = "Nothing was changed."

/** A forbidden failure gains the permission the call needs; any other failure is returned as it is. */
export function withHint(error: ToolError, hint: string): ToolError {
  if (error.code !== "forbidden") return error
  return new ToolError("forbidden", `${sentence(error.message)} ${hint}`, { cause: error })
}
