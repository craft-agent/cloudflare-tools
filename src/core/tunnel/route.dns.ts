import { z } from "zod"
import type { CloudflareClient } from "../cloudflare/client"
import type { RecordListItem } from "../dns/records"
import { ToolError } from "../errors"
import { recordSchema, recordsAt } from "../pages/domains"
import type { Zone } from "../zone/lookup"
import { clip } from "./shape"

/** The host every tunnel's CNAME target is under. */
const TUNNEL_HOST_SUFFIX = ".cfargotunnel.com"

const MAX_LISTED_RECORDS = 5
const MAX_LISTED_CONTENT_LENGTH = 100

/** One DNS record as a result keeps it. */
export type DnsRecord = z.output<typeof recordSchema>

/**
 * The hostname's DNS in a result: which keys are set depends on the tool and on what it found;
 * each tool's description says which can appear.
 */
export const dnsReportSchema = z.strictObject({
  created: recordSchema.optional().describe("The proxied CNAME to the tunnel that the call added."),
  kept: recordSchema.optional().describe("The proxied CNAME to the tunnel that is at the hostname, and stays."),
  deleted: recordSchema.optional().describe("The proxied CNAME to the tunnel that the call deleted."),
  missing: z
    .literal(true)
    .optional()
    .describe("True when the hostname has no DNS record, so it does not reach the tunnel."),
  other: z
    .array(recordSchema)
    .max(MAX_LISTED_RECORDS)
    .optional()
    .describe(
      `Up to ${MAX_LISTED_RECORDS} of the records at the hostname that are not a proxied CNAME to the tunnel, so the hostname does not reach the tunnel; the tool never changes them.`,
    ),
})

export type DnsReport = z.output<typeof dnsReportSchema>

/** What the hostname's DNS needs: a CNAME to the tunnel created, the one it already has kept, or a refusal for other records. */
export type DnsState =
  { action: "create" } | { action: "keep"; record: DnsRecord } | { action: "conflict"; records: DnsRecord[] }

/** A `DnsState` the tool can go on with: it creates the CNAME or keeps the one there. */
export type FittingDns = Exclude<DnsState, { action: "conflict" }>

/** The CNAME target of a tunnel. */
export function tunnelTarget(tunnelId: string): string {
  return `${tunnelId}${TUNNEL_HOST_SUFFIX}`
}

/** A record as a result keeps it. */
export function summary(record: RecordListItem): DnsRecord {
  const { id, type, name, content, proxied, read_only } = record
  return { id, type, name, content, proxied, read_only }
}

function isProxiedCnameTo(record: DnsRecord, target: string): boolean {
  return record.type === "CNAME" && record.proxied && record.content.toLowerCase().replace(/\.$/, "") === target
}

/** Reads the records at `hostname` in `zone` and decides what the tunnel's CNAME needs. */
export async function readDnsState(
  client: CloudflareClient,
  zone: Zone,
  hostname: string,
  tunnelId: string,
): Promise<DnsState> {
  const found = await recordsAt(client, zone.id, hostname)
  if (!found) throw new ToolError("upstream_error", "Cloudflare returned an unexpected zone response.")
  const [only, ...others] = found.records
  if (!only) return { action: "create" }
  if (others.length === 0 && isProxiedCnameTo(only, tunnelTarget(tunnelId))) return { action: "keep", record: only }
  return { action: "conflict", records: found.records }
}

/** What a call that writes no DNS record reports of the hostname's DNS: the CNAME kept, none there, or the other records. */
export function dnsReport(state: DnsState): DnsReport {
  if (state.action === "keep") return { kept: state.record }
  if (state.action === "create") return { missing: true }
  return { other: state.records.slice(0, MAX_LISTED_RECORDS) }
}

/** Whether two reads of the hostname's DNS call for the same step on the same record. */
export function sameDns(first: DnsState, second: DnsState): boolean {
  if (first.action !== second.action) return false
  return first.action !== "keep" || (second.action === "keep" && first.record.id === second.record.id)
}

/** Refuses a hostname that has DNS records the tool would not own, listing some of them. */
export function assertDnsFits(state: DnsState, hostname: string): asserts state is FittingDns {
  if (state.action !== "conflict") return
  const listed = state.records
    .slice(0, MAX_LISTED_RECORDS)
    .map((record) => `${record.type} ${clip(record.content, MAX_LISTED_CONTENT_LENGTH)}`)
  const more = state.records.length - listed.length
  throw new ToolError(
    "invalid_argument",
    `${hostname} already has DNS records (${listed.join(", ")}${more > 0 ? `, and ${more} more` : ""}); change or delete them with the DNS tools first. Nothing was changed.`,
  )
}
