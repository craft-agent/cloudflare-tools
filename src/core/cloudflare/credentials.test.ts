import { describe, expect, test } from "bun:test"
import { ToolError, type ErrorCode } from "../errors"
import { DEFAULT_LABEL, credentialValues, listCredentials, resolveCredential, type Env } from "./credentials"

const VALID_ACCOUNT_ID = "0123456789abcdef0123456789abcdef"
const USER_TOKEN = "cfut_" + "a1".repeat(20)
const ACCOUNT_TOKEN = "cfat_" + "b2".repeat(20)
const LEGACY_TOKEN = "L".repeat(40)
const GLOBAL_KEY_PREFIX = "cfk_" + "c3".repeat(10)
const GLOBAL_KEY_HEX = "0123456789abcdef".repeat(3).slice(0, 37)
const OAUTH_TOKEN = "cfoat_" + "d4".repeat(10)
const SHORT_TOKEN = "short"

function expectToolError(fn: () => unknown, code: ErrorCode, message?: string) {
  let thrown: unknown
  try {
    fn()
  } catch (err) {
    thrown = err
  }
  expect(thrown).toBeInstanceOf(ToolError)
  const toolErr = thrown as ToolError
  expect(toolErr.code).toBe(code)
  if (message !== undefined) expect(toolErr.message).toBe(message)
}

describe("credentials", () => {
  test("unlabeled pair only", () => {
    const env: Env = {
      CLOUDFLARE_API_TOKEN: `  ${USER_TOKEN}  `,
      CLOUDFLARE_ACCOUNT_ID: `  ${VALID_ACCOUNT_ID.toUpperCase()}  `,
    }

    const { accounts, problems } = listCredentials(env)
    expect(problems).toEqual([])
    expect(accounts).toEqual([
      { label: DEFAULT_LABEL, account_id: VALID_ACCOUNT_ID, token_kind: "user", default: true, problem: null },
    ])
    expect(resolveCredential(undefined, env)).toEqual({
      label: DEFAULT_LABEL,
      accountId: VALID_ACCOUNT_ID,
      token: USER_TOKEN,
      kind: "user",
    })
  })

  test("single labeled pair only", () => {
    const env: Env = { CLOUDFLARE_API_TOKEN_PROD: ACCOUNT_TOKEN, CLOUDFLARE_ACCOUNT_ID_PROD: VALID_ACCOUNT_ID }
    const { accounts, problems } = listCredentials(env)
    expect(problems).toEqual([])
    expect(accounts).toEqual([
      { label: "prod", account_id: VALID_ACCOUNT_ID, token_kind: "account", default: true, problem: null },
    ])

    const cred = resolveCredential(undefined, env)
    expect(cred.label).toBe("prod")
    expect(cred.kind).toBe("account")
  })

  test("several labeled pairs only", () => {
    const env: Env = {
      CLOUDFLARE_API_TOKEN_WORK: USER_TOKEN,
      CLOUDFLARE_ACCOUNT_ID_WORK: VALID_ACCOUNT_ID,
      CLOUDFLARE_API_TOKEN_BETA: ACCOUNT_TOKEN,
      CLOUDFLARE_ACCOUNT_ID_BETA: VALID_ACCOUNT_ID,
    }

    const { accounts, problems } = listCredentials(env)
    expect(problems).toEqual([])
    expect(accounts.map((a) => a.label)).toEqual(["beta", "work"])
    expect(accounts.every((a) => a.default === false)).toBe(true)

    expectToolError(
      () => resolveCredential(undefined, env),
      "invalid_argument",
      "Several Cloudflare accounts are set (beta, work); pick one with account.",
    )
  })

  test("both unlabeled and labeled pairs: omitted picks default, label picks specific", () => {
    const env: Env = {
      CLOUDFLARE_API_TOKEN: USER_TOKEN,
      CLOUDFLARE_ACCOUNT_ID: VALID_ACCOUNT_ID,
      CLOUDFLARE_API_TOKEN_WORK: ACCOUNT_TOKEN,
      CLOUDFLARE_ACCOUNT_ID_WORK: VALID_ACCOUNT_ID,
    }

    const { accounts } = listCredentials(env)
    expect(accounts.map((a) => a.label)).toEqual(["default", "work"])
    expect(accounts[0].default).toBe(true)
    expect(accounts[1].default).toBe(false)

    expect(resolveCredential(undefined, env).label).toBe("default")
    expect(resolveCredential("work", env).label).toBe("work")
    expect(resolveCredential("default", env).label).toBe("default")
  })

  test("zero pairs throws unauthenticated", () => {
    expectToolError(
      () => resolveCredential(undefined, {}),
      "unauthenticated",
      "No Cloudflare credentials are set: set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID, or CLOUDFLARE_API_TOKEN_<LABEL> and CLOUDFLARE_ACCOUNT_ID_<LABEL>.",
    )
  })

  test("unknown label throws invalid_argument with available list", () => {
    const env: Env = { CLOUDFLARE_API_TOKEN: USER_TOKEN, CLOUDFLARE_ACCOUNT_ID: VALID_ACCOUNT_ID }
    expectToolError(
      () => resolveCredential("staging", env),
      "invalid_argument",
      'No Cloudflare account "staging" is set; set: default',
    )
    expectToolError(
      () => resolveCredential("staging", {}),
      "invalid_argument",
      'No Cloudflare account "staging" is set; none is set',
    )
  })

  test("malformed account argument throws invalid_argument", () => {
    expectToolError(() => resolveCredential("INVALID_LABEL", {}), "invalid_argument")
    expectToolError(() => resolveCredential("_start", {}), "invalid_argument")
  })

  test("invalid and reserved suffixes go to problems", () => {
    const env: Env = {
      CLOUDFLARE_API_TOKEN_DEFAULT: USER_TOKEN,
      CLOUDFLARE_ACCOUNT_ID_DEFAULT: VALID_ACCOUNT_ID,
      CLOUDFLARE_API_TOKEN_BAD_SUFFIX_: USER_TOKEN,
      CLOUDFLARE_ACCOUNT_ID_BAD_SUFFIX_: VALID_ACCOUNT_ID,
    }

    const badSuffixMsg = "labels are 1 to 24 lowercase letters, digits and _ written in capitals in the variable"
    const defaultMsg = '"default" names the unlabeled pair, so it is not a label'
    const { accounts, problems } = listCredentials(env)
    expect(accounts).toEqual([])
    expect(problems).toEqual([
      { variable: "CLOUDFLARE_ACCOUNT_ID_BAD_SUFFIX_", problem: badSuffixMsg },
      { variable: "CLOUDFLARE_ACCOUNT_ID_DEFAULT", problem: defaultMsg },
      { variable: "CLOUDFLARE_API_TOKEN_BAD_SUFFIX_", problem: badSuffixMsg },
      { variable: "CLOUDFLARE_API_TOKEN_DEFAULT", problem: defaultMsg },
    ])
  })

  test("missing or malformed account id", () => {
    const env1: Env = { CLOUDFLARE_API_TOKEN: USER_TOKEN }
    expect(listCredentials(env1).accounts[0].problem).toBe("CLOUDFLARE_ACCOUNT_ID is not set")
    expectToolError(() => resolveCredential(undefined, env1), "unauthenticated", "CLOUDFLARE_ACCOUNT_ID is not set")

    const env2: Env = { CLOUDFLARE_API_TOKEN: USER_TOKEN, CLOUDFLARE_ACCOUNT_ID: "not-a-32-hex-id" }
    expect(listCredentials(env2).accounts[0].problem).toBe("CLOUDFLARE_ACCOUNT_ID is not a 32-character account id")
    expectToolError(
      () => resolveCredential(undefined, env2),
      "unauthenticated",
      "CLOUDFLARE_ACCOUNT_ID is not a 32-character account id",
    )
  })

  test("account id variable without token variable goes to problems", () => {
    const env: Env = { CLOUDFLARE_ACCOUNT_ID: VALID_ACCOUNT_ID, CLOUDFLARE_ACCOUNT_ID_PROD: VALID_ACCOUNT_ID }
    const { accounts, problems } = listCredentials(env)
    expect(accounts).toEqual([])
    expect(problems).toEqual([
      { variable: "CLOUDFLARE_ACCOUNT_ID", problem: "CLOUDFLARE_API_TOKEN is not set" },
      { variable: "CLOUDFLARE_ACCOUNT_ID_PROD", problem: "CLOUDFLARE_API_TOKEN_PROD is not set" },
    ])
  })

  test("token kinds and refused tokens", () => {
    const checkKind = (token: string) => {
      const { accounts } = listCredentials({ CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: VALID_ACCOUNT_ID })
      return { kind: accounts[0].token_kind, problem: accounts[0].problem }
    }

    expect(checkKind(USER_TOKEN)).toEqual({ kind: "user", problem: null })
    expect(checkKind(ACCOUNT_TOKEN)).toEqual({ kind: "account", problem: null })
    expect(checkKind(LEGACY_TOKEN)).toEqual({ kind: "legacy", problem: null })

    const globalKeyMsg =
      "CLOUDFLARE_API_TOKEN holds a Global API Key, which these tools refuse; create an API token instead"
    expect(checkKind(GLOBAL_KEY_PREFIX)).toEqual({ kind: null, problem: globalKeyMsg })
    expect(checkKind(GLOBAL_KEY_HEX)).toEqual({ kind: null, problem: globalKeyMsg })
    expect(checkKind(OAUTH_TOKEN)).toEqual({
      kind: null,
      problem:
        "CLOUDFLARE_API_TOKEN holds an OAuth token from wrangler login, which these tools refuse; create an API token instead",
    })
    expect(checkKind("unknown-token-shape")).toEqual({
      kind: null,
      problem: "CLOUDFLARE_API_TOKEN is not a Cloudflare API token",
    })
  })

  test("credential values collects valid tokens >= 8 chars including invalid suffixes", () => {
    const env: Env = {
      CLOUDFLARE_API_TOKEN: USER_TOKEN,
      CLOUDFLARE_API_TOKEN_WORK: ACCOUNT_TOKEN,
      CLOUDFLARE_API_TOKEN_INVALID_: "invalid_suffix_token_123",
      CLOUDFLARE_API_TOKEN_SHORT: SHORT_TOKEN,
      OTHER_VAR: "something_else",
    }
    const values = credentialValues(env)
    expect(values).toContain(USER_TOKEN)
    expect(values).toContain(ACCOUNT_TOKEN)
    expect(values).toContain("invalid_suffix_token_123")
    expect(values).not.toContain(SHORT_TOKEN)
    expect(values).not.toContain("something_else")
  })

  test("reads process.env at call time if env omitted", () => {
    process.env.CLOUDFLARE_API_TOKEN_CALLTIME_TEST = USER_TOKEN
    process.env.CLOUDFLARE_ACCOUNT_ID_CALLTIME_TEST = VALID_ACCOUNT_ID
    try {
      const cred = resolveCredential("calltime_test")
      expect(cred.accountId).toBe(VALID_ACCOUNT_ID)
      expect(cred.token).toBe(USER_TOKEN)
    } finally {
      delete process.env.CLOUDFLARE_API_TOKEN_CALLTIME_TEST
      delete process.env.CLOUDFLARE_ACCOUNT_ID_CALLTIME_TEST
    }
  })

  test("error messages and listCredentials never contain token value", () => {
    const secretToken = "cfut_" + "s3cr3t".repeat(8)
    const env: Env = { CLOUDFLARE_API_TOKEN: secretToken }
    expect(JSON.stringify(listCredentials(env))).not.toContain(secretToken)

    try {
      resolveCredential(undefined, env)
    } catch (err: any) {
      expect(err.message).not.toContain(secretToken)
    }
  })
})
