import type { RecordListItem } from "./records"
import { sortedJson } from "./sorted-json"
import {
  DATA_KEYS,
  HOSTNAME_TYPES,
  NO_SERVICE_TARGET,
  PROXIABLE_TYPES,
  isOneOf,
  type NewRecord,
  type WritableType,
} from "./values"

/** The fields of a record an edit can change, in the order a patch lists them. */
export const EDITABLE_FIELDS = ["name", "content", "data", "priority", "ttl", "proxied", "comment"] as const

export type EditableField = (typeof EDITABLE_FIELDS)[number]

/** The fields of an edit that were given; the others keep the record's value. */
export type RecordChange = Partial<Pick<NewRecord, EditableField>>

const QUOTED_TEXT = /^"([^"]*)"$/

/** Lowercase without a trailing dot, the way Cloudflare shows a hostname. */
function bareHost(value: string): string {
  const lower = value.trim().toLowerCase()
  return lower.endsWith(".") ? lower.slice(0, -1) : lower
}

/** TXT text without the quotes Cloudflare may wrap it in, hostnames without case or a trailing dot. */
function contentOf(type: WritableType, content: string): string {
  if (type === "TXT") return QUOTED_TEXT.exec(content)?.[1] ?? content
  return isOneOf(HOSTNAME_TYPES, type) ? bareHost(content) : content
}

/** The keys of `data` the add tool takes for `type`; Cloudflare may report more. */
function dataOf(type: keyof typeof DATA_KEYS, data: RecordListItem["data"]): NewRecord["data"] {
  const picked = Object.fromEntries(
    DATA_KEYS[type].flatMap((key) => (data?.[key] !== undefined ? [[key, data[key]]] : [])),
  )
  if (typeof picked.target === "string" && picked.target !== NO_SERVICE_TARGET) picked.target = bareHost(picked.target)
  return picked
}

/** `current`, a record of a type the tools write, as the add tool would take it: the form an edit is laid over. */
export function currentForm(current: RecordListItem, type: WritableType): NewRecord {
  const value =
    type === "CAA" || type === "SRV"
      ? { data: dataOf(type, current.data) }
      : { content: contentOf(type, current.content) }
  return {
    type,
    name: current.name.toLowerCase(),
    ...value,
    ...(type === "MX" && current.priority !== undefined ? { priority: current.priority } : {}),
    ttl: current.ttl,
    ...(isOneOf(PROXIABLE_TYPES, type) ? { proxied: current.proxied } : {}),
    ...(current.comment !== null ? { comment: current.comment } : {}),
  }
}

/** `form` with the fields `change` gives; an empty comment stays in, since it means none. */
export function withChange(form: NewRecord, change: RecordChange): NewRecord {
  const given = EDITABLE_FIELDS.filter((field) => change[field] !== undefined)
  return { ...form, ...Object.fromEntries(given.map((field) => [field, change[field]])) }
}

/** The fields of `body`, a validated record, whose value differs from `before`; a removed comment is `""`. */
export function changedFields(before: NewRecord, body: Record<string, unknown>): Record<string, unknown> {
  const changed: Record<string, unknown> = {}
  for (const field of EDITABLE_FIELDS) {
    const was = field === "comment" ? (before.comment ?? "") : before[field]
    const now = field === "comment" ? (body.comment ?? "") : body[field]
    if (now !== undefined && sortedJson(was) !== sortedJson(now)) changed[field] = now
  }
  return changed
}
