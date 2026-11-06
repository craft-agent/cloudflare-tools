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
  toolsets: [] as readonly string[],
  /** The toolsets on when a setting names none. */
  defaultToolsets: [] as readonly string[],
} as const
