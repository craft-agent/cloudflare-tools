import { isPlainObject } from "../cloudflare/reply"
import type { CallFact } from "../tool"
import { EDITABLE_FIELDS, type EditableField } from "./current"
import { relativeName } from "./names"
import type { RecordListItem } from "./records"
import { AUTOMATIC_TTL, DATA_KEYS, type NewRecord } from "./values"
import { DNS_WORDS } from "./words"

const AUTO_TTL_WORD = "auto"
const NO_VALUE = "(none)"
const TRUE_WORD = "yes"
const FALSE_WORD = "no"
const LINE_SEPARATOR = "  "
const CHANGE_INDENT = "  "

/** A Cloudflare record or the body a create sends: the fields the one-line forms read. */
export type RecordLike = {
  type: string
  name: string
  content?: unknown
  data?: unknown
  priority?: unknown
  ttl?: unknown
  proxied?: unknown
  comment?: unknown
}

/** The value of a record on one line of text: the MX preference before its host, the `data` values of a CAA or SRV record, else the content. */
export function recordValue(record: RecordLike): string {
  const raw =
    typeof record.content === "string" && record.content !== ""
      ? record.content
      : isPlainObject(record.data)
        ? Object.values(record.data).join(" ")
        : ""
  const priority = record.type === "MX" && typeof record.priority === "number" ? `${record.priority} ` : ""
  return `${priority}${raw}`
}

/** A TTL as the prompt shows it: `auto` for the automatic one, else the seconds. */
function ttlWord(ttl: unknown): string {
  return ttl === AUTOMATIC_TTL ? AUTO_TTL_WORD : String(ttl)
}

/** One record in the order of a zone file: `www A 192.0.2.1  TTL auto  proxied  # comment`; the TTL, `proxied` and the comment only when the record has them. */
export function recordLine(record: RecordLike, zoneName: string): string {
  const head = `${relativeName(record.name, zoneName)} ${record.type} ${recordValue(record)}`.trimEnd()
  const parts = [
    head,
    ...(typeof record.ttl === "number" ? [`TTL ${ttlWord(record.ttl)}`] : []),
    ...(record.proxied === true ? ["proxied"] : []),
    ...(typeof record.comment === "string" && record.comment !== "" ? [`# ${record.comment}`] : []),
  ]
  return parts.join(LINE_SEPARATOR)
}

/** The values of a CAA or SRV record's `data` in the order of its keys, joined by a space. */
function dataWord(type: string, data: unknown): string {
  if (!isPlainObject(data)) return NO_VALUE
  const keys = type === "CAA" || type === "SRV" ? DATA_KEYS[type] : Object.keys(data)
  return keys.flatMap((key) => (data[key] !== undefined ? [String(data[key])] : [])).join(" ")
}

/** One value of an edit as the prompt shows it, by the field of the record it belongs to. */
function fieldWord(field: EditableField, type: string, value: unknown, zoneName: string): string {
  if (value === undefined || value === null) return NO_VALUE
  switch (field) {
    case "name":
      return relativeName(String(value), zoneName)
    case "data":
      return dataWord(type, value)
    case "ttl":
      return ttlWord(value)
    case "proxied":
      return value === true ? TRUE_WORD : FALSE_WORD
    case "comment":
      return value === "" ? NO_VALUE : String(value)
    default:
      return String(value)
  }
}

/**
 * One changed record: its name and type as Cloudflare reports them, then one
 * indented line `field: before → after` for each field of `fields` (the
 * patch's fields) in the order a patch lists them. `before` is the record in
 * the form an edit is laid over.
 */
export function changeBlock(
  record: RecordListItem,
  before: NewRecord,
  fields: Record<string, unknown>,
  zoneName: string,
): string {
  const lines = EDITABLE_FIELDS.filter((field) => field in fields).map(
    (field) =>
      `${CHANGE_INDENT}${field}: ${fieldWord(field, before.type, before[field], zoneName)} → ${fieldWord(field, before.type, fields[field], zoneName)}`,
  )
  return [`${relativeName(record.name, zoneName)} ${record.type}`, ...lines].join("\n")
}

/** A record-count fact under `label`, as `1 record` or `3 records`. */
export function recordCountFact(label: string, count: number): CallFact {
  return {
    label,
    value: { text: count === 1 ? DNS_WORDS.recordCount : DNS_WORDS.recordsCount, values: { count } },
  }
}
