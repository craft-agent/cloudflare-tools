import { cloudflareClient, type CloudflareClient, type CloudflareDeps } from "../cloudflare/client"
import { failureOfWrite, type WriteFailureNotes } from "../cloudflare/refusal"
import type { Route } from "../cloudflare/routes"
import { isToolError, ToolError } from "../errors"
import type { ToolContext } from "../tool"
import { resolveZone, type Zone } from "../zone/lookup"
import { withHint } from "./errors"
import { editHint, type Phase, type WritablePhase } from "./phases"
import { readEntrypoint } from "./read"
import { shapeEntrypoint, type Entrypoint } from "./shape"

/**
 * The client, the zone and the entry point of `args.phase` (null when the zone has none). An entry point without an
 * id is `upstream_error`, since no rule could be written to it.
 */
export async function openEntrypoint(
  args: { account?: string; zone: string; phase: Phase },
  ctx: ToolContext,
  deps?: CloudflareDeps,
): Promise<{ client: CloudflareClient; zone: Zone; entrypoint: Entrypoint | null }> {
  const client = cloudflareClient(args.account, { ...deps, signal: ctx.signal })
  const zone = await resolveZone(client, args.zone)
  const entrypoint = await readEntrypoint(client, zone.id, args.phase)
  if (entrypoint?.ruleset.id === "") {
    throw new ToolError("upstream_error", "Cloudflare returned an unexpected ruleset response.")
  }
  return { client, zone, entrypoint }
}

/** Sends one write and shapes the ruleset it returns. A refusal says nothing was changed; a failure that does not tell says the write may or may not have happened. */
export async function writeRuleset(
  client: CloudflareClient,
  route: Route,
  path: Record<string, string>,
  body: Record<string, unknown>,
  phase: WritablePhase,
  notes: WriteFailureNotes,
): Promise<Entrypoint> {
  try {
    const { result } = await client.request<unknown>(route, { path, body })
    return shapeEntrypoint(result)
  } catch (error) {
    throw failureOfWrite(isToolError(error) ? withHint(error, editHint(phase)) : error, notes)
  }
}
