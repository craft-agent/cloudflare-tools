/** One Ruleset Engine phase the rules tools reach, with the product it backs and the permission it needs. */
export type PhaseInfo = {
  readonly phase: string
  /** The dashboard product the phase backs. */
  readonly product: string
  /** Whether the write tools may change this phase's rules. */
  readonly writable: boolean
  /** The rule actions a write may set in this phase; empty for a read-only phase. */
  readonly actions: readonly string[]
  /** The Zone permission group that covers the phase. */
  readonly permission: string
}

/** The phases the rules tools reach, in the order they are listed. */
export const PHASES = [
  {
    phase: "http_request_dynamic_redirect",
    product: "Single Redirects",
    writable: true,
    actions: ["redirect"],
    permission: "Dynamic URL Redirects",
  },
  {
    phase: "http_request_cache_settings",
    product: "Cache Rules",
    writable: true,
    actions: ["set_cache_settings"],
    permission: "Cache Settings",
  },
  {
    phase: "http_config_settings",
    product: "Configuration Rules",
    writable: true,
    actions: ["set_config"],
    permission: "Config Settings",
  },
  {
    phase: "http_request_transform",
    product: "URL Rewrite Rules",
    writable: true,
    actions: ["rewrite"],
    permission: "Zone Transform Rules",
  },
  {
    phase: "http_request_late_transform",
    product: "Request Header Transform Rules",
    writable: true,
    actions: ["rewrite"],
    permission: "Zone Transform Rules",
  },
  {
    phase: "http_response_headers_transform",
    product: "Response Header Transform Rules",
    writable: true,
    actions: ["rewrite"],
    permission: "Zone Transform Rules",
  },
  {
    phase: "http_request_origin",
    product: "Origin Rules",
    writable: true,
    actions: ["route"],
    permission: "Origin",
  },
  {
    phase: "http_response_compression",
    product: "Compression Rules",
    writable: true,
    actions: ["compress_response"],
    permission: "Response Compression",
  },
  {
    phase: "http_request_firewall_custom",
    product: "WAF custom rules",
    writable: false,
    actions: [],
    permission: "Zone WAF",
  },
  {
    phase: "http_ratelimit",
    product: "Rate limiting rules",
    writable: false,
    actions: [],
    permission: "Zone WAF",
  },
  {
    phase: "http_custom_errors",
    product: "Custom Error Rules",
    writable: false,
    actions: [],
    permission: "Custom Errors",
  },
] as const satisfies readonly PhaseInfo[]

/** A phase name. */
export type Phase = (typeof PHASES)[number]["phase"]

/** Every phase name, in order, as a tuple `z.enum` takes. */
export const PHASE_NAMES = PHASES.map((entry) => entry.phase) as unknown as readonly [Phase, ...Phase[]]

/** The table row of a phase. */
export function phaseInfo(phase: Phase): (typeof PHASES)[number] {
  const found = PHASES.find((entry) => entry.phase === phase)
  if (!found) throw new Error(`Unknown phase ${phase}.`)
  return found
}

/** What to tell the caller when a read of the phase is forbidden. */
export function readHint(phase: Phase): string {
  return `The token needs Zone → ${phaseInfo(phase).permission} → Read.`
}

/** What to tell the caller when a change to the phase is forbidden. */
export function editHint(phase: Phase): string {
  return `The token needs Zone → ${phaseInfo(phase).permission} → Edit.`
}
