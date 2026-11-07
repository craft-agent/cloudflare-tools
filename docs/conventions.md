# Tool conventions

The rules every tool in this package follows, so tools read alike across
domains and harnesses. Each rule carries the reason it was chosen; a change
to a rule changes this file first, with its reason.

## Names

- **Tool IDs are `<prefix>_<domain>_<verb>`**: `<prefix>_note_read` and
  `<prefix>_note_create` for a `note` domain. The prefix is `toolPrefix` in
  `src/project.ts`; it keeps a name unambiguous where a harness lists every
  tool in one namespace. When the domain has a well-known command line,
  follow its word order, so a name maps to a command anyone can look up.
- **The same ID in every entry point.** Permission rules and skills are
  written once, and an ID is a public interface: renaming one is a breaking
  change.
- **Verbs are plain**: `create`, `edit`, `delete`, `add`, `remove`, and these
  with a fixed meaning:

  | Verb      | Means                                                        |
  | --------- | ------------------------------------------------------------ |
  | `read`    | the one read tool of a domain (below)                        |
  | `resolve` | find which object a call means                               |
  | `ensure`  | create when missing, reuse when present; never a second copy |

- **One read tool per domain, one write tool per operation.**
  `<prefix>_<domain>_read` takes a `method` argument (`view`, `list`, …). A
  model picks tools worse as their number grows, and reads share one set of
  annotations, so folding them loses nothing. Writes stay apart because a
  merged write tool would carry its strictest class: creating something would
  ask like overwriting it.
- **Names stay within 40 characters**, so a client prefix such as
  `mcp__<server>__` still fits a 64-character limit. `defineTool` enforces
  the shape and the length; `src/tools.test.ts` enforces the prefix.

## Arguments

- **snake_case**, for arguments and for the keys of a result alike: one style
  for everything a model reads.
- **Lists change through flat arguments**: `add_tags`, `remove_tags`. Shallow
  schemas are read reliably by every model the harnesses run. An argument that
  replaces a whole list, where one is needed, is named for the list (`tags`)
  and its description says it replaces.
- **Unknown arguments are refused.** Every entry point validates the
  arguments as strict, so a misspelt one fails as `invalid_argument` instead
  of being ignored.
- **The tools' own install directory is never the working tree.** A harness
  may start a tool inside the directory the package is installed in.
  `ToolContext.ownDir` names it; a tool that reads the working tree refuses
  to treat that directory as the caller's, saying so.

## Results

- **A tool returns its data as a plain object**, with no `ok` envelope. Each
  entry point renders it: the MCP server as `structuredContent` with the
  tool's `outputSchema` plus the same JSON as text, a native plugin as a JSON
  string.
- **A failure throws.** Every harness then sees a failed call (`isError` over
  MCP) rather than a success that carries an error.
- **One exception: what a call created is never lost.** Once a tool has
  created something, a later step of the same call that fails does not throw.
  The result names what was created and lists the failed steps under
  `errors`, keyed by step (`StepErrors`).
- **Text a tool reads is returned as it is.** Content from files or services
  is data, never instructions; every read tool's description and the skills
  say so. Nothing is wrapped or rewritten.

## Errors

A thrown error carries a `code` a caller can branch on, and a message that
says what to do next.

| Code               | When                                                                       |
| ------------------ | -------------------------------------------------------------------------- |
| `not_found`        | the object does not exist, or the caller cannot see it                     |
| `forbidden`        | the caller lacks the permission the call needs                             |
| `invalid_argument` | the arguments cannot describe a valid call                                 |
| `stale`            | what the call relied on changed before it could finish                     |
| `unauthenticated`  | the service or program the tool calls is not logged in                     |
| `rate_limited`     | the service refused the call for its rate limit                            |
| `declined`         | the person declined a confirmation the tool asked for                      |
| `upstream_error`   | the service or program the tool calls failed; the message carries its text |
| `internal_error`   | a bug in a tool or an entry point, such as a result off its schema         |

A project adds a code to `src/core/errors.ts` and to this table together.

## Write classes

Every tool belongs to one class, and the class sets its MCP annotations.
`openWorldHint` is `true` for every tool.

| Class             | Examples                              | `readOnlyHint` | `destructiveHint` | `idempotentHint` |
| ----------------- | ------------------------------------- | -------------- | ----------------- | ---------------- |
| read              | view, list, resolve                   | `true`         | —                 | `true`           |
| add               | create, add                           | `false`        | `false`           | `false`          |
| idempotent change | ensure, adding a tag                  | `false`        | `false`           | `true`           |
| overwrite         | editing a body or title, removing one | `false`        | `true`            | `true`           |
| administrative    | delete, visibility, publishing        | `false`        | `true`            | `false`          |

- **Overwriting counts as destructive**: it loses what was there, and
  harnesses that confirm only destructive tools should still ask before it.
- **A tool takes the strictest class its arguments can reach.**
- **The harness confirms writes.** Every MCP client asks before it runs a
  write tool, so the tool does not ask again by default. Administrative tools
  also carry `_meta["anthropic/requiresUserInteraction"]: true`, which makes
  Claude Code ask even under an allow rule.
- **A native plugin asks the harness's own permission before every non-read
  call**, since the tools a native plugin adds pass through no harness
  approval of their own.
- **It asks for everything the call writes to.** A write tool's `targets`
  resolver names what the call writes to, as the permission rules name it
  (a path, an account, a record). Anything it cannot tell, every tool
  without a resolver, and a target holding `*` or `?` (which a harness would
  store as a pattern) is `*`, and `*` is never stored. An "always" answer then
  covers only what it named, never a write somewhere else.
- **`confirm: "elicitation"` adds the tool's own form** for administrative
  tools, where the client offers form-mode elicitation. It is for people who
  switch the client's approvals off: the tool states what will happen in plain
  words and stops on anything but an accept. Where the client does not offer
  elicitation the setting adds nothing, and the harness's approval is then the
  only confirmation.
- **Annotations are hints, not a boundary.** The `read_only` setting
  (below) is what keeps writes out.

## Toolsets and settings

Every entry point takes the same settings:

- **Toolsets**: one per domain, listed in `src/project.ts` with the ones on by
  default. A small default keeps the model's choice sharp.
- **`read_only`** registers no write tool, and wins over every other setting.
- **`tools` / `exclude_tools`** add or remove single tools; an exclusion wins
  over an inclusion.
- **`confirm`** is `harness` (the default) or `elicitation`; it says who asks
  before an administrative tool acts (see "Write classes"). The default leaves
  the question to the harness, whose approval every user already knows.

## The core contract

- A tool spec declares its ID, description, argument schema, output schema,
  toolset and write class; every entry point derives the same metadata from
  it. A write tool also declares `targets(args, context)`, which names what
  the call writes to.
- `execute(args, context)` gets the working directory, an abort signal, an
  optional `ownDir` (the directory the tools are installed in, never the
  working tree) and an optional `confirm(request) => Promise<boolean>` hook.
  Nothing in it names a harness. An entry point supplies `confirm` when the
  `elicitation` setting is on; without it the harness's approval stands, and a
  tool that needs a confirmation treats a missing hook as the harness having
  approved the call.
- `src/core/` uses only the `node:*` modules and plain dependencies, never a
  runtime's own globals (`Bun.spawn`, `Bun.file`, …), so the same code runs on
  Node and on Bun. It knows no project either: names, prefixes and toolsets
  come from `src/project.ts` through the entry points.

## Programs a tool runs

- **Every program a tool runs goes through one runner** built on `exec`, with
  an explicit environment: what the program needs to find itself and
  authenticate is passed through, and nothing else, so a stray variable
  cannot redirect a call. Prompts and colors are switched off, so nothing
  waits on a person and output parses the same everywhere.
- **Every variable the tools read besides the settings is named in
  `toolVariables` in `src/project.ts`**, whether a tool reads it itself or
  passes it through to a program. Codex gives a plugin's server only a few
  basic variables (`PATH`, `HOME` and the like) and those its manifest names,
  and `pnpm run manifests` writes that list from the settings and
  `toolVariables`: a variable left out is set everywhere but in Codex.
- **Every call has a time limit**, and a call that is stopped, by that limit
  or by cancellation, has its child process killed: `SIGTERM`, then `SIGKILL`
  after two seconds. A hung program neither holds a harness forever nor
  outlives its call.
- **The runner maps the program's failures to the error codes above.**

## Tests

- Tests sit beside the code they test (`*.test.ts`) and run on `bun test`;
  CI also starts the built MCP server, plugin and command line under Node and
  lists their tools, so a runtime-only API cannot slip in unnoticed.
- No test reaches a real service. A tool that runs a program is tested
  against a fake of that program on `PATH`.
- A test file stays within about 300 lines, split by topic
  (`<name>.<topic>.test.ts`), so one commit can carry a change and its test.

## Accounts and credentials

- **Credentials come from the environment only.** `CLOUDFLARE_API_TOKEN`
  with `CLOUDFLARE_ACCOUNT_ID` is the unlabeled pair, the names Wrangler
  reads, so a set-up Wrangler environment works as it is.
  `CLOUDFLARE_API_TOKEN_<LABEL>` with `CLOUDFLARE_ACCOUNT_ID_<LABEL>` adds one
  pair per label. The lookup lives in one module, so another source can be
  added without changing a tool; a setting or an argument never carries a
  token.
- **A label is 1 to 24 lowercase letters, digits and `_`**, starting and
  ending with a letter or a digit, and its variables carry it in capitals
  (`my_site` → `CLOUDFLARE_API_TOKEN_MY_SITE`). The prefix is fixed, so an
  `_` inside a label cannot be misread.
- **`account` picks the pair.** Left out, it picks the unlabeled pair; without
  one, the only label; with several labels and no unlabeled pair, the call
  fails as `invalid_argument` and lists them. The unlabeled pair is also named
  `default`, which is therefore not a label. A server started inside a
  repository receives that repository's own `CLOUDFLARE_API_TOKEN` next to
  labels set for the whole environment, so both being set is normal, and the
  unlabeled pair is what that environment means by default.
- **A token always comes with its account id**; one without is
  `unauthenticated`, naming the variable to set. Nothing is looked up to fill
  it in: a user-owned token can reach several accounts, and a looked-up one
  could change silently when the token gains a permission.
- **One label is one account.** A zone is looked up only in the label's
  account, and a zone of another account is refused before anything else is
  read about it. A path naming the account is filled from the label, never
  from an argument, so no call reaches an account the label does not name.
- **A Global API Key is refused before anything is sent.** It reaches
  everything the user can, and no tool needs more than a scoped API token.
- **No credential is ever shown.** Anything shaped like a Cloudflare
  credential is masked in every result, error message and log, not only the
  token in use: an error body can echo another one.

## The Cloudflare client

- **Every Cloudflare call goes through one client**, as every program goes
  through one runner: a fixed base URL, a route allowlist each tool's calls
  are checked against, no redirect followed (a redirect would carry the token
  elsewhere), a time limit with cancellation, and Cloudflare's failures mapped
  to the error codes above. A tool never calls `fetch` itself.

## What the tools never return

- **Credentials and visitors' personal data, by any tool.** Tokens, secret
  values and private keys cannot be taken back once they are in a transcript,
  and visitors' IP addresses and the like are not the user's to hand to an
  agent. An operation whose result would have to carry one is not offered.
- **A user's own content only from read tools of its own.** Object bodies, KV
  values, database rows and Worker source are returned only by read tools in
  toolsets that are off by default; every other read returns names and
  metadata. Such content often holds configuration or secrets and is a path
  for injected instructions, so turning its toolset on is the opt-in. Once on,
  it is returned as it is, like any text a tool reads.

## Writes

- **A write's arguments are the whole change.** They name what changes by id
  and give the new values; nothing is chosen at run time from the current
  state ("the previous deployment", "every matching record"). The harness
  shows the arguments when it asks, so what it shows is what runs.
- **A write returns what it changed**, before and after, so the result can be
  checked and undone without another read.
- **Only a write that could overwrite a concurrent change checks for one.**
  Such a tool takes the value it expects to replace and refuses as `stale`
  when Cloudflare's differs; which operations do is settled per domain.
- **There is no preview step and no plan digest.** The harness's approval of
  the arguments, with `targets` naming the account and the object, is the
  confirmation. A consumer that shows its own approval card builds it from the
  read tools, outside this package; a preview through a write tool would also
  cost an approval of its own in an MCP client.

## Toolsets

- **One per domain**: `account`, `zones`, `dns`, `rules`, `analytics`,
  `workers`, `pages`, `storage`, `tunnels`, `email`, one per other product,
  and the content toolsets, which are never on by default.
- **`account`, `zones`, `dns`, `workers` and `pages` are on by default.** The
  package holds some 30 to 40 tools, and these five, about 15, cover running
  a site or an app; the rest is one setting away.
