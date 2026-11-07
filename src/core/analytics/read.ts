import { z } from "zod"
import { accountArg, assertAcceptedKeys } from "../cloudflare/args"
import { cloudflareClient, type CloudflareClient, type CloudflareDeps } from "../cloudflare/client"
import { sentence } from "../cloudflare/graphql"
import { isPlainObject } from "../cloudflare/reply"
import { isToolError, ToolError } from "../errors"
import { defineTool, type ToolContext, type ToolSpec } from "../tool"
import { resolveZone, zoneArg } from "../zone/lookup"
import { TRAFFIC_QUERY } from "./queries"
import { DAY_RANGE, dayRange, rangeBoundArg, TIME_RANGE } from "./range"
import { daySchema, shapeDay, totalsOf, totalsSchema } from "./shape"

const METHODS = ["traffic"] as const
type Method = (typeof METHODS)[number]

const ACCEPTED_KEYS: Record<Method, readonly string[]> = {
  traffic: ["account", "zone", "since", "until"],
}

const PERMISSION_HINT = "The token needs Zone → Analytics → Read."

const input = z.object({
  account: accountArg,
  method: z
    .enum(METHODS)
    .describe(
      'The report: "traffic" gives a zone\'s requests, bytes, cache, threats, page views and uniques per UTC day.',
    ),
  zone: zoneArg.optional().describe("The zone domain or 32-hex id. Required for every report."),
  since: rangeBoundArg
    .optional()
    .describe(
      `The first day or time of the range, UTC. traffic: a date, default ${DAY_RANGE.defaultDays - 1} days before until.`,
    ),
  until: rangeBoundArg
    .optional()
    .describe("The last day (included) or the end time (excluded) of the range, UTC; default now."),
})

const output = z.object({
  label: z.string().describe("The account label."),
  zone: z.string().describe("The zone's name."),
  since: z.string().describe("The first day of the range read."),
  until: z.string().describe("The last day of the range read."),
  days: z.array(daySchema).optional().describe("traffic: one entry per UTC day, oldest first."),
  totals: totalsSchema.optional().describe("traffic: the sums over the range, without uniques."),
})

type Args = z.output<typeof input>

/** Dependencies of the analytics tool: Cloudflare's, and the clock (default `new Date()`). */
export type AnalyticsDeps = CloudflareDeps & { now?: () => Date }

type Handler = (args: Args, ctx: ToolContext, deps: AnalyticsDeps) => Promise<z.input<typeof output>>

function requiredZone(args: Args): string {
  if (args.zone === undefined) {
    throw new ToolError("invalid_argument", `Method "${args.method}" requires \`zone\`.`)
  }
  return args.zone
}

function clientFor(args: Args, ctx: ToolContext, deps: AnalyticsDeps): CloudflareClient {
  const { now: _now, ...cloudflare } = deps
  return cloudflareClient(args.account, { ...cloudflare, signal: ctx.signal })
}

/** Runs an analytics query; a `forbidden` failure says which permission the token lacks. */
async function queryAnalytics(client: CloudflareClient, query: string, variables: Record<string, unknown>) {
  try {
    return await client.requestGraphql(query, variables)
  } catch (error) {
    if (isToolError(error) && error.code === "forbidden") {
      throw new ToolError("forbidden", `${sentence(error.message)} ${PERMISSION_HINT}`, { cause: error })
    }
    throw error
  }
}

function unexpectedResponse(): ToolError {
  return new ToolError("upstream_error", "Cloudflare returned an unexpected analytics response.")
}

/** The dataset `name` of the single zone in a query's data. */
function datasetOf(data: Record<string, unknown>, name: string): unknown[] {
  const viewer = isPlainObject(data.viewer) ? data.viewer : {}
  const zone = Array.isArray(viewer.zones) ? viewer.zones[0] : undefined
  const dataset = isPlainObject(zone) ? zone[name] : undefined
  if (!Array.isArray(dataset)) throw unexpectedResponse()
  return dataset
}

const traffic: Handler = async (args, ctx, deps) => {
  const ref = requiredZone(args)
  const client = clientFor(args, ctx, deps)
  const zone = await resolveZone(client, ref)
  const range = dayRange(args, (deps.now ?? (() => new Date()))())
  const data = await queryAnalytics(client, TRAFFIC_QUERY, { zoneTag: zone.id, ...range })
  const days = datasetOf(data, "httpRequests1dGroups").flatMap((entry) => {
    const day = shapeDay(entry)
    return day ? [day] : []
  })
  return { label: client.label, zone: zone.name, ...range, days, totals: totalsOf(days) }
}

const HANDLERS: Record<Method, Handler> = { traffic }

/** Defines the `cloudflare_analytics_read` tool spec with injected dependencies. */
export function defineAnalyticsRead(deps: AnalyticsDeps = {}): ToolSpec<typeof input, typeof output> {
  return defineTool({
    id: "cloudflare_analytics_read",
    title: "Read Cloudflare analytics",
    description: [
      "Read a zone's analytics: 'traffic' returns requests, bytes, cached requests and bytes, threats, page views and unique visitors for each UTC day, with totals over the range.",
      "`since` and `until` are UTC dates (2026-11-01) or UTC times (2026-11-01T09:00:00Z);",
      `traffic counts whole days: dates only, the last ${DAY_RANGE.defaultDays} days by default, at most ${DAY_RANGE.maxDays} days at once.`,
      `Reports by time read the last ${TIME_RANGE.defaultHours} hours by default and at most ${TIME_RANGE.maxDays} days.`,
      "Cloudflare limits how far back a plan may read; a refused range names that limit, so choose a shorter or more recent range.",
      "Unique visitors of different days cannot be added up.",
      "Needs the token permission Zone → Analytics → Read.",
    ].join(" "),
    toolset: "analytics",
    class: "read",
    input,
    output,
    async execute(args, ctx) {
      assertAcceptedKeys(ACCEPTED_KEYS, args.method, args)
      return HANDLERS[args.method](args, ctx, deps)
    },
  })
}

export const cloudflareAnalyticsRead = defineAnalyticsRead()
