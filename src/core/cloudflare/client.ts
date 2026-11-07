import { ToolError, isAbortError, isToolError, type ErrorCode } from "../errors"
import { abortError } from "../exec"
import { credentialValues, resolveCredential, type Credential, type Env } from "./credentials"
import { graphqlFailure, scrubTokenIds } from "./graphql"
import { maskCredentials } from "./mask"
import { describeErrors, isPlainObject, mapStrings, parseEnvelope, type Received, type ResultInfo } from "./reply"
import { ROUTES, isAllowed, type Route } from "./routes"
import { BASE_URL, buildQuery, fillPath, type QueryValue } from "./url"

/** How long one call may wait for Cloudflare, in milliseconds. */
export const DEFAULT_TIMEOUT_MS = 30_000

const MS_PER_SECOND = 1000
const HTTP_OK_MIN = 200
const HTTP_REDIRECT_MIN = 300
const HTTP_REDIRECT_MAX = 399
const SECONDS_PATTERN = /^\d+$/
const REJECTED_TOKEN_MESSAGE = "Cloudflare does not accept the token"
const JSON_ACCEPT = "application/json"
const TEXT_ACCEPT = "text/plain, application/json"

function isSuccessStatus(status: number): boolean {
  return status >= HTTP_OK_MIN && status < HTTP_REDIRECT_MIN
}

/** The `fetch` the client calls through; tests pass a fake. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

export type RequestOptions = {
  /** Values for the `{name}` parts of the route's path, other than `account_id`. */
  path?: Record<string, string>
  query?: Record<string, QueryValue>
  /** Sent as JSON. */
  body?: unknown
}

/** What a successful call returns, with every string masked. */
export type Reply<T> = { result: T; resultInfo: ResultInfo | undefined }

/** A token's own status, as its verify endpoint reports it. */
export type TokenStatus = { id: string; status: string; expires_on: string | null; not_before: string | null }

export type ClientOptions = {
  /** Defaults to `globalThis.fetch`, read at call time. */
  fetch?: FetchLike
  /** Where credentials are masked from; defaults to `process.env`, read at call time. */
  env?: Env
  /** Defaults to `DEFAULT_TIMEOUT_MS`. */
  timeoutMs?: number
  /** Cancels the call; the call then rejects with an `AbortError`. */
  signal?: AbortSignal
}

/** Dependencies a tool can inject into Cloudflare calls; tests pass a fake fetch and env. */
export type CloudflareDeps = Pick<ClientOptions, "fetch" | "env">

/** The one way a tool reaches Cloudflare: allowlisted routes, no redirect, a time limit, mapped failures and masked text. */
export class CloudflareClient {
  readonly label: string
  readonly accountId: string
  readonly #credential: Credential
  readonly #options: ClientOptions

  constructor(credential: Credential, options: ClientOptions = {}) {
    this.#credential = credential
    this.#options = options
    this.label = credential.label
    this.accountId = credential.accountId
  }

  /** Calls one allowlisted route and returns its masked result. A failure throws a `ToolError`; a cancellation throws an `AbortError`. */
  request<T = unknown>(route: Route, options: RequestOptions = {}): Promise<Reply<T>> {
    return this.#call<T>(route, options, true)
  }

  /**
   * Like `request`, for a route whose success reply is plain text rather than the JSON envelope (a zone file).
   * Returns the masked text; a failure, including a JSON envelope that reports one, throws as in `request`.
   */
  async requestText(route: Route, options: RequestOptions = {}): Promise<string> {
    return this.#readText(await this.#dispatch(route, options, TEXT_ACCEPT))
  }

  /**
   * Runs one GraphQL query (`POST /graphql`) and returns its `data`, every string masked.
   * A reply with any `errors` is a failure (see `graphqlFailure`), also on HTTP 200; other failures throw as in `request`.
   */
  async requestGraphql<T = Record<string, unknown>>(query: string, variables: Record<string, unknown>): Promise<T> {
    const received = await this.#dispatch(ROUTES.graphql, { body: { query, variables } }, JSON_ACCEPT)
    const { status } = received
    this.#refuseRedirect(status)
    const envelope = parseEnvelope(received.text)
    if (!envelope) throw this.#notAnEnvelope(status)
    if (!isSuccessStatus(status)) {
      return this.#fail(received, scrubTokenIds(describeErrors(envelope, received)), true)
    }
    const { errors, data }: Record<string, unknown> = envelope
    if (Array.isArray(errors) && errors.length > 0) {
      const failure = graphqlFailure(errors)
      throw this.#error(failure.code, failure.message)
    }
    if (!isPlainObject(data)) {
      throw this.#error("upstream_error", "Cloudflare answered the analytics query without data")
    }
    return mapStrings(data, (text) => this.#mask(text)) as T
  }

  /** The token's own status, from the verify endpoint of its kind. */
  async verifyToken(): Promise<TokenStatus> {
    const { kind } = this.#credential
    if (kind === "user") return this.#verify(ROUTES.verifyUserToken)
    if (kind === "account") return this.#verify(ROUTES.verifyAccountToken)
    try {
      return await this.#verify(ROUTES.verifyUserToken)
    } catch (error) {
      if (isToolError(error) && error.code === "unauthenticated") return this.#verify(ROUTES.verifyAccountToken)
      throw error
    }
  }

  async #verify(route: Route): Promise<TokenStatus> {
    const { result } = await this.#call<Partial<TokenStatus> | null>(route, {}, false)
    if (!isPlainObject(result) || typeof result.id !== "string" || typeof result.status !== "string") {
      throw this.#error("upstream_error", "Cloudflare answered the token check with an unexpected body")
    }
    return {
      id: result.id,
      status: result.status,
      expires_on: result.expires_on ?? null,
      not_before: result.not_before ?? null,
    }
  }

  #error(code: ErrorCode, message: string): ToolError {
    return new ToolError(code, this.#mask(message))
  }

  #mask(text: string): string {
    return maskCredentials(text, [this.#credential.token, ...credentialValues(this.#options.env)])
  }

  async #call<T>(route: Route, options: RequestOptions, verifyOnAuthFailure: boolean): Promise<Reply<T>> {
    const received = await this.#dispatch(route, options, JSON_ACCEPT)
    return this.#read<T>(received, verifyOnAuthFailure)
  }

  async #dispatch(route: Route, options: RequestOptions, accept: string): Promise<Received> {
    if (!isAllowed(route)) {
      throw this.#error("internal_error", `${route.method} ${route.path} is not an allowed Cloudflare route.`)
    }
    let path: string
    try {
      path = fillPath(route, this.#credential.accountId, options.path)
    } catch (error) {
      throw isToolError(error) ? this.#error(error.code, error.message) : error
    }
    const query = options.query ? buildQuery(options.query) : ""
    const url = `${BASE_URL}${path}${query ? `?${query}` : ""}`

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.#credential.token}`,
      Accept: accept,
    }
    const init: RequestInit = { method: route.method, headers, redirect: "manual" }
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json"
      init.body = JSON.stringify(options.body)
    }

    return this.#send(url, init)
  }

  async #send(url: string, init: RequestInit): Promise<Received> {
    const timeoutMs = this.#options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const callerSignal = this.#options.signal
    const timeout = new AbortController()
    const timer = setTimeout(() => timeout.abort(), timeoutMs)
    const signal = callerSignal ? AbortSignal.any([callerSignal, timeout.signal]) : timeout.signal
    try {
      const send = this.#options.fetch ?? globalThis.fetch
      const response = await send(url, { ...init, signal })
      const isRedirect = response.status >= HTTP_REDIRECT_MIN && response.status <= HTTP_REDIRECT_MAX
      if (isRedirect) await response.body?.cancel()
      return {
        status: response.status,
        statusText: response.statusText,
        retryAfter: response.headers.get("retry-after"),
        text: isRedirect ? "" : await response.text(),
      }
    } catch (error) {
      if (callerSignal?.aborted) throw abortError(callerSignal)
      if (timeout.signal.aborted) {
        throw this.#error("upstream_error", `Cloudflare did not answer within ${timeoutMs / MS_PER_SECOND} s`)
      }
      const reason = error instanceof Error ? error.message : String(error)
      throw this.#error("upstream_error", `Cloudflare could not be reached: ${reason}`)
    } finally {
      clearTimeout(timer)
    }
  }

  async #read<T>(received: Received, verifyOnAuthFailure: boolean): Promise<Reply<T>> {
    const { status } = received
    this.#refuseRedirect(status)
    const envelope = parseEnvelope(received.text)
    if (!envelope) throw this.#notAnEnvelope(status)
    if (isSuccessStatus(status) && envelope.success !== false) {
      return {
        result: mapStrings(envelope.result, (text) => this.#mask(text)) as T,
        resultInfo: mapStrings(envelope.result_info, (text) => this.#mask(text)) as ResultInfo | undefined,
      }
    }
    return this.#fail(received, describeErrors(envelope, received), verifyOnAuthFailure)
  }

  async #readText(received: Received): Promise<string> {
    const { status } = received
    this.#refuseRedirect(status)
    const envelope = parseEnvelope(received.text)
    if (isSuccessStatus(status) && envelope?.success !== false) return this.#mask(received.text)
    if (!envelope) throw this.#notAnEnvelope(status)
    return this.#fail(received, describeErrors(envelope, received), true)
  }

  #refuseRedirect(status: number): void {
    if (status >= HTTP_REDIRECT_MIN && status <= HTTP_REDIRECT_MAX) {
      throw this.#error("upstream_error", "Cloudflare answered with a redirect, which is never followed")
    }
  }

  #notAnEnvelope(status: number): ToolError {
    return this.#error("upstream_error", `Cloudflare answered HTTP ${status} with a body that is not a JSON object`)
  }

  async #fail(received: Received, message: string, verifyOnAuthFailure: boolean): Promise<never> {
    switch (received.status) {
      case 400:
        throw this.#error("invalid_argument", message)
      case 404:
        throw this.#error("not_found", message)
      case 429: {
        const wait = received.retryAfter?.trim()
        throw this.#error(
          "rate_limited",
          wait && SECONDS_PATTERN.test(wait) ? `${message} (retry after ${wait} s)` : message,
        )
      }
      case 401:
      case 403:
        return this.#failAuth(received.status, message, verifyOnAuthFailure)
      default:
        throw this.#error("upstream_error", `Cloudflare answered HTTP ${received.status}: ${message}`)
    }
  }

  async #failAuth(status: number, message: string, verifyOnAuthFailure: boolean): Promise<never> {
    if (!verifyOnAuthFailure) {
      throw status === 401 ? this.#error("unauthenticated", REJECTED_TOKEN_MESSAGE) : this.#error("forbidden", message)
    }
    let verified: TokenStatus
    try {
      verified = await this.verifyToken()
    } catch (error) {
      if (isAbortError(error)) throw error
      if (isToolError(error) && error.code === "unauthenticated") {
        throw this.#error("unauthenticated", REJECTED_TOKEN_MESSAGE)
      }
      throw this.#error("forbidden", message)
    }
    if (verified.status === "active") {
      throw this.#error("forbidden", `${message} (the token is active but lacks a permission this call needs)`)
    }
    throw this.#error("unauthenticated", `Cloudflare reports the token is ${verified.status}; re-enable or replace it.`)
  }
}

/** Resolves the credential `account` names (see `resolveCredential`) and returns a client for it. */
export function cloudflareClient(account: string | undefined, options: ClientOptions = {}): CloudflareClient {
  return new CloudflareClient(resolveCredential(account, options.env), options)
}
