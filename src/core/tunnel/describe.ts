import type { z } from "zod"
import type { CallFact, CallHeadline } from "../tool"
import type { accessCoverageSchema } from "./access"
import type { Configuration, TunnelIdentity } from "./route"
import { TUNNEL_WORDS } from "./words"

/** The words of each Access coverage, as the Access fact shows it. */
const ACCESS_TEXTS: Record<z.output<typeof accessCoverageSchema>["status"], string> = {
  covered: TUNNEL_WORDS.accessCovered,
  partial: TUNNEL_WORDS.accessPartial,
  none: TUNNEL_WORDS.accessNone,
  unknown: TUNNEL_WORDS.accessUnknown,
}

/** The headline of a route write: the hostname, and the tunnel by its name, else its id. */
export function routeHeadline(text: string, tunnel: TunnelIdentity, hostname: string): CallHeadline {
  return { text, values: { tunnel: tunnel.name ?? tunnel.id, hostname } }
}

/** The fact that says whether an Access application covers the hostname. */
export function accessFact(access: z.output<typeof accessCoverageSchema>): CallFact {
  return { label: TUNNEL_WORDS.access, value: { text: ACCESS_TEXTS[access.status] } }
}

/** The fact that shows the rule's path, none when the rule has none. */
export function pathFacts(path: string | undefined): CallFact[] {
  return path === undefined ? [] : [{ label: TUNNEL_WORDS.path, value: path }]
}

/** The pins of a route write: the configuration it sends back whole, version included, since the prompt shows only part of it. */
export function configurationPins({ version, config }: Configuration): Record<string, string> {
  return { configuration: JSON.stringify({ version, config }) }
}
