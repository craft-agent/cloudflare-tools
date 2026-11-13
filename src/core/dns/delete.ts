import { z } from "zod"
import { accountArg } from "../cloudflare/args"
import type { CloudflareDeps } from "../cloudflare/client"
import { ToolError } from "../errors"
import { confirmWrite, defineTool, type CallDescription, type ToolContext, type ToolSpec } from "../tool"
import { zoneArg } from "../zone/lookup"
import { sendBatch } from "./batch"
import { recordCountFact, recordLine, recordValue, type RecordLike } from "./describe"
import { relativeName } from "./names"
import { assertWritableRecord, readRecords, recordIdArg, recordListItemSchema, type RecordListItem } from "./records"
import { resolveDnsTargets, resolveDnsZone } from "./targets"
import { assertDistinct, newRecordSchema, recordBody, recordNames } from "./values"
import { DNS_WORDS } from "./words"

const MAX_IDS = 20
const MAX_ADDS = 20
const MAX_SHOWN_LENGTH = 60

const input = z.object({
  account: accountArg,
  zone: zoneArg,
  ids: z
    .array(recordIdArg)
    .min(1)
    .max(MAX_IDS)
    .describe(
      `1 to ${MAX_IDS} ids of the records to delete (32 hex digits each; cloudflare_dns_read list shows them); all or none.`,
    ),
  add: z
    .array(newRecordSchema)
    .max(MAX_ADDS)
    .optional()
    .describe(
      `0 to ${MAX_ADDS} new records, in the form of cloudflare_dns_record_add: records added in the same batch, replacing the deleted ones: a type change or a swap is one call.`,
    ),
})

const output = z.object({
  label: z.string().describe("The account label."),
  zone: z.object({ id: z.string(), name: z.string() }).describe("The zone the records belonged to."),
  deleted: z
    .array(recordListItemSchema)
    .describe("The records as they were before the delete, in the order of `ids`; they no longer exist."),
  added: z
    .array(recordListItemSchema)
    .describe("The records Cloudflare created, with their ids; empty when `add` was left out."),
})

type Args = z.output<typeof input>
type DeleteSpec = ToolSpec<typeof input, typeof output>

function refuse(problem: string): never {
  throw new ToolError("invalid_argument", problem)
}

function assertDistinctIds(ids: string[]): void {
  const firstSeen = new Map<string, number>()
  for (const [index, rawId] of ids.entries()) {
    const id = rawId.toLowerCase()
    const earlier = firstSeen.get(id)
    if (earlier !== undefined) {
      refuse(`ids[${index}] repeats ids[${earlier}]: the record ${id} can be deleted once per call.`)
    }
    firstSeen.set(id, index)
  }
}

/** One line of the confirmation: `TYPE relative-name → value`, with the value on one line and clipped. */
function describeRecord(record: RecordLike, zoneName: string): string {
  const oneLine = recordValue(record).replace(/\s+/g, " ").trim()
  const shown = oneLine.length > MAX_SHOWN_LENGTH ? `${oneLine.slice(0, MAX_SHOWN_LENGTH)}…` : oneLine
  return `${record.type} ${relativeName(record.name, zoneName)} → ${shown}`
}

function confirmation(
  zone: { id: string; name: string },
  label: string,
  deleted: RecordListItem[],
  added: Record<string, unknown>[],
): string {
  const count = deleted.length
  const removing = deleted.map((record) => describeRecord(record, zone.name)).join(", ")
  const adding =
    added.length > 0
      ? `, and add ${added.length}: ${added.map((body) => describeRecord(body as RecordLike, zone.name)).join(", ")}`
      : ""
  return `Delete ${count} DNS record${count === 1 ? "" : "s"} of zone ${zone.name} (${zone.id}) in the Cloudflare account ${label}: ${removing}${adding}. A deleted record stops answering; resolvers may keep it for its TTL.`
}

/** What a call will send: the zone it resolved, the records to delete as they are now and the checked create body of each record to add. */
async function planDelete(args: Args, ctx: ToolContext, deps?: CloudflareDeps) {
  assertDistinctIds(args.ids)
  const { client, zone } = await resolveDnsZone(args, ctx, deps)
  const existing = await readRecords(client, zone, args.ids, "ids")
  existing.forEach(({ raw, record }, index) => assertWritableRecord(raw, record, zone.name, `ids[${index}]`))
  const deleted = existing.map(({ record }) => record)

  const posts = (args.add ?? []).map((record, index) => recordBody(record, zone.name, `add[${index}]`))
  assertDistinct(posts, zone.name, "add")
  return { client, zone, deleted, posts }
}

async function deleteRecords(spec: DeleteSpec, args: Args, ctx: ToolContext, deps?: CloudflareDeps) {
  const { client, zone, deleted, posts } = await planDelete(args, ctx, deps)

  await confirmWrite(spec, ctx, confirmation(zone, client.label, deleted, posts))

  const result = await sendBatch(client, zone.id, { deletes: args.ids.map((id) => ({ id: id.toLowerCase() })), posts })
  return { label: client.label, zone: { id: zone.id, name: zone.name }, deleted, added: result.posts }
}

/** The headline and facts of a delete: one record, several, or several replaced by the records to add. */
function deleteSummary(
  zoneName: string,
  deleted: RecordListItem[],
  added: unknown[],
): Pick<CallDescription, "headline" | "facts"> {
  if (added.length > 0) {
    return {
      headline: { text: DNS_WORDS.replaceMany, values: { zone: zoneName } },
      facts: [recordCountFact(DNS_WORDS.deletions, deleted.length), recordCountFact(DNS_WORDS.additions, added.length)],
    }
  }
  if (deleted.length === 1) {
    return { headline: { text: DNS_WORDS.deleteOne, values: { name: deleted[0]!.name } }, facts: [] }
  }
  return {
    headline: { text: DNS_WORDS.deleteMany, values: { zone: zoneName } },
    facts: [recordCountFact(DNS_WORDS.records, deleted.length)],
  }
}

async function describeDelete(args: Args, ctx: ToolContext, deps?: CloudflareDeps): Promise<CallDescription> {
  const { zone, deleted, posts } = await planDelete(args, ctx, deps)
  const lines = [
    ...deleted.map((record) => `- ${recordLine(record, zone.name)}`),
    ...posts.map((post) => `+ ${recordLine(post as RecordLike, zone.name)}`),
  ]
  return { ...deleteSummary(zone.name, deleted, posts), text: { label: DNS_WORDS.records, body: lines.join("\n") } }
}

/** What a call writes to: the full name of each deleted and each added record, as `<account_id>/zones/<zone_id>/dns_records/<name>`; `*` when that cannot be told. */
async function deleteTargets(args: Args, ctx: ToolContext, deps?: CloudflareDeps): Promise<string[]> {
  return resolveDnsTargets(
    args,
    ctx,
    async (client, zone) => {
      const existing = await readRecords(client, zone, args.ids, "ids")
      return [...existing.map(({ record }) => record.name.toLowerCase()), ...recordNames(args.add ?? [], zone.name)]
    },
    deps,
  )
}

/** Defines the `cloudflare_dns_record_delete` tool spec with injected dependencies. */
export function defineDnsRecordDelete(deps?: CloudflareDeps): DeleteSpec {
  const spec: DeleteSpec = defineTool({
    id: "cloudflare_dns_record_delete",
    title: "Delete Cloudflare DNS records",
    intent: "About to delete DNS records",
    description: [
      `Delete 1 to ${MAX_IDS} DNS records of a Cloudflare zone by id (cloudflare_dns_read list shows it) in one batch: all are deleted or none is, and the tool always asks first in attended runs.`,
      `add holds up to ${MAX_ADDS} records created in the same batch, in the form of cloudflare_dns_record_add and checked by its rules; Cloudflare runs the deletes first, so a replacement can take the deleted record's name.`,
      "A record's type cannot change in place: delete the old record and add the new one with the same name in one call; a swap works the same way.",
      "Records managed by another Cloudflare product (a Worker's custom domain, for one) are refused.",
      "A deleted record stops answering at once, though resolvers may keep it up to its TTL.",
      "The result lists the deleted records as they were, and the records added.",
      "If the batch fails without telling whether it was applied, read the records with cloudflare_dns_read before sending it again.",
      "Zones are looked up only in the account's own zones.",
    ].join(" "),
    toolset: "dns",
    class: "administrative",
    input,
    output,
    targets: (args, ctx) => deleteTargets(args, ctx, deps),
    describe: (args, ctx) => describeDelete(args, ctx, deps),
    execute: (args, ctx) => deleteRecords(spec, args, ctx, deps),
  })
  return spec
}

export const cloudflareDnsRecordDelete = defineDnsRecordDelete()
