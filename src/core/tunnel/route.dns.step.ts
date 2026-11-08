import type { CloudflareClient } from "../cloudflare/client"
import { sentence } from "../cloudflare/graphql"
import { refusedByCloudflare } from "../cloudflare/refusal"
import { isPlainObject } from "../cloudflare/reply"
import { ROUTES } from "../cloudflare/routes"
import { shapeRecord } from "../dns/records"
import { AUTOMATIC_TTL } from "../dns/values"
import { ToolError, type ErrorDetails } from "../errors"
import type { Zone } from "../zone/lookup"
import { withHint } from "./route"
import { tunnelTarget, summary, type DnsRecord } from "./route.dns"
import { ruleDetails, ruleLabel, type NewRule } from "./route.rules"

/** The comment on the record the tool adds, so the dashboard shows what it is for. */
const CNAME_COMMENT = "Cloudflare Tunnel"

/** What a failed DNS step gains when it is forbidden: the permission the step needs. */
const DNS_EDIT_HINT = "The token needs Zone → DNS → Edit."

/** The rule a call put into, or took out of, the tunnel's configuration, and the account the call named. */
export type RuleChange = { account: string | undefined; tunnel: string; rule: NewRule }

/** What a DNS step that failed leaves, and the call that finishes it. */
type FailedStep = {
  /** What the step was to do to the record. */
  verb: "added" | "deleted"
  /** What the configuration now does, as the message says it. */
  changed: string
  /** What holds for the hostname until the record is as it should be. */
  consequence: string
  /** What `details.configuration` says was written, besides the tunnel. */
  written: ErrorDetails
  /** The tool whose call finishes the step, and its arguments. */
  tool: string
  call: ErrorDetails
}

const FINISHING_VERB = { added: "adds", deleted: "deletes" } as const

/**
 * The failure of the DNS step, which runs after the configuration was written: it keeps Cloudflare's code when
 * Cloudflare refused the call, says whether the record may have been changed, and carries the call that finishes it.
 * A cancellation, and anything that is not a tool failure, passes untouched.
 */
function dnsStepFailure(error: unknown, { tunnel }: RuleChange, step: FailedStep): unknown {
  if (!(error instanceof ToolError)) return error
  const refused = refusedByCloudflare(error)
  const record = refused
    ? `The DNS record was not ${step.verb}; `
    : `Cloudflare may or may not have ${step.verb} the DNS record; `
  const message = `${sentence(withHint(error, DNS_EDIT_HINT).message)} The tunnel's configuration was changed: ${step.changed}. ${record}${step.consequence}. cloudflare_dns_read shows the records, and ${step.tool} with the record in this error's details ${FINISHING_VERB[step.verb]} it.`
  return new ToolError(refused ? error.code : "upstream_error", message, {
    cause: error,
    details: {
      done: ["configuration"],
      configuration: { tunnel, ...step.written },
      remaining: { tool: step.tool, arguments: step.call },
    },
  })
}

/** The tunnel's CNAME as `cloudflare_dns_record_add` takes a new record. */
function cnameRecord({ tunnel, rule }: RuleChange) {
  return { type: "CNAME", name: rule.hostname, content: tunnelTarget(tunnel), proxied: true, comment: CNAME_COMMENT }
}

/** The arguments of a DNS tool call in `zone`, naming the account only when the call named one. */
function inZone({ account }: RuleChange, zone: Zone, rest: ErrorDetails): ErrorDetails {
  return { ...(account === undefined ? {} : { account }), zone: zone.name, ...rest }
}

async function postBatch(client: CloudflareClient, zone: Zone, body: object): Promise<Record<string, unknown>> {
  const { result } = await client.request<unknown>(ROUTES.dnsRecordsBatch, { path: { zone_id: zone.id }, body })
  if (!isPlainObject(result)) {
    throw new ToolError("upstream_error", "Cloudflare returned an unexpected DNS batch response.")
  }
  return result
}

/**
 * Adds the proxied CNAME from the hostname to the tunnel and returns the record Cloudflare created. It sends the
 * batch itself, since the batch tool's notes would say nothing was changed while the configuration already was.
 */
export async function addTunnelCname(client: CloudflareClient, zone: Zone, change: RuleChange): Promise<DnsRecord> {
  try {
    const { posts } = await postBatch(client, zone, { posts: [{ ...cnameRecord(change), ttl: AUTOMATIC_TTL }] })
    const created = Array.isArray(posts) ? posts[0] : undefined
    if (!isPlainObject(created)) {
      throw new ToolError("upstream_error", "Cloudflare returned an unexpected DNS batch response.")
    }
    return summary(shapeRecord(created))
  } catch (error) {
    const { rule } = change
    throw dnsStepFailure(error, change, {
      verb: "added",
      changed: `it now sends ${ruleLabel(rule)} to ${rule.service}`,
      consequence: "until it is, no visitor reaches the hostname",
      written: { rule: ruleDetails(rule) },
      tool: "cloudflare_dns_record_add",
      call: inZone(change, zone, { records: [cnameRecord(change)] }),
    })
  }
}

/**
 * Deletes the tunnel's CNAME `record` in one batch of its own, for the same reason `addTunnelCname` does. The
 * configuration no longer publishes the hostname, so a failure says how to delete the record.
 */
export async function deleteTunnelCname(
  client: CloudflareClient,
  zone: Zone,
  record: DnsRecord,
  change: RuleChange,
): Promise<void> {
  try {
    await postBatch(client, zone, { deletes: [{ id: record.id }] })
  } catch (error) {
    const { rule } = change
    throw dnsStepFailure(error, change, {
      verb: "deleted",
      changed: `it no longer publishes ${ruleLabel(rule)}`,
      consequence: "it still points the hostname at the tunnel, which answers with its catch-all",
      written: { removed: ruleDetails(rule) },
      tool: "cloudflare_dns_record_delete",
      call: inZone(change, zone, { ids: [record.id] }),
    })
  }
}
