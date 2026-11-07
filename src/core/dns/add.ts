import { z } from "zod"
import { accountArg } from "../cloudflare/args"
import { cloudflareClient, type CloudflareDeps } from "../cloudflare/client"
import { ToolError, isAbortError } from "../errors"
import { ANY_TARGET } from "../targets"
import { defineTool, type ToolContext, type ToolSpec } from "../tool"
import { resolveZone, zoneArg } from "../zone/lookup"
import { sendBatch } from "./batch"
import { recordLabel, recordName } from "./names"
import { recordListItemSchema } from "./records"
import { newRecordSchema, recordBody } from "./values"

const MAX_RECORDS = 20

const input = z.object({
  account: accountArg,
  zone: zoneArg,
  records: z
    .array(newRecordSchema)
    .min(1)
    .max(MAX_RECORDS)
    .describe(`1 to ${MAX_RECORDS} new records, added together: all or none.`),
})

const output = z.object({
  label: z.string().describe("The account label."),
  zone: z.object({ id: z.string(), name: z.string() }).describe("The zone the records were added to."),
  added: z.array(recordListItemSchema).describe("The records Cloudflare created, with their ids."),
})

type Args = z.output<typeof input>

function sortedJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(sortedJson).join(",")}]`
  if (typeof value !== "object" || value === null) return JSON.stringify(value)
  const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${sortedJson(item)}`).join(",")}}`
}

/** What makes two bodies the same record: type, full name, value, and the priority an MX value carries. */
function identityOf(body: Record<string, unknown>): string {
  return sortedJson([body.type, body.name, body.content ?? body.data, body.priority])
}

function assertDistinct(bodies: Record<string, unknown>[], zoneName: string): void {
  const firstSeen = new Map<string, number>()
  for (const [index, body] of bodies.entries()) {
    const identity = identityOf(body)
    const earlier = firstSeen.get(identity)
    if (earlier !== undefined) {
      throw new ToolError(
        "invalid_argument",
        `records[${index}] repeats records[${earlier}] ${recordLabel(String(body.type), String(body.name), zoneName)}: the same type, name and value cannot be added twice.`,
      )
    }
    firstSeen.set(identity, index)
  }
}

async function addRecords(args: Args, ctx: ToolContext, deps?: CloudflareDeps) {
  const client = cloudflareClient(args.account, { ...deps, signal: ctx.signal })
  const zone = await resolveZone(client, args.zone)
  const posts = args.records.map((record, index) => recordBody(record, zone.name, `records[${index}]`))
  assertDistinct(posts, zone.name)

  const result = await sendBatch(client, zone.id, { posts })
  return { label: client.label, zone: { id: zone.id, name: zone.name }, added: result.posts }
}

/** What a call writes to: each record name in the zone, as `<account_id>/zones/<zone_id>/dns_records/<name>`; `*` when that cannot be told. */
async function addTargets(args: Args, ctx: ToolContext, deps?: CloudflareDeps): Promise<string[]> {
  try {
    const client = cloudflareClient(args.account, { ...deps, signal: ctx.signal })
    const zone = await resolveZone(client, args.zone)
    const names = new Set(args.records.map((record) => recordName(record.name, zone.name)))
    return [...names].map((name) => `${client.accountId}/zones/${zone.id}/dns_records/${name}`)
  } catch (error) {
    if (isAbortError(error) || ctx.signal?.aborted) throw error
    return [ANY_TARGET]
  }
}

/** Defines the `cloudflare_dns_record_add` tool spec with injected dependencies. */
export function defineDnsRecordAdd(deps?: CloudflareDeps): ToolSpec<typeof input, typeof output> {
  return defineTool({
    id: "cloudflare_dns_record_add",
    title: "Add Cloudflare DNS records",
    description: [
      `Add 1 to ${MAX_RECORDS} DNS records to a Cloudflare zone in one batch: all are added or none is, and each record is checked before anything is sent.`,
      "Types: A and AAAA (content is an address), CNAME, MX (also needs priority) and NS (content is a hostname), TXT (content is one line of text);",
      "CAA (data: flags, tag, value) and SRV (data: priority, weight, port, target; the name looks like _sip._tcp) take data instead of content.",
      "ttl is 1 for automatic or 60–86400 seconds (default 1).",
      "proxied (A, AAAA, CNAME; default false) needs an automatic ttl.",
      "comment is one line of up to 500 characters.",
      "A record name may be relative to the zone ('www'), '@' for the apex, or a full name.",
      "If the batch fails without telling whether it was applied, read the records with cloudflare_dns_read before sending it again.",
      "An existing record is changed with cloudflare_dns_record_edit and removed with cloudflare_dns_record_delete.",
      "Zones are looked up only in the account's own zones.",
    ].join(" "),
    toolset: "dns",
    class: "add",
    input,
    output,
    targets: (args, ctx) => addTargets(args, ctx, deps),
    execute: (args, ctx) => addRecords(args, ctx, deps),
  })
}

export const cloudflareDnsRecordAdd = defineDnsRecordAdd()
