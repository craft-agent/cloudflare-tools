import { isIPv4, isIPv6 } from "node:net"
import { z } from "zod"
import { ToolError } from "../errors"
import { recordLabel, recordName, relativeName, targetHostname } from "./names"

/** The record types the tools write. */
export const WRITABLE_TYPES = ["A", "AAAA", "CNAME", "MX", "TXT", "NS", "CAA", "SRV"] as const

export type WritableType = (typeof WRITABLE_TYPES)[number]

export const AUTOMATIC_TTL = 1
export const MIN_TTL = 60
export const MAX_TTL = 86400
const MAX_UINT8 = 255
const MAX_UINT16 = 65535
const MAX_TXT_LENGTH = 2048
const MAX_CAA_VALUE_LENGTH = 255
export const MAX_COMMENT_LENGTH = 500
export const NO_SERVICE_TARGET = "."
const CAA_TAGS = ["issue", "issuewild", "iodef", "issuemail", "issuevmc"] as const
const CONTROL_CHARACTER = /[\x00-\x1f\x7f]/
const LINE_BREAK = /[\r\n]/

export const CONTENT_TYPES: readonly WritableType[] = ["A", "AAAA", "CNAME", "MX", "TXT", "NS"]
export const HOSTNAME_TYPES: readonly WritableType[] = ["CNAME", "MX", "NS"]
export const PROXIABLE_TYPES: readonly WritableType[] = ["A", "AAAA", "CNAME"]
export const DATA_KEYS = {
  CAA: ["flags", "tag", "value"],
  SRV: ["priority", "weight", "port", "target"],
} as const

export const dataSchema = z
  .object({
    flags: z.number().int().optional().describe("CAA: the flags, 0–255 (0 for most records)."),
    tag: z
      .string()
      .optional()
      .describe(`CAA: the property tag, one of ${CAA_TAGS.join(", ")}.`),
    value: z.string().optional().describe("CAA: the property value, such as the CA's domain."),
    priority: z.number().int().optional().describe("SRV: the priority, 0–65535 (lower is tried first)."),
    weight: z.number().int().optional().describe("SRV: the weight, 0–65535."),
    port: z.number().int().optional().describe("SRV: the port, 0–65535."),
    target: z.string().optional().describe('SRV: the host that serves it, or "." when the service is not offered.'),
  })
  .strict()

export const newRecordSchema = z
  .object({
    type: z.enum(WRITABLE_TYPES).describe("The record type."),
    name: z.string().describe('The record name: relative to the zone ("www", "_dmarc"), "@" for the apex, or full.'),
    content: z
      .string()
      .optional()
      .describe(
        "A, AAAA, CNAME, MX, TXT, NS: the value (an IPv4 address, an IPv6 address, a hostname, or the text of a TXT record). Required for these types, not allowed for CAA and SRV.",
      ),
    data: dataSchema
      .optional()
      .describe(
        "CAA (flags, tag, value) and SRV (priority, weight, port, target): the structured value. Required for these types, not allowed for the others.",
      ),
    priority: z
      .number()
      .int()
      .optional()
      .describe(
        "MX only: the preference, 0–65535 (lower is tried first). Required for MX; SRV takes its priority in `data`.",
      ),
    ttl: z
      .number()
      .int()
      .optional()
      .describe(`Seconds to live: ${AUTOMATIC_TTL} for automatic, or ${MIN_TTL}–${MAX_TTL}. Default ${AUTOMATIC_TTL}.`),
    proxied: z
      .boolean()
      .optional()
      .describe(
        "A, AAAA, CNAME only: send traffic through Cloudflare. Default false; a proxied record's TTL is automatic.",
      ),
    comment: z.string().optional().describe(`A one-line note on the record, up to ${MAX_COMMENT_LENGTH} characters.`),
  })
  .strict()

export type NewRecord = z.output<typeof newRecordSchema>

type Refuse = (problem: string) => never

type Context = { record: NewRecord; zoneName: string; fullName: string; refuse: Refuse }

export function isOneOf<T extends string>(list: readonly T[], value: string): value is T {
  return (list as readonly string[]).includes(value)
}

/** The lowercase ASCII form of a hostname: trimmed, without one trailing dot, IDN as punycode; it must not be the record's own name. */
function hostname(value: string, field: string, { fullName, refuse }: Context): string {
  const result = targetHostname(value)
  if (result.problem !== undefined) return refuse(`${field} "${value}" is not a valid hostname: ${result.problem}`)
  if (result.host === fullName) return refuse(`${field} "${value}" is the record's own name; point it at another host`)
  return result.host
}

function integerIn(value: unknown, field: string, max: number, refuse: Refuse): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > max) {
    refuse(`${field} must be a whole number from 0 to ${max}`)
  }
  return value
}

function assertNoControlCharacters(value: string, field: string, refuse: Refuse): void {
  if (CONTROL_CHARACTER.test(value)) refuse(`${field} must not hold control characters such as line breaks or tabs`)
}

function textContent(content: string, refuse: Refuse): string {
  if (content.length < 1 || content.length > MAX_TXT_LENGTH) {
    refuse(`a TXT value must be 1–${MAX_TXT_LENGTH} characters; this one has ${content.length}`)
  }
  assertNoControlCharacters(content, "a TXT value is one line of text; it", refuse)
  return content
}

function addressContent({ record, refuse }: Context, content: string): string {
  if (record.type === "A" && !isIPv4(content))
    refuse(`content "${content}" is not an IPv4 address; an A record holds one`)
  if (record.type === "AAAA" && (!isIPv6(content) || content.includes("%"))) {
    refuse(`content "${content}" is not an IPv6 address; an AAAA record holds one`)
  }
  return content
}

function contentOf(ctx: Context): string {
  const { record } = ctx
  if (record.data !== undefined) ctx.refuse("takes `content`, not `data`")
  if (record.content === undefined) ctx.refuse("requires `content`")
  const content = record.content
  if (isOneOf(HOSTNAME_TYPES, record.type)) return hostname(content, "content", ctx)
  return record.type === "TXT" ? textContent(content, ctx.refuse) : addressContent(ctx, content)
}

function assertDataKeys(data: Record<string, unknown>, type: keyof typeof DATA_KEYS, refuse: Refuse): void {
  const allowed: readonly string[] = DATA_KEYS[type]
  const given = Object.keys(data).filter((key) => data[key] !== undefined)
  const extra = given.filter((key) => !allowed.includes(key))
  if (extra.length > 0) refuse(`${type} \`data\` takes only ${allowed.join(", ")}; remove ${extra.join(", ")}`)
  const missing = allowed.filter((key) => !given.includes(key))
  if (missing.length > 0) refuse(`${type} \`data\` needs ${missing.join(", ")}`)
}

function caaData(data: NonNullable<NewRecord["data"]>, refuse: Refuse): Record<string, unknown> {
  const flags = integerIn(data.flags, "data.flags", MAX_UINT8, refuse)
  const tag = data.tag as string
  if (!isOneOf(CAA_TAGS, tag)) refuse(`data.tag "${tag}" must be one of ${CAA_TAGS.join(", ")}`)
  const value = data.value as string
  if (value === "" || value.length > MAX_CAA_VALUE_LENGTH) {
    refuse(`data.value must be 1–${MAX_CAA_VALUE_LENGTH} characters; this one has ${value.length}`)
  }
  assertNoControlCharacters(value, "data.value", refuse)
  return { flags, tag, value }
}

function assertServiceName({ fullName, zoneName, refuse }: Context): void {
  const labels = relativeName(fullName, zoneName).split(".")
  if (labels.length < 2 || !labels[0]!.startsWith("_") || !labels[1]!.startsWith("_")) {
    refuse("an SRV name starts with two labels that begin with `_`, as in `_sip._tcp`")
  }
}

function srvData(data: NonNullable<NewRecord["data"]>, ctx: Context): Record<string, unknown> {
  assertServiceName(ctx)
  const priority = integerIn(data.priority, "data.priority", MAX_UINT16, ctx.refuse)
  const weight = integerIn(data.weight, "data.weight", MAX_UINT16, ctx.refuse)
  const port = integerIn(data.port, "data.port", MAX_UINT16, ctx.refuse)
  const target = data.target as string
  return {
    priority,
    weight,
    port,
    target: target === NO_SERVICE_TARGET ? target : hostname(target, "data.target", ctx),
  }
}

function dataOf(ctx: Context, type: keyof typeof DATA_KEYS): Record<string, unknown> {
  const { record } = ctx
  if (record.content !== undefined) ctx.refuse("takes `data`, not `content`")
  if (record.data === undefined) ctx.refuse(`requires \`data\` with ${DATA_KEYS[type].join(", ")}`)
  const data = record.data
  assertDataKeys(data, type, ctx.refuse)
  return type === "CAA" ? caaData(data, ctx.refuse) : srvData(data, ctx)
}

function mxPriority({ record, refuse }: Context): number | undefined {
  if (record.type !== "MX") {
    if (record.priority !== undefined) refuse("takes no `priority`; only MX does (an SRV record puts it in `data`)")
    return undefined
  }
  if (record.priority === undefined) refuse(`requires \`priority\`, a whole number from 0 to ${MAX_UINT16}`)
  return integerIn(record.priority, "priority", MAX_UINT16, refuse)
}

function ttlOf({ record, refuse }: Context): number {
  const ttl = record.ttl ?? AUTOMATIC_TTL
  if (ttl !== AUTOMATIC_TTL && (ttl < MIN_TTL || ttl > MAX_TTL)) {
    refuse(`ttl ${ttl} is not allowed; use ${AUTOMATIC_TTL} for automatic, or ${MIN_TTL}–${MAX_TTL} seconds`)
  }
  return ttl
}

function proxiedOf({ record, refuse }: Context, ttl: number): boolean | undefined {
  if (!isOneOf(PROXIABLE_TYPES, record.type)) {
    if (record.proxied === true) refuse("cannot be proxied; only A, AAAA and CNAME records can")
    return undefined
  }
  const proxied = record.proxied ?? false
  if (proxied && ttl !== AUTOMATIC_TTL) {
    refuse(`a proxied record's TTL is automatic; leave out \`ttl\` or use ${AUTOMATIC_TTL}`)
  }
  return proxied
}

function commentOf({ record, refuse }: Context): string | undefined {
  const comment = record.comment ?? ""
  if (LINE_BREAK.test(comment)) refuse("`comment` must be one line, with no line breaks")
  if (comment.length > MAX_COMMENT_LENGTH) {
    refuse(`\`comment\` is longer than ${MAX_COMMENT_LENGTH} characters (${comment.length})`)
  }
  return comment === "" ? undefined : comment
}

function fullNameOf(record: NewRecord, zoneName: string, where: string): string {
  try {
    return recordName(record.name, zoneName)
  } catch (error) {
    if (error instanceof ToolError) {
      throw new ToolError(error.code, `${where} (${record.type}): ${error.message}`, { cause: error })
    }
    throw error
  }
}

/**
 * Cloudflare's create body for one new record, after checking every rule the tool can check before sending.
 * `where` prefixes each refusal (`records[2]`); a refusal is `invalid_argument` and says what to change.
 */
export function recordBody(record: NewRecord, zoneName: string, where: string): Record<string, unknown> {
  const fullName = fullNameOf(record, zoneName, where)
  const label = `${where} ${recordLabel(record.type, fullName, zoneName)}`
  const refuse: Refuse = (problem) => {
    throw new ToolError("invalid_argument", `${label}: ${problem}`)
  }
  const ctx: Context = { record, zoneName, fullName, refuse }

  const value = isOneOf(CONTENT_TYPES, record.type) ? { content: contentOf(ctx) } : { data: dataOf(ctx, record.type) }
  const priority = mxPriority(ctx)
  const ttl = ttlOf(ctx)
  const proxied = proxiedOf(ctx, ttl)
  const comment = commentOf(ctx)

  return {
    type: record.type,
    name: fullName,
    ...value,
    ttl,
    ...(proxied !== undefined ? { proxied } : {}),
    ...(priority !== undefined ? { priority } : {}),
    ...(comment !== undefined ? { comment } : {}),
  }
}
