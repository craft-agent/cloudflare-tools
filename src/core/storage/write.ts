import { z } from "zod"
import {
  cloudflareClient,
  type CloudflareClient,
  type CloudflareDeps,
  type RequestOptions,
  type Reply,
} from "../cloudflare/client"
import { sentence } from "../cloudflare/graphql"
import { failureOfWrite } from "../cloudflare/refusal"
import type { Route } from "../cloudflare/routes"
import { isAbortError, isToolError, ToolError } from "../errors"
import { ANY_TARGET } from "../targets"
import type { ToolContext } from "../tool"

/** The kinds of store the write tools handle. */
export const KINDS = ["r2", "kv", "d1"] as const

export type Kind = (typeof KINDS)[number]

/** What a write did, as its messages say it. */
export type Done = "created" | "deleted"

export const kindSchema = z
  .enum(KINDS)
  .describe('The kind of store: "r2" (a bucket), "kv" (a namespace) or "d1" (a database).')

type KindInfo = {
  /** What the kind's store is called in a message. */
  noun: string
  /** The segment of a write target that names the kind's stores under the account. */
  segment: string
  /** The permission an Edit call needs, as a sentence. */
  permission: string
  /** The `cloudflare_storage_read` method that shows whether the write went through. */
  readMethod: Record<Done, string>
}

export const KIND_INFO: Record<Kind, KindInfo> = {
  r2: {
    noun: "R2 bucket",
    segment: "r2/buckets",
    permission: "The token needs Account → Workers R2 Storage → Edit.",
    readMethod: { created: "buckets", deleted: "bucket" },
  },
  kv: {
    noun: "KV namespace",
    segment: "kv/namespaces",
    permission: "The token needs Account → Workers KV Storage → Edit.",
    readMethod: { created: "namespaces", deleted: "namespaces" },
  },
  d1: {
    noun: "D1 database",
    segment: "d1/databases",
    permission: "The token needs Account → D1 → Edit.",
    readMethod: { created: "databases", deleted: "databases" },
  },
}

/** The client of the account `args.account` names, cancelled with the call. */
export function clientFor(account: string | undefined, ctx: ToolContext, deps?: CloudflareDeps): CloudflareClient {
  return cloudflareClient(account, { ...deps, signal: ctx.signal })
}

/** A forbidden failure gains the Edit permission the kind's write needs; any other failure passes as it is. */
function withEditHint(error: ToolError, kind: Kind): ToolError {
  if (error.code !== "forbidden") return error
  return new ToolError("forbidden", `${sentence(error.message)} ${KIND_INFO[kind].permission}`, { cause: error })
}

/** One call a write makes before its write request; a forbidden failure names the Edit permission, since the write needs it. */
export async function requestForWrite<T>(
  client: CloudflareClient,
  kind: Kind,
  route: Route,
  options: RequestOptions = {},
): Promise<Reply<T>> {
  try {
    return await client.request<T>(route, options)
  } catch (error) {
    throw isToolError(error) ? withEditHint(error, kind) : error
  }
}

/**
 * The failure of the one write request: the message ends as a sentence and gains the Edit permission when
 * forbidden, then the note that says whether anything was `done`: Cloudflare's refusal means nothing was, a
 * failure that does not tell (5xx, timeout, network) may or may not have been. A cancellation passes untouched.
 */
export function failureOfStoreWrite(error: unknown, kind: Kind, done: Done): unknown {
  if (!isToolError(error)) return error
  const hinted = withEditHint(error, kind)
  return failureOfWrite(new ToolError(hinted.code, sentence(hinted.message), { cause: error }), {
    nothing: `Nothing was ${done}.`,
    maybe: `Cloudflare may or may not have ${done} it; read cloudflare_storage_read ${KIND_INFO[kind].readMethod[done]} before sending it again.`,
  })
}

/** What a write to a store names, as the permission rules name it: the store in its account; `*` when that cannot be told. */
export function storeTargets(
  account: string | undefined,
  kind: Kind,
  store: () => string,
  ctx: ToolContext,
  deps?: CloudflareDeps,
): string[] {
  try {
    const client = clientFor(account, ctx, deps)
    return [`${client.accountId}/${KIND_INFO[kind].segment}/${store()}`]
  } catch (error) {
    if (isAbortError(error) || ctx.signal?.aborted) throw error
    return [ANY_TARGET]
  }
}
