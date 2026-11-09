import { domainToASCII } from "node:url"
import { z } from "zod"
import { accountArg } from "../cloudflare/args"
import { cloudflareClient, type CloudflareDeps } from "../cloudflare/client"
import { isPlainObject } from "../cloudflare/reply"
import { ROUTES } from "../cloudflare/routes"
import { ToolError } from "../errors"
import { defineTool, type CallDescription, type ToolContext, type ToolSpec } from "../tool"
import { resolveZone, zoneArg, zoneTargets } from "./lookup"
import { ZONE_WORDS } from "./words"

export const CACHE_PURGE_ID = "cloudflare_zone_cache_purge"

const MAX_ITEMS = 100
const MIN_ITEMS = 1
const MAX_ITEM_LENGTH = 2048
const MAX_TAG_LENGTH = 1024
const MIN_TAG_LENGTH = 1
const WHITESPACE_OR_CONTROL = /[\s\x00-\x1f\x7f]/
const TAG_INVALID_CHARACTERS = /[\s,\x00-\x1f\x7f]/

const input = z.object({
  account: accountArg,
  zone: zoneArg,
  urls: z.array(z.string()).min(MIN_ITEMS).max(MAX_ITEMS).optional().describe("1–100 URLs to purge from the cache."),
  hosts: z
    .array(z.string())
    .min(MIN_ITEMS)
    .max(MAX_ITEMS)
    .optional()
    .describe("1–100 host names to purge from the cache."),
  prefixes: z
    .array(z.string())
    .min(MIN_ITEMS)
    .max(MAX_ITEMS)
    .optional()
    .describe("1–100 prefixes (host/path…) to purge from the cache."),
  tags: z
    .array(z.string())
    .min(MIN_ITEMS)
    .max(MAX_ITEMS)
    .optional()
    .describe("1–100 cache tags to purge from the cache."),
})

const output = z.object({
  label: z.string().describe("The account label."),
  zone: z.object({ id: z.string(), name: z.string() }).describe("The zone whose cache was purged."),
  purged: z.object({
    kind: z.enum(["urls", "hosts", "prefixes", "tags"]).describe("The kind of cache entries purged."),
    items: z.array(z.string()).describe("The normalized items that were purged."),
  }),
  purge_id: z.string().nullable().describe("The Cloudflare purge identifier, if returned."),
})

export type ZoneCachePurgeSpec = ToolSpec<typeof input, typeof output>

type PurgeKind = "urls" | "hosts" | "prefixes" | "tags"

function isInZone(host: string, zoneDomain: string): boolean {
  return host === zoneDomain || host.endsWith(`.${zoneDomain}`)
}

function selectKind(args: z.output<typeof input>): { kind: PurgeKind; items: string[] } {
  const forms: Array<{ kind: PurgeKind; items: string[] }> = []
  if (args.urls !== undefined) forms.push({ kind: "urls", items: args.urls })
  if (args.hosts !== undefined) forms.push({ kind: "hosts", items: args.hosts })
  if (args.prefixes !== undefined) forms.push({ kind: "prefixes", items: args.prefixes })
  if (args.tags !== undefined) forms.push({ kind: "tags", items: args.tags })

  if (forms.length !== 1) {
    throw new ToolError("invalid_argument", "exactly one of urls, hosts, prefixes or tags")
  }
  return forms[0]!
}

function normalizeUrl(item: string, index: number, zoneName: string): string {
  let parsed: URL
  try {
    parsed = new URL(item)
  } catch {
    throw new ToolError("invalid_argument", `urls[${index}]: invalid URL "${item}"`)
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ToolError("invalid_argument", `urls[${index}]: must have http:// or https:// scheme`)
  }
  const trimmedHost = parsed.hostname.endsWith(".") ? parsed.hostname.slice(0, -1) : parsed.hostname
  const host = domainToASCII(trimmedHost.toLowerCase())
  if (!host) {
    throw new ToolError("invalid_argument", `urls[${index}]: invalid host in URL "${item}"`)
  }
  if (!isInZone(host, zoneName)) {
    throw new ToolError("invalid_argument", `${host} is not in the zone ${zoneName}`)
  }
  const portPart = parsed.port ? `:${parsed.port}` : ""
  const pathPart = parsed.pathname || "/"
  const queryPart = parsed.search
  return `${parsed.protocol}//${host}${portPart}${pathPart}${queryPart}`
}

function normalizeHost(item: string, index: number, zoneName: string): string {
  if (item.includes("://") || item.includes("/")) {
    throw new ToolError("invalid_argument", `hosts[${index}]: invalid host name "${item}"`)
  }
  const trimmedHost = item.endsWith(".") ? item.slice(0, -1) : item
  const host = domainToASCII(trimmedHost.toLowerCase())
  if (!host) {
    throw new ToolError("invalid_argument", `hosts[${index}]: invalid host name "${item}"`)
  }
  if (!isInZone(host, zoneName)) {
    throw new ToolError("invalid_argument", `${host} is not in the zone ${zoneName}`)
  }
  return host
}

function normalizePrefix(item: string, index: number, zoneName: string): string {
  if (item.includes("://")) {
    throw new ToolError("invalid_argument", `prefixes[${index}]: prefix must not include a scheme ("://")`)
  }
  const slashIndex = item.indexOf("/")
  const rawHost = slashIndex === -1 ? item : item.slice(0, slashIndex)
  const pathPart = slashIndex === -1 ? "" : item.slice(slashIndex)
  if (!rawHost) {
    throw new ToolError("invalid_argument", `prefixes[${index}]: missing host in prefix "${item}"`)
  }
  const trimmedHost = rawHost.endsWith(".") ? rawHost.slice(0, -1) : rawHost
  const host = domainToASCII(trimmedHost.toLowerCase())
  if (!host) {
    throw new ToolError("invalid_argument", `prefixes[${index}]: invalid host in prefix "${item}"`)
  }
  if (!isInZone(host, zoneName)) {
    throw new ToolError("invalid_argument", `${host} is not in the zone ${zoneName}`)
  }
  return `${host}${pathPart}`
}

function validateAndNormalizeItems(kind: PurgeKind, items: string[], zoneName: string): string[] {
  const seenRaw = new Set<string>()
  const seenNormalized = new Set<string>()
  const normalizedItems: string[] = []

  for (const [index, item] of items.entries()) {
    const maxLen = kind === "tags" ? MAX_TAG_LENGTH : MAX_ITEM_LENGTH
    if (item.length > maxLen) {
      throw new ToolError("invalid_argument", `${kind}[${index}]: exceeds ${maxLen} characters`)
    }
    if (kind === "tags" && item.length === 0) {
      throw new ToolError(
        "invalid_argument",
        `${kind}[${index}]: tag must be ${MIN_TAG_LENGTH}–${MAX_TAG_LENGTH} characters`,
      )
    }

    if (kind === "tags") {
      if (TAG_INVALID_CHARACTERS.test(item)) {
        throw new ToolError("invalid_argument", `${kind}[${index}]: contains whitespace or comma`)
      }
    } else if (WHITESPACE_OR_CONTROL.test(item)) {
      throw new ToolError("invalid_argument", `${kind}[${index}]: contains whitespace or control characters`)
    }

    if (seenRaw.has(item)) {
      throw new ToolError("invalid_argument", `${kind}[${index}]: duplicate item`)
    }
    seenRaw.add(item)

    const normalized =
      kind === "urls"
        ? normalizeUrl(item, index, zoneName)
        : kind === "hosts"
          ? normalizeHost(item, index, zoneName)
          : kind === "prefixes"
            ? normalizePrefix(item, index, zoneName)
            : item

    if (seenNormalized.has(normalized)) {
      throw new ToolError("invalid_argument", `${kind}[${index}]: duplicate item`)
    }
    seenNormalized.add(normalized)
    normalizedItems.push(normalized)
  }

  return normalizedItems
}

/** What a cache purge call writes to: `<account_id>/zones/<zone_id>`; `*` when that cannot be told. */
export const cachePurgeTargets = zoneTargets

const KIND_WORDS: Record<PurgeKind, { headline: string; label: string }> = {
  urls: { headline: ZONE_WORDS.purgeUrls, label: ZONE_WORDS.urls },
  hosts: { headline: ZONE_WORDS.purgeHosts, label: ZONE_WORDS.hosts },
  prefixes: { headline: ZONE_WORDS.purgePrefixes, label: ZONE_WORDS.prefixes },
  tags: { headline: ZONE_WORDS.purgeTags, label: ZONE_WORDS.tags },
}

/** What a call will send: the kind of entry, the client, the zone it resolved and the checked, normalized items. */
async function planPurge(args: z.output<typeof input>, ctx: ToolContext, deps?: CloudflareDeps) {
  const { kind, items } = selectKind(args)
  const client = cloudflareClient(args.account, { ...deps, signal: ctx.signal })
  const zone = await resolveZone(client, args.zone)
  const normalizedItems = validateAndNormalizeItems(kind, items, zone.name)
  return { kind, client, zone, normalizedItems }
}

async function describePurge(
  args: z.output<typeof input>,
  ctx: ToolContext,
  deps?: CloudflareDeps,
): Promise<CallDescription> {
  const { kind, zone, normalizedItems } = await planPurge(args, ctx, deps)
  const words = KIND_WORDS[kind]
  return {
    headline: { text: words.headline, values: { zone: zone.name } },
    facts: [{ label: ZONE_WORDS.count, value: String(normalizedItems.length) }],
    text: { label: words.label, body: normalizedItems.join("\n") },
  }
}

/** Defines the `cloudflare_zone_cache_purge` tool spec with injected dependencies. */
export function defineZoneCachePurge(deps?: CloudflareDeps): ZoneCachePurgeSpec {
  return defineTool({
    id: CACHE_PURGE_ID,
    title: "Purge Cloudflare zone cache",
    intent: "About to purge cached content",
    description:
      "Purge cached copies of the given URLs, hosts, prefixes or tags in one zone, up to 100 at a time; nothing stored is deleted, the next requests fetch from the origin; for the whole cache use cloudflare_zone_cache_purge_all.",
    toolset: "zones",
    class: "idempotent",
    input,
    output,
    targets: (args, ctx) => zoneTargets(args, ctx, deps),
    describe: (args, ctx) => describePurge(args, ctx, deps),
    async execute(args, ctx) {
      const { kind, client, zone, normalizedItems } = await planPurge(args, ctx, deps)

      const body =
        kind === "urls"
          ? { files: normalizedItems }
          : kind === "hosts"
            ? { hosts: normalizedItems }
            : kind === "prefixes"
              ? { prefixes: normalizedItems }
              : { tags: normalizedItems }

      const reply = await client.request<unknown>(ROUTES.cachePurge, {
        path: { zone_id: zone.id },
        body,
      })

      const purgeId = isPlainObject(reply.result) && typeof reply.result.id === "string" ? reply.result.id : null

      return {
        label: client.label,
        zone: { id: zone.id, name: zone.name },
        purged: {
          kind,
          items: normalizedItems,
        },
        purge_id: purgeId,
      }
    },
  })
}

export const cloudflareZoneCachePurge = defineZoneCachePurge()
