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

The options are the [settings](#settings). A toolset that is off by default is
turned on by listing it in `toolsets` with the ones to keep, for example
`"options": { "toolsets": ["account", "zones", "dns", "workers", "pages", "email"] }`.

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
install directory and passes no roots, so the server takes each call's directory
from what Codex sends with the call: its sandbox state, which the server asks
for, else the one workspace it names.

The plugin declares `default_tools_approval_mode = "writes"`: Codex asks before
every tool not marked read-only. A user's
`[plugins."<plugin>".mcp_servers.<server>]` setting can only tighten it. Setting
`auto` there yields `prompt` (reads asked too), since Codex treats `auto` and
`writes` as incomparable.

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

Hermes scans a plugin when it installs it. From v0.7.0 the verdict is
`caution`: the tunnel tools name the token permission Account → Cloudflare One
Connector: cloudflared, and Hermes rates the word as a tunneling service.
`hermes plugins install` then asks before installing; where it cannot ask (no
terminal), add `--force`, which overrides a `caution` verdict and no other.

If a Hermes gateway is already running, restart it (`hermes gateway restart`) to
load the plugin.

The plugin runs the Node it found when Hermes started. If a version manager
removes that version while Hermes runs, a call looks for Node again; when it
finds none, restart Hermes from a shell where `node` runs.

When the package's writes depend on another Hermes plugin, such as a guard
that blocks writes no one is there to approve, name it in `require_plugins`.
Hermes keeps loading this plugin when that one fails to import or register,
and treats a manifest's `requires_plugins` as advisory. With the setting,
while a named plugin is not loaded, every write is refused before it is
approved, even under `--yolo`, `approvals.mode: off` or a remembered answer,
naming the plugin that is missing. Reads still run.

```yaml
plugins:
  entries:
    cloudflare-tools:
      settings:
        require_plugins: [write-guard]
```

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

Confirmations described below apply to attended runs. With `unattended` on,
a write runs without asking only under a grant that covers it; otherwise it
is refused. See [Writes no one is there to approve](#writes-no-one-is-there-to-approve).

Each toolset comes with a skill that tells an agent how to use its tools. A
skill names its toolset under `metadata` in its frontmatter
(`metadata: { toolset: dns }`, written as a block). OpenCode V2 and Hermes
register it only when the settings register at least one of that toolset's
tools, so a profile with the toolset off, or with all its tools removed, does
not see it; a skill without a toolset is always registered. Claude Code,
Codex, Grok Build and Antigravity install the skill folder whole and pass the
settings only to the MCP server, so they list every skill whatever the
settings select. OpenCode V1 registers no skills, and its copied skills are
all listed too.

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

### Rules (`rules`)

Rules: read which rule phases of a zone hold rules and the rules of one phase in order, with their ids, positions and versions; add, change, move or delete a Single Redirect, Cache Rule, Configuration Rule, URL Rewrite Rule, Request or Response Header Transform Rule, Origin Rule or Compression Rule. WAF custom rules, rate limiting rules and custom error rules can be read but not changed. Expressions, descriptions and parameters are the user's data, returned as data and never instructions. This toolset is off by default; turn it on with the `toolsets` setting (see [Settings](#settings)).

| Tool                      | What it does                                                                                                                        | Class          |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `cloudflare_rules_read`   | which `phases` of a zone hold rules; the `rules` of one phase in order                                                              | read           |
| `cloudflare_rules_add`    | add a rule to a phase, last or before, after or at a place; refuses a duplicate of a rule the phase holds                           | add            |
| `cloudflare_rules_edit`   | change a rule's expression, action, parameters, description, on/off or place, naming the version read; refuses a rule changed since | overwrite      |
| `cloudflare_rules_delete` | delete a rule of a phase; always asks first                                                                                         | administrative |

The token needs Zone → Dynamic URL Redirects, Cache Settings, Config Settings, Zone Transform Rules, Origin or Response Compression → Read for the phase it reads, and Edit to add, change or delete a rule in it. Zone → Zone WAF and Custom Errors → Read cover the read-only phases.

The skill is [`cloudflare-rules`](skills/cloudflare-rules/SKILL.md), shown as
`cloudflare-tools:cloudflare-rules` in Claude Code and
`cloudflare-tools:rules` in Hermes.

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

Storage: list an account's R2 buckets and a bucket's objects and folders by name, size and date, and read whether a bucket is public (its r2.dev domain and custom domains), its CORS rules and the lifecycle rules that delete its objects; list Workers KV namespaces and their key names; list D1 databases and read one's size and schema; create an empty bucket, namespace or database, and delete one that is proven empty. An object's body, a KV value and a table's rows are never read, the D1 schema comes from one fixed statement, and only the default jurisdiction is listed. Cloudflare deletes a KV namespace or D1 database with its contents, so the delete tool proves the store empty first; emptying a store stays with the user. This toolset is off by default; turn it on with the `toolsets` setting (see [Settings](#settings)).

| Tool                        | What it does                                                                                                            | Class          |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------- |
| `cloudflare_storage_read`   | R2 `buckets`, a `bucket`'s details, its `objects`; KV `namespaces`, their `keys`; D1 `databases`, a `database`'s schema | read           |
| `cloudflare_storage_create` | create an empty R2 bucket, KV namespace or D1 database from a name                                                      | add            |
| `cloudflare_storage_delete` | delete a bucket, namespace or database only when it is proven empty; always asks first                                  | administrative |

The token needs Account → Workers R2 Storage → Read, Workers KV Storage → Read or D1 → Read, for the store it reads; creating and deleting need the same permission's Edit.

The skill is [`cloudflare-storage`](skills/cloudflare-storage/SKILL.md), shown as
`cloudflare-tools:cloudflare-storage` in Claude Code and
`cloudflare-tools:storage` in Hermes.

### Tunnels (`tunnels`)

Tunnels: list an account's Cloudflare Tunnels by name, status and connection times, and read one tunnel's active connectors, edge connections, colos and public-hostname ingress routing rules. A tunnel's run token is never exposed, connectors' internal ids and origin IP addresses are never read, and deleted tunnels are left out. For locally managed tunnels, ingress rules are kept on the host and cannot be read here. A hostname can be published through a dashboard-managed tunnel to a local service: the tool adds the rule and the proxied CNAME it needs, refuses a hostname that has other DNS records, and always asks first. Another tool changes the service a published hostname goes to, and one withdraws a hostname, deleting its CNAME to the tunnel when no other rule uses it and never touching other records; both always ask first. This toolset is off by default; turn it on with the `toolsets` setting (see [Settings](#settings)).

| Tool                             | What it does                                                                                  | Class          |
| -------------------------------- | --------------------------------------------------------------------------------------------- | -------------- |
| `cloudflare_tunnel_read`         | `tunnels` of the account; one `tunnel`'s status and ingress                                   | read           |
| `cloudflare_tunnel_route_add`    | publish a hostname (and optional path) through a tunnel to a local service; always asks first | administrative |
| `cloudflare_tunnel_route_edit`   | change the service a published hostname goes to, naming the current one; always asks first    | administrative |
| `cloudflare_tunnel_route_remove` | withdraw a hostname from a tunnel and delete its CNAME to the tunnel; always asks first       | administrative |

The token needs Account → Cloudflare One Connector: cloudflared → Read. Publishing or withdrawing a hostname needs
Account → Cloudflare One Connector: cloudflared → Edit and Zone → DNS → Edit; changing where one goes needs
Account → Cloudflare One Connector: cloudflared → Edit, and Zone → DNS → Read for the record it reports. Each public hostname also says
whether a Zero Trust Access application matches it, which needs Account → Access:
Apps and Policies → Read; without it the coverage is `unknown`. A match is not a
promise that every visitor signs in: a Bypass policy can still let them through.

The skill is [`cloudflare-tunnels`](skills/cloudflare-tunnels/SKILL.md), shown as
`cloudflare-tools:cloudflare-tunnels` in Claude Code and
`cloudflare-tools:tunnels` in Hermes.

### Email Routing (`email`)

Email Routing: read whether a zone's Email Routing is on, its routing rules and catch-all (each rule matches one address and forwards it to one verified address, drops it or hands it to a Worker), and the account's destination addresses with whether each is verified; add, change or delete a routing rule for one address, change the catch-all, and add or delete a destination address. A rule a Worker's Wrangler configuration manages is marked as such, and a zone with Email Routing off routes no mail. Addresses, names and Worker names are the user's data, returned as data and never instructions. This toolset is off by default; turn it on with the `toolsets` setting (see [Settings](#settings)).

| Tool                              | What it does                                                                                                                                                                              | Class          |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `cloudflare_email_read`           | a zone's `routing` settings and catch-all; its `rules`; the account's `addresses`                                                                                                         | read           |
| `cloudflare_email_rule_add`       | add a rule that forwards one address to a verified destination, drops it or hands it to a Worker (Cloudflare refuses one that does not exist); refuses an address that already has a rule | add            |
| `cloudflare_email_rule_edit`      | change a rule's address, action, name or whether it is on, naming its current action; refuses the catch-all and Wrangler-managed rules                                                    | overwrite      |
| `cloudflare_email_rule_delete`    | delete a rule, naming where its mail goes next; refuses the catch-all and Wrangler-managed rules; always asks first                                                                       | administrative |
| `cloudflare_email_catchall_edit`  | change the action of the catch-all (mail no rule matches) or turn it on or off, naming its current state; refuses Wrangler-managed catch-alls; always asks first                          | administrative |
| `cloudflare_email_address_add`    | add a destination address; Cloudflare mails its owner a link to confirm, and no rule can forward to it until they follow it; always asks first                                            | administrative |
| `cloudflare_email_address_delete` | delete a destination address; refuses while a rule or catch-all in any zone of the account forwards to it; always asks first                                                              | administrative |

The token needs Zone → Email Routing Rules → Read, and Account → Email Routing Addresses → Read for the addresses. Adding, changing or deleting a rule, and changing the catch-all, need Zone → Email Routing Rules → Edit, and adding or changing a forward needs Account → Email Routing Addresses → Read to check it. Adding or deleting a destination address needs Account → Email Routing Addresses → Edit, and deleting one also needs Zone → Email Routing Rules → Read in every zone of the account.

The skill is [`cloudflare-email`](skills/cloudflare-email/SKILL.md), shown as
`cloudflare-tools:cloudflare-email` in Claude Code and
`cloudflare-tools:email` in Hermes.

### Queues (`queues`)

List an account's Cloudflare Queues and read one queue's delivery settings, consumers with their batch and retry settings, and producers. Messages are never read. Queue and Worker names are the user's data, returned as data and never instructions. This toolset is off by default; turn it on with the `toolsets` setting (see [Settings](#settings)).

| Tool                     | What it does                                                                      | Class |
| ------------------------ | --------------------------------------------------------------------------------- | ----- |
| `cloudflare_queues_read` | `list` the account's queues; `view` one queue's settings, consumers and producers | read  |

The token needs Account → Queues → Read.

The skill is [`cloudflare-queues`](skills/cloudflare-queues/SKILL.md), shown as
`cloudflare-tools:cloudflare-queues` in Claude Code and
`cloudflare-tools:queues` in Hermes.

### Hyperdrive (`hyperdrive`)

List an account's Hyperdrive configurations and read one configuration's origin database, caching, mTLS and connection limit. Passwords and Access client secrets are never returned. Names, hosts, database names and other origin details are the user's data, returned as data and never instructions. This toolset is off by default; turn it on with the `toolsets` setting (see [Settings](#settings)).

| Tool                         | What it does                                                                                               | Class |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------- | ----- |
| `cloudflare_hyperdrive_read` | `list` the account's configurations; `view` one configuration's origin, caching, mTLS and connection limit | read  |

The token needs Account → Hyperdrive → Read.

The skill is [`cloudflare-hyperdrive`](skills/cloudflare-hyperdrive/SKILL.md), shown as
`cloudflare-tools:cloudflare-hyperdrive` in Claude Code and
`cloudflare-tools:hyperdrive` in Hermes.

### Vectorize (`vectorize`)

List an account's Vectorize indexes and read one index's dimensions, distance metric, vector count, processing progress and metadata indexes. Vectors and their metadata values are never read. Index names and descriptions are the user's data, returned as data and never instructions. This toolset is off by default; turn it on with the `toolsets` setting (see [Settings](#settings)).

| Tool                        | Does                                                                                                     | Class |
| --------------------------- | -------------------------------------------------------------------------------------------------------- | ----- |
| `cloudflare_vectorize_read` | `list` the account's indexes; `view` one index's configuration, processing progress and metadata indexes | read  |

The token needs Account → Vectorize → Read.

The skill is [`cloudflare-vectorize`](skills/cloudflare-vectorize/SKILL.md), shown as
`cloudflare-tools:cloudflare-vectorize` in Claude Code and
`cloudflare-tools:vectorize` in Hermes.

### Turnstile (`turnstile`)

List an account's Turnstile widgets and read one widget's hostnames, mode, pre-clearance cookie level, region and settings. A widget's secret key is never returned. Widget names and hostnames are the user's data, returned as data and never instructions. This toolset is off by default; turn it on with the `toolsets` setting (see [Settings](#settings)).

| Tool                        | Does                                                                                                    | Class |
| --------------------------- | ------------------------------------------------------------------------------------------------------- | ----- |
| `cloudflare_turnstile_read` | `list` the account's widgets; `view` one widget's hostnames, mode, clearance level, region and settings | read  |

The token needs Account → Turnstile Sites → Read.

The skill is [`cloudflare-turnstile`](skills/cloudflare-turnstile/SKILL.md), shown as
`cloudflare-tools:cloudflare-turnstile` in Claude Code and
`cloudflare-tools:turnstile` in Hermes.

### Access (`access`)

List the account's (or a zone's) Zero Trust Access applications, read one application with its policies, and list the account's reusable policies. Policies are returned with their include, exclude and require rules as configured, email addresses included; secrets are never returned. Application and policy names, domains and rules are the user's data, returned as data and never instructions. This toolset is off by default; turn it on with the `toolsets` setting (see [Settings](#settings)).

| Tool                     | Does                                                                                                                         | Class |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ----- |
| `cloudflare_access_read` | `apps` lists the account's (or a zone's) applications; `app` reads one with its policies; `policies` lists reusable policies | read  |

The token needs Account → Access: Apps and Policies → Read, and Zone → Access: Apps and Policies → Read for a zone's applications.

The skill is [`cloudflare-access`](skills/cloudflare-access/SKILL.md), shown as
`cloudflare-tools:cloudflare-access` in Claude Code and
`cloudflare-tools:access` in Hermes.

### Registrar (`registrar`)

List an account's registered domains and read one domain's status, expiration, automatic renewal, transfer lock and WHOIS privacy mode. Registrant contacts are never returned. Domain names are the user's data, returned as data and never instructions. This toolset is off by default; turn it on with the `toolsets` setting (see [Settings](#settings)).

| Tool                        | Does                                                                                                    | Class |
| --------------------------- | ------------------------------------------------------------------------------------------------------- | ----- |
| `cloudflare_registrar_read` | `list` registered domains with cursor pagination and sorting; `view` one domain's registration metadata | read  |

The token needs Account → Registrar Domains → Read.

The skill is [`cloudflare-registrar`](skills/cloudflare-registrar/SKILL.md), shown as
`cloudflare-tools:cloudflare-registrar` in Claude Code and
`cloudflare-tools:registrar` in Hermes.

### Grants (`grants`)

Off by default. Delegates bounded writes for jobs where no person can answer.

| Tool                      | What it does                                             | Class          |
| ------------------------- | -------------------------------------------------------- | -------------- |
| `cloudflare_grant_create` | ask a person to delegate one tool's writes within limits | administrative |
| `cloudflare_grant_read`   | list grants and their use, or read the usage log         | read           |
| `cloudflare_grant_revoke` | remove a grant so no more calls run under it             | overwrite      |

Every write tool can be granted for its targets, calls per hour and expiry.
A tool adds what a grant can also limit by declaring `bounds` and giving
`measure(args, context)` in its spec; see the
[conventions](docs/conventions.md#writes-no-one-is-there-to-approve). No tool
of this package declares `bounds` yet.

## Adding a tool

1. Write the spec in `src/core/<domain>/<verb>.ts` with `defineTool`: an ID
   `<prefix>_<domain>_<verb>`, a title and description, the Zod argument and
   output schemas, its toolset and write class, and `execute(args, context)`.
   A write tool also gives `targets(args, context)`: what the call writes to,
   as a permission rule should name it. A tool whose settings can put some
   calls out of reach whatever the person answers gives
   `gate(args, context)`, which throws for such a call; it is refused before
   anyone is asked, and before `execute`.
2. Test it beside the spec (`<verb>.test.ts`), calling it through `invoke` as
   the entry points do. A tool that runs a program is tested against a fake of
   that program on `PATH`; no test reaches a real service.
3. List it in `src/tools.ts`. A new toolset goes into `toolsets` in
   `src/project.ts` (and `defaultToolsets` when it is on by default), a
   setting of the package's own into `options` (and `OPTIONS` in `project.py`
   with `config_schema` in `plugin.yaml`), and a variable the tool reads
   besides the settings into `toolVariables`.
4. Add or update the toolset's skill, `skills/<prefix>-<toolset>/SKILL.md`,
   whose frontmatter names the toolset under `metadata`.
5. Run `pnpm run build && pnpm run manifests` to list the tool in
   `plugin.yaml` and its variables in Codex's manifest, then describe it under
   "Tools and skills".

[`docs/conventions.md`](docs/conventions.md) has the rules each step follows.

A package declares each option as `text`, `boolean`, `number`, `list`, `path`
or `paths`, or as an object with `type` and optional bounds. For example, in
`src/project.ts`:

```ts
options: {
  notes_dir: "path",
  note_limit: { type: "number", integer: true, min: 1, max: 50 },
}
```

`integer: true` requires a whole number; `min` and `max` bound a number or
count a `list` or `paths` value's items. An object with only `type` means the
same as the type alone. Hermes's `OPTIONS` mirrors the declarations on one
line, with double quotes and Python's `True` for `integer`:

```python
OPTIONS: dict[str, str | dict[str, object]] = {"notes_dir": "path", "note_limit": {"type": "number", "integer": True, "min": 1, "max": 50}}
```

## Reads and writes

Every read tool is named `<prefix>_<domain>_read`. Reads can run unasked;
in attended runs, writes are confirmed by the harness. With `unattended` on,
writes instead need a covering grant, as described below.

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
- **Codex** asks before every write because of the plugin's approval mode.
  Under `codex exec` it refuses with "MCP tool call requires approval, but
  approval policy is never". For bounded jobs, see
  [Writes no one is there to approve](#writes-no-one-is-there-to-approve).
- **Grok Build** under `grok -p` refuses a write it cannot ask about, unless it
  is allowed beforehand.
- **Grok Build** calls the plugin's tools through its `use_tool` tool, and the
  agent often names a tool without its server first. Grok checks the rules
  against the name as given, so the server-qualified rule alone does not match
  that first call. The second rule matches the short name; a write still
  matches neither.
- **Antigravity** asks before any MCP tool no rule allows, reads included, and
  names the plugin's server `cloudflare-tools_cloudflare-tools` (plugin,
  then server). `agy -p` refuses a tool it cannot ask about.
- **Hermes** `hermes chat -q` refuses a write it cannot ask about; `hermes -z`
  and `--yolo` skip approval, so writes then run unasked. For bounded jobs, see
  [Writes no one is there to approve](#writes-no-one-is-there-to-approve).

A call a tool's `gate` refuses never runs, whatever the answer. OpenCode and
Hermes refuse it before they ask, so no prompt shows it; Hermes blocks it with
the tool's error. Claude Code, Codex, Grok Build and Antigravity draw their
own prompt before the MCP server sees the call, so they may still ask about
it; the server then refuses it.

## Writes no one is there to approve

A grant limits a job's writes to one tool, for at most 90 days. The person
decides the rest: the targets (named ones, or `*` for any), the bounds the
tool declares (one left out is no limit) and the calls per hour (left out,
any number). Every call made under a grant is logged. A grant never
overrides the host's permissions. The
[conventions](docs/conventions.md#writes-no-one-is-there-to-approve) give the
contract.

1. In a session where a person answers, supply the key described under
   [Settings](#settings), turn on the `grants` toolset alongside the job's
   toolset, and ask the agent to delegate. It calls `cloudflare_grant_create`;
   the prompt shows the tool, targets, rate, days, every bound the tool
   declares (`no limit` for one left out) and the reason.
   Approve once.
2. Set the same key and `unattended` for the job only, for example
   `CLOUDFLARE_TOOLS_UNATTENDED=true`. Otherwise grants are not checked.
3. Let the host allow the write tool in that run, as below. The grant still
   bounds each call.
4. Revoke with `cloudflare_grant_revoke`, or list grants and their use with
   `cloudflare_grant_read`.

What lets a write reach the package when no one can answer, for example
`cloudflare_dns_record_add`:

- **OpenCode** `opencode run` rejects every question unless an allow rule
  names the tool (`"permission": { "cloudflare_dns_record_add": "allow" }`) or the
  run starts with `--auto`.
- **Claude Code** `claude -p` needs the tool in `--allowedTools`, as
  `mcp__plugin_cloudflare-tools_cloudflare-tools__cloudflare_dns_record_add`.
- **Codex** `codex exec` needs `approval_mode = "approve"` for that tool under
  the plugin's MCP server in `config.toml`
  (`[mcp_servers.<server>.tools.<tool>]`), since the plugin's default asks
  before every write.
- **Grok Build** `grok -p` needs both allow rules:
  `--allow 'MCPTool(cloudflare-tools__cloudflare_dns_record_add)'` and
  `--allow 'MCPTool(cloudflare_dns_record_add)'`, for the qualified and short names
  described under [Reads and writes](#reads-and-writes).
- **Antigravity** `agy -p` needs
  `mcp(cloudflare-tools_cloudflare-tools/cloudflare_dns_record_add)` in
  `permissions.allow`.
- **Hermes** `hermes chat -q` denies by `approvals.single_query_mode` unless
  allowed. `-z` and `--yolo` skip approvals and run the write; the grant is
  then the only bound.

### Limits

- A run with every approval skipped (Hermes `-z` or `--yolo`, an
  always-approve mode, an explicit `allow` for `cloudflare_grant_create`, or a
  global OpenCode V1 `allow`) shows no prompt. A grant created there is not a
  person's answer, and it can be as wide as any target, no bound and no rate
  for 90 days: create grants only where the harness asks.
- An earlier copy of the grants directory put back whole is not detected.
  Expiry, at most 90 days, bounds what it can restore.
- Anyone who can read the key can sign grants. Keep it where the agent's
  tools cannot read it.
- The OpenCode V2 plugin forces a question for `cloudflare_grant_create`
  through a hook; only hosts that offer that hook run it.

The OpenCode V2 service and Hermes gateway keep the environment they started
with; see [Settings](#settings) before changing the job's variables.

## Settings

Every entry point takes the same settings. A flag wins over its environment
variable, and an option or setting wins over the variable too.

| Setting           | Flag              | Variable                         | Meaning                                                                                                                               |
| ----------------- | ----------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `toolsets`        | `--toolsets`      | `CLOUDFLARE_TOOLS_TOOLSETS`      | the toolsets that are on, or `all`; default those `src/project.ts` names                                                              |
| `read_only`       | `--read-only`     | `CLOUDFLARE_TOOLS_READ_ONLY`     | registers no tool that writes; wins over every other setting                                                                          |
| `unattended`      | `--unattended`    | `CLOUDFLARE_TOOLS_UNATTENDED`    | no person can answer: a write runs only under a grant that covers it; off by default                                                  |
| `grants_dir`      | `--grants-dir`    | `CLOUDFLARE_TOOLS_GRANTS_DIR`    | where grants and their use are kept; default `$XDG_STATE_HOME/cloudflare-tools/grants`, else `~/.local/state/cloudflare-tools/grants` |
| `tools`           | `--tools`         | `CLOUDFLARE_TOOLS_TOOLS`         | single tools to add by ID, whatever their toolset                                                                                     |
| `exclude_tools`   | `--exclude-tools` | `CLOUDFLARE_TOOLS_EXCLUDE_TOOLS` | single tools to remove by ID; wins over `tools` and `toolsets`                                                                        |
| `confirm`         | `--confirm`       | `CLOUDFLARE_TOOLS_CONFIRM`       | MCP server only: `harness` (default) or `elicitation`, as the conventions say                                                         |
| `language`        | `--language`      | `CLOUDFLARE_TOOLS_LANGUAGE`      | native plugins only: the approval prompt's language, such as `ja`                                                                     |
| `emoji`           | —                 | —                                | Hermes only: the emoji shown beside each toolset, by toolset name (`""` for none)                                                     |
| `require_plugins` | —                 | —                                | Hermes only: the plugins that must be loaded; while one is not, every write is refused before it is approved                          |

`CLOUDFLARE_TOOLS_GRANT_KEY` is a variable only, never a flag or a plugin
option. Use at least 32 characters, for example from `openssl rand -hex 32`,
stored where the host keeps secrets. Without it no write runs while
unattended and no grant can be created. Codex forwards it alongside the
settings' variables, as described below.

Lists are comma-separated in a flag or a variable. A package's own settings,
listed in `options` in `src/project.ts`, take a row each here and are read the
same way. A `path` is trimmed; `~` and `~/…` (also with the platform separator)
stand for the home directory (`HOME` when it is absolute, else the account's).
It must then be absolute and reaches the tool normalized,
without a filesystem check. `paths` is a list of such paths, comma-separated
in a flag or variable and an array of strings in a plugin option. Blank paths
and lists with no items after trimming and dropping blanks count as unset.
Bounds check only a given value, not an unset option. Refused values are
`invalid_argument`, naming the flag, variable or option and what it must be.
Hermes passes paths and lists to the command line, which checks the paths and
bounds. Where each harness reads them:

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

  Without a `language` setting, the approval card follows Hermes's own
  `display.language` (or `HERMES_LANGUAGE`), the language of its approval
  buttons, and else stays in English.

- **Claude Code, Grok Build and Antigravity** start the plugin's server without
  flags and pass it the client's environment, so set the variables in the
  environment the harness runs in.
- **Codex** passes a plugin's MCP server only a few basic variables (such as
  `PATH` and `HOME`) and those the plugin's manifest names, which are the
  variables above: set them in the environment Codex runs in. A variable the
  tools read besides the settings belongs in `toolVariables` in
  `src/project.ts`; `pnpm run manifests` adds it to the manifest after the
  settings' variables. To pass flags, or to give the server a variable the
  package does not name, add the server under `[mcp_servers]` in Codex's
  `config.toml` instead of using the plugin, with flags in `args` and the
  variables to forward in `env_vars`, as [Credentials](#credentials) shows.

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

- `src/project.ts` — the package's name, tool ID prefix, setting prefix,
  toolsets, tool options and the other variables its tools read.
- `src/core/` — the tool contract and the tools, free of any harness and of
  the project's names.
- `src/tools.ts` — the list of every tool, which each entry point registers.
- `src/words.ts` — the translations of the tools' words, per language, which
  the native plugins use in their approval prompts.
- `src/mcp/` — the MCP server, built to `dist/mcp.js` and run by
  `cloudflare-tools`.
- `src/opencode/` — the OpenCode plugin, built to `dist/opencode.js`.
- `src/cli/` — the command line the Hermes plugin calls, built to `dist/cli.js`
  and run by `cloudflare-tools-cli`.
- `src/hermes/`, `plugin.yaml` and `__init__.py` — the Hermes plugin.
- `skills/` — one skill per toolset, `skills/<name>/SKILL.md`, which every
  harness that takes skills loads from the package or plugin root; the native
  plugins load only those of the toolsets that are on.
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

[AGPL-3.0 with Commons Clause](LICENSE)
