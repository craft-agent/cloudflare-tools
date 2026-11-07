# cloudflare-tools

Cloudflare tools for coding agents: zones, DNS, analytics, Workers, Pages, storage and tunnels.

| Harness        | Delivery                                       | Pinned by                      |
| -------------- | ---------------------------------------------- | ------------------------------ |
| OpenCode V2    | native plugin (npm package, with skills)       | the version in the package     |
| OpenCode V1    | native plugin (npm package, no skills)         | the version in the package     |
| Claude Code    | plugin: MCP server and skills                  | the release tag, as the ref    |
| Codex          | plugin: MCP server and skills                  | the release tag, as the ref    |
| Grok Build     | plugin: MCP server and skills                  | the release tag, as `@ref`     |
| Antigravity    | plugin: MCP server and skills                  | the release tag's tree URL     |
| Hermes Agent   | native plugin (Python, calls the command line) | the release commit, as the SHA |
| other MCP host | MCP server from npm                            | the version in the package     |

The tools need [Node.js](https://nodejs.org/) 24 or later.
[`docs/conventions.md`](docs/conventions.md) describes how the tools are named
and how they behave.

## Install

Install from a release, never from the default branch: a release is a tag whose
commit carries the built `dist/`, and the default branch does not. In the
commands below, `<version>` is a release's version (`1.2.3`) and `<sha>` is the
commit its tag names:

```sh
gh api repos/craft-agent/cloudflare-tools/commits/v<version> --jq .sha
```

### OpenCode

OpenCode V2 takes the package and its options in `opencode.json`:

```json
{
  "plugins": [{ "package": "@craftsamo/cloudflare-tools@<version>", "options": { "read_only": false } }],
  "permissions": [{ "action": "cloudflare_*", "resource": "*", "effect": "ask" }]
}
```

OpenCode V1 takes the package as a string, or as a pair with its options:

```json
{
  "plugin": [["@craftsamo/cloudflare-tools@<version>", { "read_only": false }]],
  "permission": { "cloudflare_*": "ask" }
}
```

OpenCode allows any action no rule names, so the plugin's request is granted
silently unless a rule says `ask`. Read tools never ask, so the `cloudflare_*` glob
is safe.

V1 registers no skills. Unpack the package and copy its `skills/*` folders into
`~/.config/opencode/skills/`:

```sh
npm pack @craftsamo/cloudflare-tools@<version>
tar -xzf craftsamo-cloudflare-tools-<version>.tgz
mkdir -p ~/.config/opencode/skills
cp -r package/skills/* ~/.config/opencode/skills/
rm -rf package craftsamo-cloudflare-tools-<version>.tgz
```

### Claude Code

```sh
claude plugin marketplace add craft-agent/cloudflare-tools#v<version>
claude plugin install cloudflare-tools@craft-agent
```

### Codex

```sh
codex plugin marketplace add craft-agent/cloudflare-tools --ref v<version>
codex plugin add cloudflare-tools@craft-agent
```

Codex turns `-` into `_` in server names, so it shows the tools as
`mcp__cloudflare_tools__cloudflare_*`. It starts the MCP server in the plugin's
install directory, which is never the caller's working tree.

### Grok Build

```sh
grok plugin install craft-agent/cloudflare-tools@v<version> --trust
```

Grok starts the MCP server in the session's working directory.

### Antigravity

Install from the tree of the release tag, never from the default branch, which
has no built `dist/`; Antigravity clones the tag into
`~/.gemini/config/plugins/cloudflare-tools`.

```sh
agy plugin install https://github.com/craft-agent/cloudflare-tools/tree/v<version>
```

### Hermes Agent

Hermes installs a commit, not a tag, and the plugin installs disabled:

```sh
hermes plugins install craft-agent/cloudflare-tools --ref <sha>
hermes plugins enable cloudflare-tools
```

If a Hermes gateway is already running, restart it (`hermes gateway restart`) to
load the plugin.

### Any other MCP host

Add the server to the host's MCP configuration. Flags go in `args`:

```json
{
  "mcpServers": {
    "cloudflare-tools": {
      "command": "npx",
      "args": ["-y", "@craftsamo/cloudflare-tools@<version>", "--read-only"]
    }
  }
}
```

## Tools and skills

Each toolset comes with a skill that tells an agent how to use its tools.

### Account (`account`)

Account credentials, token verification, and audit logs.

| Tool                      | What it does                                                                               | Class |
| ------------------------- | ------------------------------------------------------------------------------------------ | ----- |
| `cloudflare_account_read` | `view` account details and token status, `list` configured accounts, or query `audit` logs | read  |

The skill is [`cloudflare-account`](skills/cloudflare-account/SKILL.md), shown as
`cloudflare-tools:cloudflare-account` in Claude Code and
`cloudflare-tools:account` in Hermes.

### Zones (`zones`)

Zone lookup, settings (read and change), Universal SSL, certificates, and DNSSEC.

| Tool                              | What it does                                                                       | Class          |
| --------------------------------- | ---------------------------------------------------------------------------------- | -------------- |
| `cloudflare_zone_read`            | `list` zones, `view` details, read `settings`, Universal `ssl` status, or `dnssec` | read           |
| `cloudflare_zone_setting_edit`    | change 1–20 zone settings in order; refuses a change that lowers protection        | overwrite      |
| `cloudflare_zone_setting_weaken`  | change zone settings in ways that lower a visitor's protection; always asks first  | administrative |
| `cloudflare_zone_cache_purge`     | purge cached copies of up to 100 URLs, hosts, prefixes or tags in a zone           | idempotent     |
| `cloudflare_zone_cache_purge_all` | purge the whole cache of a zone; always asks first                                 | administrative |
| `cloudflare_zone_dnssec_enable`   | turn DNSSEC on for a zone; harmless until registrar publishes the DS record        | idempotent     |
| `cloudflare_zone_dnssec_disable`  | turn DNSSEC off for a zone; requires DS removed at registrar first                 | administrative |

The skill is [`cloudflare-zones`](skills/cloudflare-zones/SKILL.md), shown as
`cloudflare-tools:cloudflare-zones` in Claude Code and
`cloudflare-tools:zones` in Hermes.

### DNS (`dns`)

DNS records: list, read one in full, export the zone file, add records, change them, and delete them.

| Tool                           | What it does                                                                      | Class          |
| ------------------------------ | --------------------------------------------------------------------------------- | -------------- |
| `cloudflare_dns_read`          | `list` records, `view` one in full, or `export` the zone file in BIND form        | read           |
| `cloudflare_dns_record_add`    | add 1–20 records of eight types in one all-or-nothing batch                       | add            |
| `cloudflare_dns_record_edit`   | change 1–20 records by id in one all-or-nothing batch; never a record's type      | overwrite      |
| `cloudflare_dns_record_delete` | delete 1–20 records by id, with replacements in the same batch; always asks first | administrative |

The skill is [`cloudflare-dns`](skills/cloudflare-dns/SKILL.md), shown as
`cloudflare-tools:cloudflare-dns` in Claude Code and
`cloudflare-tools:dns` in Hermes.

### Analytics (`analytics`)

Analytics: read a zone's traffic per day (requests, bandwidth, cache hits, threats, page views and unique visitors), the most requested paths, client countries and response statuses, what the security features did (not on the Free plan) and the latest security events, and the account's Workers invocations, errors and CPU time, over a recent time range. This toolset is off by default; turn it on with the `toolsets` setting (see [Settings](#settings)).

| Tool                        | What it does                                                                                                    | Class |
| --------------------------- | --------------------------------------------------------------------------------------------------------------- | ----- |
| `cloudflare_analytics_read` | `traffic` per UTC day; the top `paths`, `countries` and `statuses`; `security` and `security_events`; `workers` | read  |

The token needs Zone → Analytics → Read, and Zone Read to look the zone up; `workers` needs Account → Account Analytics → Read instead.

The skill is [`cloudflare-analytics`](skills/cloudflare-analytics/SKILL.md), shown as
`cloudflare-tools:cloudflare-analytics` in Claude Code and
`cloudflare-tools:analytics` in Hermes.

### Workers (`workers`)

Workers: list them, read one's settings and bindings, deployments and versions, a zone's Worker routes, custom domains, cron triggers and secret names and types, and roll a Worker back to versions that served before. Building, uploading and deploying new code stay with Wrangler; routes, custom domains and cron triggers are read here and changed in `wrangler.toml`.

| Tool                          | What it does                                                                                        | Class          |
| ----------------------------- | --------------------------------------------------------------------------------------------------- | -------------- |
| `cloudflare_workers_read`     | `list`, `view`, `deployments`, `versions`, `routes`, `domains`, `schedules`, `secrets` (names only) | read           |
| `cloudflare_workers_rollback` | roll a Worker back to versions that served before; always asks first                                | administrative |

The token needs Workers Scripts Read; `routes` also needs Workers Routes Read; `routes`, and `domains` with `zone`, need Zone Read to look the zone up. The rollback needs Workers Scripts Write.

The skill is [`cloudflare-workers`](skills/cloudflare-workers/SKILL.md), shown as
`cloudflare-tools:cloudflare-workers` in Claude Code and
`cloudflare-tools:workers` in Hermes.

### Pages (`pages`)

Pages: list projects, read their build settings, environment variable names and bindings, production and preview deployments, including which one is live, a build's logs, and custom domains; switch a project's production back or forward to a deployment that built successfully; and add or remove its custom domains. Building and deploying new code stay with Git and Wrangler; the DNS records of a custom domain stay with the DNS tools.

| Tool                             | What it does                                                                       | Class          |
| -------------------------------- | ---------------------------------------------------------------------------------- | -------------- |
| `cloudflare_pages_read`          | `list` projects, `view` one, its `deployments`, a build's `logs`, custom `domains` | read           |
| `cloudflare_pages_rollback`      | switch production to a deployment that built successfully; always asks first       | administrative |
| `cloudflare_pages_domain_add`    | add a custom domain to a project, creating no DNS record; always asks first        | administrative |
| `cloudflare_pages_domain_remove` | remove a custom domain from a project, deleting no DNS record; always asks first   | administrative |

The token needs the Pages Read permission. The writes need Pages Write, and the DNS lookups of the domain tools need Zone Read and DNS Read.

The skill is [`cloudflare-pages`](skills/cloudflare-pages/SKILL.md), shown as
`cloudflare-tools:cloudflare-pages` in Claude Code and
`cloudflare-tools:pages` in Hermes.

### Storage (`storage`)

Storage: list an account's R2 buckets and a bucket's objects and folders by name, size and date, and read whether a bucket is public (its r2.dev domain and custom domains), its CORS rules and the lifecycle rules that delete its objects. An object's body and custom metadata are never read, and only buckets in the default jurisdiction are listed. This toolset is off by default; turn it on with the `toolsets` setting (see [Settings](#settings)).

| Tool                      | What it does                                                           | Class |
| ------------------------- | ---------------------------------------------------------------------- | ----- |
| `cloudflare_storage_read` | `buckets` of the account; one `bucket`'s details; a bucket's `objects` | read  |

The token needs Account → Workers R2 Storage → Read.

The skill is [`cloudflare-storage`](skills/cloudflare-storage/SKILL.md), shown as
`cloudflare-tools:cloudflare-storage` in Claude Code and
`cloudflare-tools:storage` in Hermes.

## Adding a tool

1. Write the spec in `src/core/<domain>/<verb>.ts` with `defineTool`: an ID
   `<prefix>_<domain>_<verb>`, a title and description, the Zod argument and
   output schemas, its toolset and write class, and `execute(args, context)`.
   A write tool also gives `targets(args, context)`: what the call writes to,
   as a permission rule should name it.
2. Test it beside the spec (`<verb>.test.ts`), calling it through `invoke` as
   the entry points do. A tool that runs a program is tested against a fake of
   that program on `PATH`; no test reaches a real service.
3. List it in `src/tools.ts`. A new toolset goes into `toolsets` in
   `src/project.ts` (and `defaultToolsets` when it is on by default).
4. Add or update the toolset's skill, `skills/<prefix>-<toolset>/SKILL.md`.
5. Run `pnpm run build && pnpm run manifests` to list the tool in
   `plugin.yaml`, then describe it under "Tools and skills".

[`docs/conventions.md`](docs/conventions.md) has the rules each step follows.

## Reads and writes

Every read tool is named `<prefix>_<domain>_read`. Reads can run unasked;
writes are confirmed by the harness.

| Harness     | Reads without asking                                                                                                 |
| ----------- | -------------------------------------------------------------------------------------------------------------------- |
| OpenCode    | always; the plugin asks only before a write                                                                          |
| Claude Code | the rule `mcp__plugin_cloudflare-tools_cloudflare-tools__*_read` in `permissions.allow` of `~/.claude/settings.json` |
| Codex       | always; Codex runs tools that declare `readOnlyHint` unasked, as the read tools do                                   |
| Grok Build  | `grok --allow 'MCPTool(cloudflare-tools__*_read)' --allow 'MCPTool(cloudflare_*_read)'` (both rules; see below)      |
| Antigravity | the rule `mcp(cloudflare-tools_cloudflare-tools/<tool id>)` in `permissions.allow`, one for each read tool           |
| Hermes      | always; the plugin asks only before a write                                                                          |

Where a write is asked about, and where it is not:

- **OpenCode** grants any action no rule names, so a write runs unasked unless
  a rule asks for it: add the `cloudflare_*` rule shown under [OpenCode](#opencode).
- **Codex** under `codex exec`, and **Grok Build** under `grok -p`, refuse a
  write they cannot ask about, unless it is allowed beforehand.
- **Grok Build** calls the plugin's tools through its `use_tool` tool, and the
  agent often names a tool without its server first. Grok checks the rules
  against the name as given, so the server-qualified rule alone does not match
  that first call. The second rule matches the short name; a write still
  matches neither.
- **Antigravity** asks before any MCP tool no rule allows, reads included, and
  names the plugin's server `cloudflare-tools_cloudflare-tools` (plugin,
  then server). `agy -p` refuses a tool it cannot ask about.
- **Hermes** `hermes chat -q` refuses a write it cannot ask about; `hermes -z`
  and `--yolo` skip approval, so writes then run unasked.

## Settings

Every entry point takes the same settings. A flag wins over its environment
variable, and an option or setting wins over the variable too.

| Setting         | Flag              | Variable                         | Meaning                                                                       |
| --------------- | ----------------- | -------------------------------- | ----------------------------------------------------------------------------- |
| `toolsets`      | `--toolsets`      | `CLOUDFLARE_TOOLS_TOOLSETS`      | the toolsets that are on, or `all`; default those `src/project.ts` names      |
| `read_only`     | `--read-only`     | `CLOUDFLARE_TOOLS_READ_ONLY`     | registers no tool that writes; wins over every other setting                  |
| `tools`         | `--tools`         | `CLOUDFLARE_TOOLS_TOOLS`         | single tools to add by ID, whatever their toolset                             |
| `exclude_tools` | `--exclude-tools` | `CLOUDFLARE_TOOLS_EXCLUDE_TOOLS` | single tools to remove by ID; wins over `tools` and `toolsets`                |
| `confirm`       | `--confirm`       | `CLOUDFLARE_TOOLS_CONFIRM`       | MCP server only: `harness` (default) or `elicitation`, as the conventions say |

Lists are comma-separated in a flag or a variable. Where each harness reads them:

- **OpenCode** takes the plugin `options` shown above, with lists as arrays and
  `read_only` as a boolean, and falls back to the variables.
- **Hermes** takes `plugins.entries.cloudflare-tools.settings` in
  `config.yaml`:

  ```yaml
  plugins:
    entries:
      cloudflare-tools:
        settings:
          read_only: false
          exclude_tools: []
  ```

- **Claude Code, Grok Build and Antigravity** start the plugin's server without
  flags and pass it the client's environment, so set the variables in the
  environment the harness runs in.
- **Codex** passes a plugin's MCP server only a few basic variables (such as
  `PATH` and `HOME`) and those the plugin's manifest names, which are the
  variables above: set them in the environment Codex runs in. To pass flags,
  add the server under `[mcp_servers]` in Codex's `config.toml` instead, with
  flags in `args` and the variables to forward in `env_vars`, as
  [Credentials](#credentials) shows.

Where each harness takes the variables from, and when one needs a restart to
see a change, is under [Credentials](#credentials).

### Credentials

The tools call Cloudflare with API tokens read from the environment, never
from a setting or an argument. Each token comes with the id of the one
account it acts on:

| Variables                                                       | Picked by                                    |
| --------------------------------------------------------------- | -------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`                 | `account` left out, or `account: "default"`  |
| `CLOUDFLARE_API_TOKEN_<LABEL>`, `CLOUDFLARE_ACCOUNT_ID_<LABEL>` | `account: "<label>"`, the label in lowercase |

- The unlabeled pair has the names Wrangler reads. A label is 1 to 24
  lowercase letters, digits and `_`, written in capitals in its variables
  (`my_site` → `CLOUDFLARE_API_TOKEN_MY_SITE`).
- With `account` left out, a call takes the unlabeled pair, or the only label
  when there is no unlabeled pair; with several labels and no unlabeled pair
  it fails and lists them.
- A `CLOUDFLARE_API_TOKEN` set without `CLOUDFLARE_ACCOUNT_ID`, as one exported
  for Wrangler may be, is still the unlabeled pair: a call that leaves
  `account` out fails, even when a complete labeled pair is set. Pass
  `account`, or unset the stray token.
- Use an API token scoped to what the tools should do; a Global API Key is
  refused.

Set the variables where each harness starts the tools:

- **OpenCode V2** runs the plugin in its background service, which keeps the
  environment it started with: set them where the service starts, and restart
  it (`opencode service restart`) after setting or changing one. **OpenCode
  V1** runs the plugin in its own process, so the environment it runs in is
  enough.
- **Claude Code, Antigravity and Grok Build** pass the plugin's server the
  environment the harness runs in.
- **Hermes** passes the environment it runs in, but a gateway already running
  keeps the one it started with: restart it (`hermes gateway restart`) after
  setting or changing one.
- **Codex** passes a plugin's server only a few basic variables (such as
  `PATH` and `HOME`) and the settings' variables its manifest names, never the
  credentials. Add a server of the same name to `~/.codex/config.toml`, which
  takes the plugin server's place (the plugin's skills stay), and name the
  variables to forward in `env_vars`. `startup_timeout_sec` gives `npx` time
  to fetch the package on the first start:

  ```toml
  [mcp_servers.cloudflare-tools]
  command = "npx"
  args = ["-y", "@craftsamo/cloudflare-tools@<version>"]
  env_vars = ["CLOUDFLARE_API_TOKEN_<LABEL>", "CLOUDFLARE_ACCOUNT_ID_<LABEL>"]
  startup_timeout_sec = 120
  ```

- **Any other MCP host** takes them in the `env` of its server entry.

## Layout

- `src/project.ts` — the package's name, tool ID prefix, setting prefix and
  toolsets.
- `src/core/` — the tool contract and the tools, free of any harness and of
  the project's names.
- `src/tools.ts` — the list of every tool, which each entry point registers.
- `src/mcp/` — the MCP server, built to `dist/mcp.js` and run by
  `cloudflare-tools`.
- `src/opencode/` — the OpenCode plugin, built to `dist/opencode.js`.
- `src/cli/` — the command line the Hermes plugin calls, built to `dist/cli.js`
  and run by `cloudflare-tools-cli`.
- `src/hermes/`, `plugin.yaml` and `__init__.py` — the Hermes plugin.
- `skills/` — one skill per toolset, `skills/<name>/SKILL.md`, which every
  harness that takes skills loads from the package or plugin root.
- `.claude-plugin/`, `.codex-plugin/`, `.agents/plugins/`, `.mcp.json`,
  `.antigravity-plugin/` and `mcp_config.json` — the plugin manifests of the
  other harnesses. Codex reads `.codex-plugin/plugin.json`; a root
  `plugin.json` would make it load the plugin as an Agent Plugin, whose tool
  budget hides tools past a fixed size. The root `.mcp.json` is the
  configuration Grok Build reads (with `${CLAUDE_PLUGIN_ROOT}`, the variable
  both Grok Build and Claude Code expand); when working on this repository in
  Claude Code, decline the project MCP server it offers from that file.

How a release is made is in [`RELEASING.md`](RELEASING.md).

## License

[MIT](LICENSE)
