import { z } from "zod"
import { accountArg } from "../cloudflare/args"
import { cloudflareClient, type CloudflareDeps } from "../cloudflare/client"
import { isPlainObject } from "../cloudflare/reply"
import { ROUTES } from "../cloudflare/routes"
import { confirmWrite, defineTool, type ToolSpec } from "../tool"
import { resolveZone, zoneArg, zoneTargets } from "./lookup"

export const CACHE_PURGE_ALL_ID = "cloudflare_zone_cache_purge_all"

const input = z.object({
  account: accountArg,
  zone: zoneArg,
})

const output = z.object({
  label: z.string().describe("The account label."),
  zone: z.object({ id: z.string(), name: z.string() }).describe("The zone whose cache was purged."),
  purged: z.object({
    kind: z.literal("everything").describe("Indicates the entire cache was purged."),
    items: z.array(z.string()).describe("Empty for purge_all."),
  }),
  purge_id: z.string().nullable().describe("The Cloudflare purge identifier, if returned."),
})

export type ZoneCachePurgeAllSpec = ToolSpec<typeof input, typeof output>

/** Defines the `cloudflare_zone_cache_purge_all` tool spec with injected dependencies. */
export function defineZoneCachePurgeAll(deps?: CloudflareDeps): ZoneCachePurgeAllSpec {
  const spec: ZoneCachePurgeAllSpec = defineTool({
    id: CACHE_PURGE_ALL_ID,
    title: "Purge entire Cloudflare zone cache",
    description:
      "Purge the whole cache of a Cloudflare zone. Every next request goes to the origin at once, so the origin should be able to take it.",
    toolset: "zones",
    class: "administrative",
    input,
    output,
    targets: (args, ctx) => zoneTargets(args, ctx, deps),
    async execute(args, ctx) {
      const client = cloudflareClient(args.account, { ...deps, signal: ctx.signal })
      const zone = await resolveZone(client, args.zone)

      await confirmWrite(
        spec,
        ctx,
        `Purge the whole cache of zone ${zone.name} (${zone.id}) in the Cloudflare account ${client.label}: every next request goes to the origin.`,
      )

      const reply = await client.request<unknown>(ROUTES.cachePurge, {
        path: { zone_id: zone.id },
        body: { purge_everything: true },
      })

      const purgeId = isPlainObject(reply.result) && typeof reply.result.id === "string" ? reply.result.id : null

      return {
        label: client.label,
        zone: { id: zone.id, name: zone.name },
        purged: { kind: "everything", items: [] },
        purge_id: purgeId,
      }
    },
  })
  return spec
}

export const cloudflareZoneCachePurgeAll = defineZoneCachePurgeAll()
