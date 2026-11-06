import { z } from "zod"
import { cloudflareClient, type CloudflareDeps } from "../cloudflare/client"
import { ROUTES } from "../cloudflare/routes"
import { type QueryValue } from "../cloudflare/url"
import { ToolError } from "../errors"
import type { ToolContext } from "../tool"

const DEFAULT_AUDIT_LIMIT = 25
const DEFAULT_AUDIT_DIRECTION = "desc"
export const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000

export const auditInputFields = {
  since: z
    .string()
    .optional()
    .describe("audit: start of the time window as an ISO 8601 date or date-time (default: 24 hours before until)."),
  until: z
    .string()
    .optional()
    .describe("audit: end of the time window as an ISO 8601 date or date-time (default: now)."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("audit: maximum number of audit log entries to return (1–100, default 25)."),
  cursor: z.string().optional().describe("audit: opaque pagination cursor for the next page of entries."),
  direction: z
    .enum(["asc", "desc"])
    .optional()
    .describe('audit: sort direction by timestamp ("asc" or "desc", default "desc").'),
  action_type: z
    .array(z.enum(["create", "delete", "view", "update"]))
    .nonempty()
    .optional()
    .describe("audit: filter by action type."),
  action_result: z
    .array(z.enum(["success", "failure"]))
    .nonempty()
    .optional()
    .describe("audit: filter by action result."),
  actor_type: z
    .array(z.enum(["account", "cloudflare_admin", "delegated_service", "system", "user"]))
    .nonempty()
    .optional()
    .describe("audit: filter by actor type."),
  actor_email: z.array(z.string()).nonempty().optional().describe("audit: filter by actor email addresses."),
  resource_type: z.array(z.string()).nonempty().optional().describe("audit: filter by resource types."),
  zone_name: z.array(z.string()).nonempty().optional().describe("audit: filter by zone names."),
}

export const AUDIT_PARAM_KEYS = Object.keys(auditInputFields) as readonly (keyof typeof auditInputFields)[]

const auditArgsSchema = z.object({
  account: z.string().optional(),
  ...auditInputFields,
})

export type AuditArgs = z.infer<typeof auditArgsSchema>

/** Parses an optional ISO date string, throwing invalid_argument if malformed. */
export function parseOptionalDate(value: string | undefined, name: string): Date | undefined {
  if (value === undefined) return undefined
  const ms = Date.parse(value)
  if (Number.isNaN(ms)) {
    throw new ToolError("invalid_argument", `Invalid date for \`${name}\`: "${value}".`)
  }
  return new Date(ms)
}

export type AuditOutput = {
  label: string
  since: string
  until: string
  entries: Record<string, unknown>[]
  cursor: string | null
}

/** Queries Cloudflare account audit logs within a time window. */
export async function readAudit(args: AuditArgs, ctx: ToolContext, deps?: CloudflareDeps): Promise<AuditOutput> {
  const untilDate = parseOptionalDate(args.until, "until") ?? new Date()
  const sinceDate = parseOptionalDate(args.since, "since") ?? new Date(untilDate.getTime() - TWENTY_FOUR_HOURS_MS)

  if (sinceDate.getTime() >= untilDate.getTime()) {
    throw new ToolError(
      "invalid_argument",
      `\`since\` (${sinceDate.toISOString()}) must be before \`until\` (${untilDate.toISOString()}).`,
    )
  }

  const sinceIso = sinceDate.toISOString()
  const untilIso = untilDate.toISOString()
  const limit = args.limit ?? DEFAULT_AUDIT_LIMIT
  const direction = args.direction ?? DEFAULT_AUDIT_DIRECTION

  const client = cloudflareClient(args.account, { ...deps, signal: ctx.signal })

  const query: Record<string, QueryValue> = {
    since: sinceIso,
    before: untilIso,
    limit,
    cursor: args.cursor,
    direction,
    action_type: args.action_type,
    action_result: args.action_result,
    actor_type: args.actor_type,
    actor_email: args.actor_email,
    resource_type: args.resource_type,
    zone_name: args.zone_name,
  }

  const reply = await client.request<unknown>(ROUTES.auditLogs, { query })

  if (!Array.isArray(reply.result)) {
    throw new ToolError("upstream_error", "Cloudflare answered audit logs with a result that is not an array.")
  }

  return {
    label: client.label,
    since: sinceIso,
    until: untilIso,
    entries: reply.result as Record<string, unknown>[],
    cursor: reply.resultInfo?.cursor ?? null,
  }
}
