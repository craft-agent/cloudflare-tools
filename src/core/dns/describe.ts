import { isPlainObject } from "../cloudflare/reply"
import type { CallFact } from "../tool"
import { relativeName } from "./names"
import { AUTOMATIC_TTL } from "./values"
import { DNS_WORDS } from "./words"

const AUTO_TTL_WORD = "auto"
const LINE_SEPARATOR = "  "

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

/** A record-count fact under `label`, as `1 record` or `3 records`. */
export function recordCountFact(label: string, count: number): CallFact {
  return {
    label,
    value: { text: count === 1 ? DNS_WORDS.recordCount : DNS_WORDS.recordsCount, values: { count } },
  }
}
