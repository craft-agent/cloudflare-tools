import { z } from "zod"
import { accountArg } from "../cloudflare/args"
import type { CloudflareClient, CloudflareDeps } from "../cloudflare/client"
import { ToolError } from "../errors"
import { defineTool, type CallDescription, type ToolContext, type ToolSpec } from "../tool"
import { zoneArg, type Zone } from "../zone/lookup"
import { sendBatch } from "./batch"
import { EDITABLE_FIELDS, changedFields, currentForm, withChange } from "./current"
import { changeBlock, recordCountFact } from "./describe"
import { recordLabel, recordName } from "./names"
import {
  RECORD_TYPES,
  assertWritableRecord,
  readRecords,
  recordIdArg,
  recordListItemSchema,
  type FetchedRecord,
} from "./records"
import { resolveDnsTargets, resolveDnsZone } from "./targets"
import {
  AUTOMATIC_TTL,
  MAX_COMMENT_LENGTH,
  MAX_TTL,
  MIN_TTL,
  WRITABLE_TYPES,
  dataSchema,
  isOneOf,
  recordBody,
  type NewRecord,
} from "./values"
import { DNS_WORDS } from "./words"

const MAX_CHANGES = 20

const changeSchema = z
  .object({
    id: recordIdArg.describe("The id of the record to change (32 hex digits); cloudflare_dns_read list shows it."),
    type: z
      .enum(RECORD_TYPES)
      .optional()
      .describe(
        "The record's current type. Leave it out; if given it must match, since a record's type cannot change in place.",
      ),
    name: z
      .string()
      .optional()
      .describe(
        'The new record name: relative to the zone ("www", "_dmarc"), "@" for the apex, or full. Leave out to keep it.',
      ),
    content: z
      .string()
      .optional()
      .describe(
        "A, AAAA, CNAME, MX, TXT, NS: the new value (an IPv4 address, an IPv6 address, a hostname, or the text of a TXT record). Not allowed for CAA and SRV. Leave out to keep it.",
      ),
    data: dataSchema
      .optional()
      .describe(
        "CAA (flags, tag, value) and SRV (priority, weight, port, target): the new structured value, all its keys, replacing the old one. Not allowed for the other types. Leave out to keep it.",
      ),
    priority: z
      .number()
      .int()
      .optional()
      .describe(
        "MX only: the new preference, 0–65535 (lower is tried first); SRV takes its priority in `data`. Leave out to keep it.",
      ),
    ttl: z
      .number()
      .int()
      .optional()
      .describe(
        `The new seconds to live: ${AUTOMATIC_TTL} for automatic, or ${MIN_TTL}–${MAX_TTL}. Leave out to keep it.`,
      ),
    proxied: z
      .boolean()
      .optional()
      .describe(
        "A, AAAA, CNAME only: send traffic through Cloudflare (true) or not (false). A proxied record's TTL is automatic. Leave out to keep it.",
      ),
    comment: z
      .string()
      .optional()
      .describe(
        `The new one-line note on the record, up to ${MAX_COMMENT_LENGTH} characters; an empty string removes the comment. Leave out to keep it.`,
      ),
  })
  .strict()

const input = z.object({
  account: accountArg,
  zone: zoneArg,
  changes: z
    .array(changeSchema)
    .min(1)
    .max(MAX_CHANGES)
    .describe(`1 to ${MAX_CHANGES} records to change, each by id with only the fields to change; all or none.`),
})

const output = z.object({
  label: z.string().describe("The account label."),
  zone: z.object({ id: z.string(), name: z.string() }).describe("The zone the records belong to."),
  changed: z
    .array(
      z.object({
        id: z.string().describe("The record id."),
        before: recordListItemSchema.describe("The record as it was."),
        after: recordListItemSchema
          .nullable()
          .describe("The record as Cloudflare reports it now; null when the batch result did not include it."),
      }),
    )
    .describe("The records that changed, in the order of `changes`."),
})

type Args = z.output<typeof input>
type Change = Args["changes"][number]

function refuse(problem: string): never {
  throw new ToolError("invalid_argument", problem)
}

function assertWorkable(changes: Change[]): void {
  const firstSeen = new Map<string, number>()
  for (const [index, change] of changes.entries()) {
    if (!EDITABLE_FIELDS.some((field) => change[field] !== undefined)) {
      refuse(`changes[${index}]: changes nothing; give at least one field to change besides \`id\` and \`type\`.`)
    }
    const id = change.id.toLowerCase()
    const earlier = firstSeen.get(id)
    if (earlier !== undefined) {
      refuse(
        `changes[${index}] repeats changes[${earlier}]: the record ${id} can be changed once per call; put all its changes in one entry.`,
      )
    }
    firstSeen.set(id, index)
  }
}

/** One change ready to send: the batch patch and the form of the record it was laid over. */
type PlannedChange = { patch: Record<string, unknown>; before: NewRecord }

/** The batch patch for one change: `{ id, type }` and the fields that differ; refused when the change is not allowed or changes nothing. */
function patchFor(change: Change, index: number, current: FetchedRecord, zoneName: string): PlannedChange {
  const { record } = current
  const where = `changes[${index}]`
  const label = `${where} ${recordLabel(record.type, record.name, zoneName)}`
  assertWritableRecord(current.raw, record, zoneName, where)
  if (!isOneOf(WRITABLE_TYPES, record.type)) {
    refuse(`${label}: a ${record.type} record can be read and deleted with these tools, not changed.`)
  }
  if (change.type !== undefined && change.type !== record.type) {
    refuse(
      `${label}: a record's type cannot change in place (it is ${record.type}, not ${change.type}); use cloudflare_dns_record_delete with the replacement in its \`add\`.`,
    )
  }

  const before = currentForm(record, record.type)
  const body = recordBody(withChange(before, change), zoneName, where)
  const fields = changedFields(before, body)
  if (Object.keys(fields).length === 0) refuse(`${label}: changes nothing: the record already has these values.`)
  return { patch: { id: change.id.toLowerCase(), type: record.type, ...fields }, before }
}

/** What a call will send: the zone it resolved, the records as they are now and the checked change of each, in argument order. */
async function planEdit(args: Args, ctx: ToolContext, deps?: CloudflareDeps) {
  assertWorkable(args.changes)
  const { client, zone } = await resolveDnsZone(args, ctx, deps)
  const currents = await readRecords(
    client,
    zone,
    args.changes.map((change) => change.id),
    "changes",
  )
  const planned = args.changes.map((change, index) => patchFor(change, index, currents[index]!, zone.name))
  return { client, zone, currents, planned }
}

async function editRecords(args: Args, ctx: ToolContext, deps?: CloudflareDeps) {
  const { client, zone, currents, planned } = await planEdit(args, ctx, deps)

  const result = await sendBatch(client, zone.id, { patches: planned.map(({ patch }) => patch) })
  return {
    label: client.label,
    zone: { id: zone.id, name: zone.name },
    changed: currents.map(({ record }) => ({
      id: record.id,
      before: record,
      after: result.patches.find((patched) => patched.id.toLowerCase() === record.id.toLowerCase()) ?? null,
    })),
  }
}

async function describeEdit(args: Args, ctx: ToolContext, deps?: CloudflareDeps): Promise<CallDescription> {
  const { zone, currents, planned } = await planEdit(args, ctx, deps)
  const blocks = planned.map(({ patch, before }, index) =>
    changeBlock(currents[index]!.record, before, patch, zone.name),
  )
  const text = { label: DNS_WORDS.changes, body: blocks.join("\n") }
  if (currents.length === 1) {
    return { headline: { text: DNS_WORDS.changeOne, values: { name: currents[0]!.record.name } }, facts: [], text }
  }
  return {
    headline: { text: DNS_WORDS.changeMany, values: { zone: zone.name } },
    facts: [recordCountFact(DNS_WORDS.records, currents.length)],
    text,
  }
}

/** What a call writes to: each record's current name, and the new one when it is renamed, as `<account_id>/zones/<zone_id>/dns_records/<name>`; `*` when that cannot be told. */
async function editTargets(args: Args, ctx: ToolContext, deps?: CloudflareDeps): Promise<string[]> {
  return resolveDnsTargets(
    args,
    ctx,
    async (client, zone) => {
      const currents = await readRecords(
        client,
        zone,
        args.changes.map((change) => change.id),
        "changes",
      )
      return args.changes.flatMap((change, index) => [
        currents[index]!.record.name.toLowerCase(),
        ...(change.name !== undefined ? [recordName(change.name, zone.name)] : []),
      ])
    },
    deps,
  )
}

/** Defines the `cloudflare_dns_record_edit` tool spec with injected dependencies. */
export function defineDnsRecordEdit(deps?: CloudflareDeps): ToolSpec<typeof input, typeof output> {
  return defineTool({
    id: "cloudflare_dns_record_edit",
    title: "Change Cloudflare DNS records",
    intent: "About to change DNS records",
    description: [
      `Change 1 to ${MAX_CHANGES} existing DNS records of a Cloudflare zone in one batch: all are changed or none is, and each change is checked against the record's current values before anything is sent.`,
      "Each change names a record by id (cloudflare_dns_read list shows it) and gives only the fields to change; fields left out keep their value, and an empty comment removes the comment.",
      "A record's type cannot change in place: use cloudflare_dns_record_delete with the replacement in its add.",
      "Records managed by another Cloudflare product (a Worker's custom domain, for one) are refused, and so are changes that change nothing.",
      "The values follow the rules of cloudflare_dns_record_add, applied to the record as it would be after the change; for example a proxied record needs an automatic ttl.",
      "The result lists each record before and after.",
      "If the batch fails without telling whether it was applied, read the records with cloudflare_dns_read before sending it again.",
      "Zones are looked up only in the account's own zones.",
    ].join(" "),
    toolset: "dns",
    class: "overwrite",
    input,
    output,
    targets: (args, ctx) => editTargets(args, ctx, deps),
    describe: (args, ctx) => describeEdit(args, ctx, deps),
    execute: (args, ctx) => editRecords(args, ctx, deps),
  })
}

export const cloudflareDnsRecordEdit = defineDnsRecordEdit()
