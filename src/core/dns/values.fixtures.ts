import { isToolError } from "../errors"
import { ZONE_NAME } from "../zone/fixtures"
import { recordBody, type NewRecord } from "./values"

export const WHERE = "records[2]"

/** Cloudflare's create body for `record` in the fixture zone. */
export function bodyOf(record: NewRecord): Record<string, unknown> {
  return recordBody(record, ZONE_NAME, WHERE)
}

/** The message of the `invalid_argument` refusal `record` earns; fails when it is accepted or fails otherwise. */
export function refusalOf(record: NewRecord): string {
  try {
    recordBody(record, ZONE_NAME, WHERE)
  } catch (error) {
    if (isToolError(error) && error.code === "invalid_argument") return error.message
    throw error
  }
  throw new Error(`Expected ${JSON.stringify(record)} to be refused`)
}
