import { z } from "zod"
import { accountArg } from "../cloudflare/args"
import { cloudflareClient, type CloudflareClient, type CloudflareDeps } from "../cloudflare/client"
import { refusedByCloudflare } from "../cloudflare/refusal"
import { isPlainObject } from "../cloudflare/reply"
import { ROUTES } from "../cloudflare/routes"
import { recordListItemSchema, shapeRecord } from "../dns/records"
import { targetHostname } from "../dns/names"
import { ToolError, isAbortError } from "../errors"
import { ANY_TARGET } from "../targets"
import { StepErrors, type ToolContext } from "../tool"
import { resolveZone } from "../zone/lookup"
import { projectArg, projectName } from "./projects"

/** How many records at one name `recordsAt` reads; a name holds a handful at most. */
const MAX_RECORDS = 100

/** The arguments of both domain tools. */
export const domainInput = z.object({
  account: accountArg,
  project: projectArg,
  name: z
    .string()
    .describe(
      "The custom domain's hostname, as in www.example.com: lowercased, with an internationalized name turned into punycode and a trailing dot dropped. No wildcard.",
    ),
})

export type DomainArgs = z.output<typeof domainInput>

const recordSchema = recordListItemSchema
  .pick({ id: true, type: true, name: true, content: true, proxied: true, read_only: true })
  .strict()

/** The DNS records at a hostname, in the zone that holds it, or null when the account has no such zone. */
export const dnsSchema = z
  .strictObject({
    zone: z.strictObject({
      id: z.string().describe("The zone id."),
      name: z.string().describe("The zone domain name."),
    }),
    records: z.array(recordSchema).describe("The records named exactly like the hostname."),
  })
  .nullable()

/** The failed steps of a call that already did its write, keyed by step. */
export const stepErrorsSchema = z
  .record(z.string(), z.string())
  .describe("The steps that failed after the write was done, keyed by step, as `code: message`; absent when none did.")

/** Common leading output fields of a domain write tool result. */
export const domainOutputBase = {
  label: z.string().describe("The account label."),
  project: z.string().describe("The Pages project's name."),
}

export type DnsRecords = z.infer<typeof dnsSchema>

/** The hostname `value` stands for: trimmed, lowercased, without a trailing dot, an IDN as punycode; no wildcard. */
export function domainName(value: string): string {
  const result = targetHostname(value)
  if (result.problem !== undefined) {
    throw new ToolError("invalid_argument", `\`name\` must be a hostname: ${result.problem}.`)
  }
  return result.host
}

/** `value` when it is an object, else `upstream_error` naming the `response` that was unexpected. */
export function requireObject(value: unknown, response: string): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new ToolError("upstream_error", `Cloudflare returned an unexpected Pages ${response} response.`)
  }
  return value
}

/**
 * The DNS records named exactly `hostname` in the zone `zoneId`, which must be in the client's account.
 * Null when `zoneId` is not a string: the zone is not on this account, or Cloudflare did not say.
 */
export async function recordsAt(client: CloudflareClient, zoneId: unknown, hostname: string): Promise<DnsRecords> {
  if (typeof zoneId !== "string") return null
  const zone = await resolveZone(client, zoneId)
  const reply = await client.request<unknown>(ROUTES.dnsRecords, {
    path: { zone_id: zone.id },
    query: { "name.exact": hostname, per_page: MAX_RECORDS },
  })
  if (!Array.isArray(reply.result)) {
    throw new ToolError("upstream_error", "Cloudflare returned an unexpected DNS records response.")
  }
  return {
    zone: { id: zone.id, name: zone.name },
    records: reply.result.map((raw) => {
      const { id, type, name, content, proxied, read_only } = shapeRecord(raw)
      return { id, type, name, content, proxied, read_only }
    }),
  }
}

/**
 * Reads the DNS records at `name` in `zoneTag` after a write, recording any failure under the `dns` step
 * so a failed DNS read never throws or hides the write that succeeded.
 */
export async function readDnsStep(
  client: CloudflareClient,
  zoneTag: unknown,
  name: string,
): Promise<{ dns: DnsRecords; errors?: Record<string, string> }> {
  const steps = new StepErrors()
  const dns = await steps.record("dns", () => recordsAt(client, zoneTag, name))
  return {
    dns: dns ?? null,
    ...(steps.any ? { errors: steps.errors } : {}),
  }
}

/** Message suffix when Cloudflare explicitly refused the write. */
function nothingDone(done: "added" | "removed"): string {
  return `Nothing was ${done}.`
}

/** Message suffix when the write outcome is uncertain. */
function maybeDone(done: "added" | "removed"): string {
  return `Cloudflare may or may not have ${done} it; read cloudflare_pages_read domains before sending it again.`
}

/**
 * The failure of the one write: Cloudflare's refusal means nothing was `done`; a failure that does not tell
 * (5xx, timeout, network) may or may not have done it. A cancellation passes untouched.
 */
export function failureOfWrite(error: unknown, done: "added" | "removed"): unknown {
  if (isAbortError(error) || !(error instanceof ToolError)) return error
  if (refusedByCloudflare(error)) {
    return new ToolError(error.code, `${error.message} ${nothingDone(done)}`, { cause: error })
  }
  if (error.code === "upstream_error") {
    return new ToolError("upstream_error", `${error.message} ${maybeDone(done)}`, { cause: error })
  }
  return error
}

/** What a domain call writes to: the domain in its project and account; `*` when that cannot be told. */
export function domainTargets(args: DomainArgs, ctx: ToolContext, deps?: CloudflareDeps): string[] {
  try {
    const client = cloudflareClient(args.account, { ...deps, signal: ctx.signal })
    return [`${client.accountId}/pages/projects/${projectName(args.project)}/domains/${domainName(args.name)}`]
  } catch (error) {
    if (isAbortError(error) || ctx.signal?.aborted) throw error
    return [ANY_TARGET]
  }
}
