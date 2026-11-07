import { z } from "zod"
import { isPlainObject } from "../cloudflare/reply"

/** The record types Cloudflare DNS holds. */
export const RECORD_TYPES = [
  "A",
  "AAAA",
  "CAA",
  "CERT",
  "CNAME",
  "DNSKEY",
  "DS",
  "HTTPS",
  "LOC",
  "MX",
  "NAPTR",
  "NS",
  "OPENPGPKEY",
  "PTR",
  "SMIMEA",
  "SRV",
  "SSHFP",
  "SVCB",
  "TLSA",
  "TXT",
  "URI",
] as const

/** A record id: 32 hex digits, in either case; lowercase it before use. */
export const recordIdArg = z
  .string()
  .regex(/^[0-9a-fA-F]{32}$/, "must be 32 hex digits")
  .describe("The DNS record id (32 hex digits).")

export const recordListItemSchema = z.object({
  id: z.string().describe("The record id."),
  type: z.string().describe("The record type (e.g. A, CNAME, MX, TXT)."),
  name: z.string().describe("The full record name."),
  content: z.string().describe("The record content, as Cloudflare shows it."),
  data: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("The structured fields of types such as CAA, SRV or URI."),
  priority: z.number().optional().describe("The priority of MX, SRV and URI records."),
  proxied: z.boolean().describe("Whether traffic goes through Cloudflare."),
  proxiable: z.boolean().describe("Whether the record can be proxied."),
  ttl: z.number().describe("Time to live in seconds; 1 means automatic."),
  comment: z.string().nullable().describe("The comment on the record, or null."),
  tags: z.array(z.string()).describe("The record's tags."),
  read_only: z
    .boolean()
    .describe(
      "Whether another Cloudflare product manages the record (a Worker's custom domain, for one): it cannot be changed or deleted here, and the zone file leaves it out.",
    ),
  modified_on: z.string().nullable().describe("When the record was last modified, or null."),
})

export type RecordListItem = z.infer<typeof recordListItemSchema>

/** One record as the list shows it; missing or odd fields become "", false, null, [] and are left out for `data` and `priority`; `read_only` is `meta.read_only`. */
export function shapeRecord(raw: unknown): RecordListItem {
  const item = isPlainObject(raw) ? raw : {}
  return {
    id: typeof item.id === "string" ? item.id : "",
    type: typeof item.type === "string" ? item.type : "",
    name: typeof item.name === "string" ? item.name : "",
    content: typeof item.content === "string" ? item.content : "",
    ...(isPlainObject(item.data) ? { data: item.data } : {}),
    ...(typeof item.priority === "number" ? { priority: item.priority } : {}),
    proxied: typeof item.proxied === "boolean" ? item.proxied : false,
    proxiable: typeof item.proxiable === "boolean" ? item.proxiable : false,
    ttl: typeof item.ttl === "number" ? item.ttl : 0,
    comment: typeof item.comment === "string" ? item.comment : null,
    tags: Array.isArray(item.tags) ? item.tags.filter((tag): tag is string => typeof tag === "string") : [],
    read_only: isPlainObject(item.meta) && item.meta.read_only === true,
    modified_on: typeof item.modified_on === "string" ? item.modified_on : null,
  }
}
