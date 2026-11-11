/** What makes this package itself; a project made from the starter sets these once (the setup script does). */
export const PROJECT = {
  /** The plugin, MCP server and program name. */
  name: "cloudflare-tools",
  /** The command line the Hermes plugin calls. */
  cli: "cloudflare-tools-cli",
  /** Every tool ID starts with `<toolPrefix>_`. */
  toolPrefix: "cloudflare",
  /** Every setting's environment variable is `<envPrefix>_<SETTING>`. */
  envPrefix: "CLOUDFLARE_TOOLS",
  /** The toolsets, in the order `all` lists them. */
  toolsets: [
    "account",
    "zones",
    "dns",
    "rules",
    "analytics",
    "workers",
    "pages",
    "storage",
    "tunnels",
    "email",
    "queues",
    "hyperdrive",
    "vectorize",
    "turnstile",
    "access",
    "registrar",
  ] as readonly string[],
  /** The toolsets on when a setting names none. */
  defaultToolsets: ["account", "zones", "dns", "workers", "pages"] as readonly string[],
  /** The environment variables the tools read besides the settings, which Codex forwards to the server after them. */
  toolVariables: [] as readonly string[],
} as const
