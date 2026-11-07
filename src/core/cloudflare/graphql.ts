import type { ErrorCode } from "../errors"
import { isPlainObject } from "./reply"

/** What a GraphQL failure becomes: the error code and the message to throw with. */
export type GraphqlFailure = { code: ErrorCode; message: string }

const MAX_MESSAGES = 3
const MESSAGE_SEPARATOR = "; "
const DAYS_PER_WEEK = 7
const HOURS_PER_DAY = 24
const MINUTES_PER_HOUR = 60
const SECONDS_PER_MINUTE = 60
const SECONDS_PER_DAY = HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE

const ACTOR_TOKEN_ID_PATTERN = /Actor 'com\.cloudflare\.api\.token\.[0-9a-f]+'/gi
const TOKEN_ID_PATTERN = /com\.cloudflare\.api\.token\.[0-9a-f]+/gi
const DURATION_PATTERN = /^(?:(\d+)w)?(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/
const TOO_OLD_PATTERN = /cannot request data older than (\S+?),/
const TOO_WIDE_PATTERN = /cannot request a time range wider than (\S+?),/
const RATE_LIMITED_PATTERN = /rate limiter budget depleted/i
const SENTENCE_END_PATTERN = /[.!?]$/

const AUTHZ_CODE = "authz"
const QUOTA_CODE = "quota"
const UNREADABLE_MESSAGE = "Cloudflare's analytics query failed without a readable error."

/** Replaces the API token ids Cloudflare names in a message ("Actor 'com.cloudflare.api.token.<hex>'" → "The token", any other "com.cloudflare.api.token.<hex>" → "the token"). */
export function scrubTokenIds(text: string): string {
  return text.replace(ACTOR_TOKEN_ID_PATTERN, "The token").replace(TOKEN_ID_PATTERN, "the token")
}

/** Whole days in a Cloudflare duration such as "12w6d" or "4w4d" (w, d, h, m, s parts, in that order); undefined when it is not one or is under a day. Rounded down. */
export function durationDays(text: string): number | undefined {
  const parts = DURATION_PATTERN.exec(text)
  if (!parts) return undefined
  const [weeks = 0, days = 0, hours = 0, minutes = 0, seconds = 0] = parts.slice(1).map((part) => Number(part ?? 0))
  const totalSeconds =
    ((weeks * DAYS_PER_WEEK + days) * HOURS_PER_DAY + hours) * MINUTES_PER_HOUR * SECONDS_PER_MINUTE +
    minutes * SECONDS_PER_MINUTE +
    seconds
  const wholeDays = Math.floor(totalSeconds / SECONDS_PER_DAY)
  return wholeDays >= 1 ? wholeDays : undefined
}

/** `text` ending as a sentence, with a period added unless it already ends with one, an exclamation or a question mark. */
export function sentence(text: string): string {
  return SENTENCE_END_PATTERN.test(text) ? text : `${text}.`
}

function quotaNote(message: string): string {
  const tooOld = TOO_OLD_PATTERN.exec(message)?.[1]
  const oldDays = tooOld === undefined ? undefined : durationDays(tooOld)
  if (oldDays !== undefined) return ` That is ${oldDays} days back: choose a more recent range.`
  const tooWide = TOO_WIDE_PATTERN.exec(message)?.[1]
  const wideDays = tooWide === undefined ? undefined : durationDays(tooWide)
  if (wideDays !== undefined) return ` That is ${wideDays} days: choose a shorter range.`
  return ""
}

/** The failure a reply's non-empty `errors` array stands for. */
export function graphqlFailure(errors: readonly unknown[]): GraphqlFailure {
  const readable = errors.filter(
    (entry): entry is Record<string, unknown> & { message: string } =>
      isPlainObject(entry) && typeof entry.message === "string",
  )
  const first = readable[0]
  if (!first) return { code: "upstream_error", message: UNREADABLE_MESSAGE }

  const messages = readable
    .slice(0, MAX_MESSAGES)
    .map((entry) => scrubTokenIds(entry.message))
    .join(MESSAGE_SEPARATOR)
  const extensionCode = isPlainObject(first.extensions) ? first.extensions.code : undefined

  if (extensionCode === AUTHZ_CODE) return { code: "forbidden", message: messages }
  if (extensionCode === QUOTA_CODE) {
    const note = quotaNote(first.message)
    return { code: "invalid_argument", message: note ? `${sentence(messages)}${note}` : messages }
  }
  if (RATE_LIMITED_PATTERN.test(first.message)) return { code: "rate_limited", message: messages }
  return { code: "upstream_error", message: `Cloudflare's analytics query failed: ${messages}` }
}
