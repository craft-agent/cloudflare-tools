import type { z } from "zod"
import type { CloudflareClient } from "../cloudflare/client"
import { sentence } from "../cloudflare/graphql"
import { refusedByCloudflare } from "../cloudflare/refusal"
import { isPlainObject } from "../cloudflare/reply"
import { ROUTES } from "../cloudflare/routes"
import { shapeRecord, type RecordListItem } from "../dns/records"
import { AUTOMATIC_TTL } from "../dns/values"
import { ToolError, type ErrorDetails } from "../errors"
import { recordSchema, recordsAt } from "../pages/domains"
import type { Zone } from "../zone/lookup"
import { withHint } from "./route"
import { ruleLabel, type NewRule } from "./route.rules"
import { clip } from "./shape"

/** The host every tunnel's CNAME target is under. */
const TUNNEL_HOST_SUFFIX = ".cfargotunnel.com"

/** The comment on the record the tool adds, so the dashboard shows what it is for. */
const CNAME_COMMENT = "Cloudflare Tunnel"

const MAX_LISTED_RECORDS = 5
const MAX_LISTED_CONTENT_LENGTH = 100

/** What a failed DNS step gains when it is forbidden: the permission the step needs. */
const DNS_EDIT_HINT = "The token needs Zone → DNS → Edit."

/** One DNS record as a result keeps it. */
export type DnsRecord = z.output<typeof recordSchema>

/** What the hostname's DNS needs: a CNAME to the tunnel created, the one it already has kept, or a refusal for other records. */
export type DnsState =
  { action: "create" } | { action: "keep"; record: DnsRecord } | { action: "conflict"; records: DnsRecord[] }

/** A `DnsState` the tool can go on with: it creates the CNAME or keeps the one there. */
export type FittingDns = Exclude<DnsState, { action: "conflict" }>

/** The publication a DNS step finishes: the tunnel and rule written to its configuration, and the account the call named. */
export type Publication = { account: string | undefined; tunnel: string; rule: NewRule }

/** The CNAME target of a tunnel. */
export function tunnelTarget(tunnelId: string): string {
  return `${tunnelId}${TUNNEL_HOST_SUFFIX}`
}

function summary(record: RecordListItem): DnsRecord {
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

/** The tunnel's CNAME as `cloudflare_dns_record_add` takes a new record. */
function cnameRecord({ tunnel, rule }: Publication) {
  return { type: "CNAME", name: rule.hostname, content: tunnelTarget(tunnel), proxied: true, comment: CNAME_COMMENT }
}

/** The `cloudflare_dns_record_add` call that adds the tunnel's CNAME, as that tool takes its arguments. */
function addCnameCall(publication: Publication, zone: Zone): ErrorDetails {
  const { account } = publication
  return { ...(account === undefined ? {} : { account }), zone: zone.name, records: [cnameRecord(publication)] }
}

/**
 * The failure of the DNS step, which runs after the configuration was written: it keeps Cloudflare's code when
 * Cloudflare refused the call, says whether the record may have been added, and carries the call that finishes it.
 * A cancellation, and anything that is not a tool failure, passes untouched.
 */
function dnsStepFailure(error: unknown, zone: Zone, publication: Publication): unknown {
  if (!(error instanceof ToolError)) return error
  const refused = refusedByCloudflare(error)
  const { rule } = publication
  const added = refused ? "The DNS record was not added; " : "Cloudflare may or may not have added the DNS record; "
  const message = `${sentence(withHint(error, DNS_EDIT_HINT).message)} The tunnel's configuration was changed: it now sends ${ruleLabel(rule)} to ${rule.service}. ${added}until it is, no visitor reaches the hostname. cloudflare_dns_read shows the records, and cloudflare_dns_record_add with the record in this error's details adds it.`
  return new ToolError(refused ? error.code : "upstream_error", message, {
    cause: error,
    details: {
      done: ["configuration"],
      configuration: {
        tunnel: publication.tunnel,
        rule: {
          hostname: rule.hostname,
          ...(rule.path === undefined ? {} : { path: rule.path }),
          service: rule.service,
        },
      },
      remaining: { tool: "cloudflare_dns_record_add", arguments: addCnameCall(publication, zone) },
    },
  })
}

async function postCname(client: CloudflareClient, zone: Zone, publication: Publication): Promise<RecordListItem> {
  const { result } = await client.request<unknown>(ROUTES.dnsRecordsBatch, {
    path: { zone_id: zone.id },
    body: { posts: [{ ...cnameRecord(publication), ttl: AUTOMATIC_TTL }] },
  })
  const created = isPlainObject(result) && Array.isArray(result.posts) ? result.posts[0] : undefined
  if (!isPlainObject(created)) {
    throw new ToolError("upstream_error", "Cloudflare returned an unexpected DNS batch response.")
  }
  return shapeRecord(created)
}

/**
 * Adds the proxied CNAME from the hostname to the tunnel and returns the record Cloudflare created. It sends the
 * batch itself, since the batch tool's notes would say nothing was changed while the configuration already was.
 */
export async function addTunnelCname(
  client: CloudflareClient,
  zone: Zone,
  publication: Publication,
): Promise<DnsRecord> {
  try {
    return summary(await postCname(client, zone, publication))
  } catch (error) {
    throw dnsStepFailure(error, zone, publication)
  }
}
