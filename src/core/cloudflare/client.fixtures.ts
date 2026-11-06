import { ToolError } from "../errors"
import { cloudflareClient, type ClientOptions, type CloudflareClient } from "./client"
import { ACCOUNT_VAR_PREFIX, TOKEN_VAR_PREFIX, type Env } from "./credentials"
import { fakeCloudflare, ok, type FakeRequest, type FakeRoute } from "./testing"

export const ACCOUNT_ID = "0".repeat(31) + "a"
export const ZONE_ID = "f".repeat(32)
export const USER_TOKEN = "cfut_" + "a1".repeat(20)
export const ACCOUNT_TOKEN = "cfat_" + "b2".repeat(20)
export const LEGACY_TOKEN = "L".repeat(40)
export const OTHER_TOKEN = "cfat_" + "c3".repeat(20)

export const AUDIT_PATH = `/accounts/${ACCOUNT_ID}/logs/audit`
export const VERIFY_USER_PATH = "/user/tokens/verify"
export const VERIFY_ACCOUNT_PATH = `/accounts/${ACCOUNT_ID}/tokens/verify`

/** A verify reply for a token with the given status. */
export function tokenStatus(status: string) {
  return ok({ id: "token-id", status, expires_on: null, not_before: null })
}

/** The route table entry for a verify endpoint answering with the given status. */
export function verifyRoute(path: string, status: string): FakeRoute {
  return { method: "GET", path, reply: tokenStatus(status) }
}

export function envFor(token: string = USER_TOKEN): Env {
  return { [TOKEN_VAR_PREFIX]: token, [ACCOUNT_VAR_PREFIX]: ACCOUNT_ID }
}

/** A client for the unlabeled pair holding `token`, wired to a fake Cloudflare that answers `routes`. */
export function clientFor(
  routes: FakeRoute[],
  options: ClientOptions & { token?: string } = {},
): { client: CloudflareClient; requests: FakeRequest[] } {
  const { token = USER_TOKEN, ...clientOptions } = options
  const { fetch, requests } = fakeCloudflare(routes)
  const client = cloudflareClient(undefined, { fetch, env: envFor(token), ...clientOptions })
  return { client, requests }
}

/** What a promise rejected with; fails when it resolved. */
export async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error("Expected the promise to reject, but it resolved")
}

/** The `ToolError` a promise rejected with; fails when it rejected with anything else. */
export async function toolError(promise: Promise<unknown>): Promise<ToolError> {
  const error = await rejection(promise)
  if (!(error instanceof ToolError)) throw new Error(`Expected a ToolError, got ${String(error)}`, { cause: error })
  return error
}
