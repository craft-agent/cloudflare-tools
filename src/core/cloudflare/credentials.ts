import { ToolError } from "../errors"

/** The kind of Cloudflare API token. */
export type TokenKind = "user" | "account" | "legacy"

/** One usable pair; `token` must never be returned by a tool. */
export type Credential = { label: string; accountId: string; token: string; kind: TokenKind }

/** What `listCredentials` reports per pair, without the token. */
export type CredentialEntry = {
  label: string
  account_id: string | null
  token_kind: TokenKind | null
  default: boolean
  problem: string | null
}

/** A variable that cannot be used, and why. */
export type CredentialProblem = { variable: string; problem: string }

/** Environment variables mapped to their values. */
export type Env = Record<string, string | undefined>

/** The label for the default, unlabeled Cloudflare credential pair. */
export const DEFAULT_LABEL = "default"

/** The environment variable name (or prefix) for API tokens. */
export const TOKEN_VAR_PREFIX = "CLOUDFLARE_API_TOKEN"

/** The environment variable name (or prefix) for account IDs. */
export const ACCOUNT_VAR_PREFIX = "CLOUDFLARE_ACCOUNT_ID"

const SUFFIX_PATTERN = /^[A-Z0-9](?:[A-Z0-9_]{0,22}[A-Z0-9])?$/
const ACCOUNT_ARG_PATTERN = /^[a-z0-9](?:[a-z0-9_]{0,22}[a-z0-9])?$/
const ACCOUNT_ID_PATTERN = /^[0-9a-fA-F]{32}$/
const MIN_MASK_LENGTH = 8

function envVarName(prefix: string, label: string): string {
  return label === DEFAULT_LABEL ? prefix : `${prefix}_${label.toUpperCase()}`
}

type TokenClassification = { kind: TokenKind; problem: null } | { kind: null; problem: string }

function classifyToken(tokenVar: string, rawToken: string): TokenClassification {
  const token = rawToken.trim()
  if (/^cfk_/.test(token) || /^[0-9a-f]{37,45}$/.test(token)) {
    return {
      kind: null,
      problem: `${tokenVar} holds a Global API Key, which these tools refuse; create an API token instead`,
    }
  }
  if (/^cfoat_/.test(token)) {
    return {
      kind: null,
      problem: `${tokenVar} holds an OAuth token from wrangler login, which these tools refuse; create an API token instead`,
    }
  }
  if (/^cfut_[A-Za-z0-9_-]{40,}$/.test(token)) return { kind: "user", problem: null }
  if (/^cfat_[A-Za-z0-9_-]{40,}$/.test(token)) return { kind: "account", problem: null }
  if (/^[A-Za-z0-9_-]{40}$/.test(token)) return { kind: "legacy", problem: null }
  return { kind: null, problem: `${tokenVar} is not a Cloudflare API token` }
}

type UsablePair = Credential & { problem: null }
type BrokenPair = {
  label: string
  accountId: string | null
  token: string | null
  kind: TokenKind | null
  problem: string
}
type ParsedPair = UsablePair | BrokenPair

type SuffixResult = { ok: true; label: string } | { ok: false; problem: string }

function parseVarSuffix(key: string, prefix: string): SuffixResult | undefined {
  if (key === prefix) return { ok: true, label: DEFAULT_LABEL }
  if (!key.startsWith(`${prefix}_`)) return undefined
  const suffix = key.slice(prefix.length + 1)
  if (suffix === "DEFAULT") return { ok: false, problem: '"default" names the unlabeled pair, so it is not a label' }
  if (!SUFFIX_PATTERN.test(suffix)) {
    return {
      ok: false,
      problem: "labels are 1 to 24 lowercase letters, digits and _ written in capitals in the variable",
    }
  }
  return { ok: true, label: suffix.toLowerCase() }
}

function parseCredentials(env: Env): { pairs: ParsedPair[]; problems: CredentialProblem[] } {
  const problems: CredentialProblem[] = []
  const tokenVars = new Map<string, { varName: string; value: string }>()
  const accountVars = new Map<string, { varName: string; value: string }>()

  for (const [key, rawValue] of Object.entries(env)) {
    if (rawValue === undefined) continue
    const trimmed = rawValue.trim()
    if (trimmed === "") continue

    const tokenMatch = parseVarSuffix(key, TOKEN_VAR_PREFIX)
    if (tokenMatch) {
      if (!tokenMatch.ok) problems.push({ variable: key, problem: tokenMatch.problem })
      else tokenVars.set(tokenMatch.label, { varName: key, value: trimmed })
      continue
    }

    const accountMatch = parseVarSuffix(key, ACCOUNT_VAR_PREFIX)
    if (accountMatch) {
      if (!accountMatch.ok) problems.push({ variable: key, problem: accountMatch.problem })
      else accountVars.set(accountMatch.label, { varName: key, value: trimmed })
    }
  }

  const pairs: ParsedPair[] = []

  for (const [label, tokenEntry] of tokenVars.entries()) {
    const acctVar = envVarName(ACCOUNT_VAR_PREFIX, label)
    const accountEntry = accountVars.get(label)

    let accountId: string | null = null
    let problem: string | null = null

    if (!accountEntry) {
      problem = `${acctVar} is not set`
    } else if (!ACCOUNT_ID_PATTERN.test(accountEntry.value)) {
      problem = `${acctVar} is not a 32-character account id`
    } else {
      accountId = accountEntry.value.toLowerCase()
    }

    const classification = classifyToken(tokenEntry.varName, tokenEntry.value)
    const activeProblem = problem ?? classification.problem

    if (activeProblem !== null) {
      pairs.push({
        label,
        accountId,
        token: tokenEntry.value,
        kind: classification.kind,
        problem: activeProblem,
      })
    } else if (accountId !== null && classification.kind !== null) {
      pairs.push({
        label,
        accountId,
        token: tokenEntry.value,
        kind: classification.kind,
        problem: null,
      })
    }
  }

  for (const [label, accountEntry] of accountVars.entries()) {
    if (!tokenVars.has(label)) {
      problems.push({ variable: accountEntry.varName, problem: `${envVarName(TOKEN_VAR_PREFIX, label)} is not set` })
    }
  }

  problems.sort((a, b) => a.variable.localeCompare(b.variable))

  return { pairs, problems }
}

function orderPairs(pairs: ParsedPair[]) {
  const defaultPair = pairs.find((p) => p.label === DEFAULT_LABEL)
  const labeled = pairs.filter((p) => p.label !== DEFAULT_LABEL).sort((a, b) => a.label.localeCompare(b.label))
  return {
    sorted: defaultPair ? [defaultPair, ...labeled] : labeled,
    defaultPick: defaultPair ?? (labeled.length === 1 ? labeled[0] : undefined),
    labeled,
  }
}

/** Lists all discovered Cloudflare credentials and problems without exposing tokens. */
export function listCredentials(env?: Env): { accounts: CredentialEntry[]; problems: CredentialProblem[] } {
  const { pairs, problems } = parseCredentials(env ?? process.env)
  const { sorted, defaultPick } = orderPairs(pairs)

  const accounts: CredentialEntry[] = sorted.map((pair) => ({
    label: pair.label,
    account_id: pair.accountId,
    token_kind: pair.kind,
    default: pair === defaultPick,
    problem: pair.problem,
  }))

  return { accounts, problems }
}

/** Resolves the credential for an account label, or the default account if omitted. */
export function resolveCredential(account: string | undefined, env?: Env): Credential {
  const { pairs } = parseCredentials(env ?? process.env)
  const { sorted, defaultPick, labeled } = orderPairs(pairs)

  let picked: ParsedPair | undefined

  if (account !== undefined) {
    if (account !== DEFAULT_LABEL && !ACCOUNT_ARG_PATTERN.test(account)) {
      throw new ToolError(
        "invalid_argument",
        `Account label "${account}" is invalid; labels are 1 to 24 lowercase letters, digits and _ starting and ending with a letter or digit.`,
      )
    }

    picked = sorted.find((p) => p.label === account)
    if (!picked) {
      const setList = sorted.length > 0 ? `set: ${sorted.map((p) => p.label).join(", ")}` : "none is set"
      throw new ToolError("invalid_argument", `No Cloudflare account "${account}" is set; ${setList}`)
    }
  } else if (defaultPick) {
    picked = defaultPick
  } else if (labeled.length === 0) {
    throw new ToolError(
      "unauthenticated",
      "No Cloudflare credentials are set: set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID, or CLOUDFLARE_API_TOKEN_<LABEL> and CLOUDFLARE_ACCOUNT_ID_<LABEL>.",
    )
  } else {
    const labelList = labeled.map((p) => p.label).join(", ")
    throw new ToolError(
      "invalid_argument",
      `Several Cloudflare accounts are set (${labelList}); pick one with account.`,
    )
  }

  if (picked.problem !== null) {
    throw new ToolError("unauthenticated", picked.problem)
  }

  return { label: picked.label, accountId: picked.accountId, token: picked.token, kind: picked.kind }
}

/** Returns every non-empty trimmed value of CLOUDFLARE_API_TOKEN* (at least 8 chars) for masking. */
export function credentialValues(env?: Env): string[] {
  const values: string[] = []

  for (const [key, rawValue] of Object.entries(env ?? process.env)) {
    if (rawValue === undefined) continue
    if (key === TOKEN_VAR_PREFIX || key.startsWith(`${TOKEN_VAR_PREFIX}_`)) {
      const trimmed = rawValue.trim()
      if (trimmed.length >= MIN_MASK_LENGTH) {
        values.push(trimmed)
      }
    }
  }

  return values
}
