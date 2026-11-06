import { abortError } from "../exec"
import type { FetchLike } from "./client"
import type { ResultInfo } from "./reply"
import type { Method } from "./routes"
import { BASE_URL } from "./url"

const NOT_FOUND = 404
const NO_ROUTE_ERROR = { code: 7003, message: "No route for that URI" }

/** What the fake answers; a string `body` is sent as it is, anything else as JSON. */
export type FakeReply = { status?: number; body?: unknown; headers?: Record<string, string> }

/** One call the fake answers: a concrete path under the base URL, matched on method and path only. */
export type FakeRoute = {
  method: Method
  path: string
  reply: FakeReply | ((request: FakeRequest) => FakeReply | Promise<FakeReply>)
}

/** A call the fake received, with lowercased header names and the JSON body parsed. */
export type FakeRequest = {
  method: string
  path: string
  query: URLSearchParams
  headers: Record<string, string>
  body: unknown
}

const BASE = new URL(BASE_URL)

function toFakeRequest(url: string, init: RequestInit): { request: FakeRequest; underBase: boolean } {
  const parsed = new URL(url)
  const underBase = parsed.origin === BASE.origin && parsed.pathname.startsWith(`${BASE.pathname}/`)
  const body = typeof init.body === "string" ? (JSON.parse(init.body) as unknown) : undefined
  return {
    underBase,
    request: {
      method: init.method ?? "GET",
      path: underBase ? parsed.pathname.slice(BASE.pathname.length) : parsed.pathname,
      query: parsed.searchParams,
      headers: Object.fromEntries(new Headers(init.headers).entries()),
      body,
    },
  }
}

function untilAborted<T>(pending: Promise<T>, signal: AbortSignal | null | undefined): Promise<T> {
  if (!signal) return pending
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError(signal))
      return
    }
    signal.addEventListener("abort", () => reject(abortError(signal)), { once: true })
    pending.then(resolve, reject)
  })
}

function toResponse(reply: FakeReply): Response {
  const { status = 200, body, headers } = reply
  const isText = typeof body === "string"
  const payload = body === undefined ? null : isText ? body : JSON.stringify(body)
  return new Response(payload, {
    status,
    headers: { ...(payload !== null && !isText ? { "content-type": "application/json" } : {}), ...headers },
  })
}

/**
 * A stand-in for Cloudflare: answers the given routes, records every request,
 * and answers 404 to anything else. It honors `init.signal`, also while a
 * reply function is still pending.
 */
export function fakeCloudflare(routes: FakeRoute[]): { fetch: FetchLike; requests: FakeRequest[] } {
  const requests: FakeRequest[] = []
  const fetch: FetchLike = async (url, init) => {
    const { request, underBase } = toFakeRequest(url, init)
    requests.push(request)
    const route = underBase && routes.find((r) => r.method === request.method && r.path === request.path)
    const reply = route
      ? typeof route.reply === "function"
        ? await untilAborted(Promise.resolve(route.reply(request)), init.signal)
        : route.reply
      : fail(NOT_FOUND, [NO_ROUTE_ERROR])
    if (init.signal?.aborted) throw abortError(init.signal)
    return toResponse(reply)
  }
  return { fetch, requests }
}

/** A 200 reply in Cloudflare's envelope. */
export function ok(result: unknown, resultInfo?: ResultInfo): FakeReply {
  return { status: 200, body: { success: true, errors: [], messages: [], result, result_info: resultInfo } }
}

/** A failed reply in Cloudflare's envelope. */
export function fail(
  status: number,
  errors: Array<{ code: number; message: string }>,
  headers?: Record<string, string>,
): FakeReply {
  return { status, body: { success: false, errors, messages: [], result: null }, headers }
}
