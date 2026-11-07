import { z } from "zod"
import { accountArg } from "../cloudflare/args"
import type { CloudflareClient, CloudflareDeps } from "../cloudflare/client"
import {
  BUCKET_NAME_PATTERN,
  DATABASE_ID_PATTERN,
  NAMESPACE_ID_PATTERN,
  ROUTES,
  type Route,
} from "../cloudflare/routes"
import { ToolError } from "../errors"
import { confirmWrite, defineTool, type ToolSpec } from "../tool"
import { assertEmpty, describeStore, type Store } from "./emptiness"
import { shapeBucket } from "./shape"
import { shapeDatabase } from "./shape.d1"
import { shapeNamespace } from "./shape.kv"
import {
  clientFor,
  failureOfStoreWrite,
  KIND_INFO,
  kindSchema,
  requestForWrite,
  storeTargets,
  type Kind,
} from "./write"

/** The argument that names the store of each kind. */
const KEY_ARGS = { r2: "bucket", kv: "namespace", d1: "database" } as const satisfies Record<Kind, string>

const input = z.object({
  account: accountArg,
  kind: kindSchema,
  bucket: z.string().regex(BUCKET_NAME_PATTERN).optional().describe("r2: the bucket's name, as buckets lists it."),
  namespace: z
    .string()
    .regex(NAMESPACE_ID_PATTERN)
    .optional()
    .describe("kv: the namespace's id, as namespaces lists it."),
  database: z.string().regex(DATABASE_ID_PATTERN).optional().describe("d1: the database's id, as databases lists it."),
})

type Args = z.output<typeof input>

const output = z.object({
  label: z.string().describe("The account label."),
  deleted: z
    .strictObject({
      kind: kindSchema,
      name: z.string().nullable().describe("The bucket's name, the namespace's title or the database's name, or null."),
      id: z.string().describe("The bucket's name, the namespace's id or the database's id."),
    })
    .describe("The store as it was read before it was deleted."),
})

type DeleteSpec = ToolSpec<typeof input, typeof output>

/** A store's name and id as its read shaped them. */
type StoreIdentity = Pick<Store, "name" | "id">

function shapeBucketStore(raw: unknown): StoreIdentity | undefined {
  const bucket = shapeBucket(raw)
  return bucket && { name: bucket.name, id: bucket.name }
}

function shapeNamespaceStore(raw: unknown): StoreIdentity | undefined {
  const namespace = shapeNamespace(raw)
  return namespace && { name: namespace.title, id: namespace.id }
}

function shapeDatabaseStore(raw: unknown): StoreIdentity | undefined {
  const database = shapeDatabase(raw)
  return database && { name: database.name, id: database.id }
}

/** How each kind's store is read, shaped and deleted; `param` is the path parameter its routes take. */
const STORES: Record<
  Kind,
  { param: string; read: Route; remove: Route; shape(raw: unknown): StoreIdentity | undefined }
> = {
  r2: { param: "bucket_name", read: ROUTES.r2Bucket, remove: ROUTES.r2BucketDelete, shape: shapeBucketStore },
  kv: { param: "namespace_id", read: ROUTES.kvNamespace, remove: ROUTES.kvNamespaceDelete, shape: shapeNamespaceStore },
  d1: { param: "database_id", read: ROUTES.d1Database, remove: ROUTES.d1DatabaseDelete, shape: shapeDatabaseStore },
}

/** The key of the store `args` names: the one argument its kind takes, and none of the others. */
function storeKey(args: Args): string {
  const wanted = KEY_ARGS[args.kind]
  for (const arg of Object.values(KEY_ARGS)) {
    if (arg !== wanted && args[arg] !== undefined) {
      throw new ToolError("invalid_argument", `Kind "${args.kind}" takes \`${wanted}\`, not \`${arg}\`.`)
    }
  }
  const key = args[wanted]
  if (key === undefined) throw new ToolError("invalid_argument", `Kind "${args.kind}" requires \`${wanted}\`.`)
  return key
}

/** The store as Cloudflare holds it; a store that does not exist is `not_found`. */
async function readStore(client: CloudflareClient, kind: Kind, key: string): Promise<Store> {
  const { param, read, shape } = STORES[kind]
  const { result } = await requestForWrite<unknown>(client, kind, read, { path: { [param]: key } })
  const shaped = shape(result)
  if (!shaped) {
    throw new ToolError("upstream_error", `Cloudflare returned an unexpected ${KIND_INFO[kind].noun} response.`)
  }
  return { kind, key, ...shaped }
}

async function sendDelete(client: CloudflareClient, kind: Kind, key: string): Promise<void> {
  const { param, remove } = STORES[kind]
  try {
    await client.request<unknown>(remove, { path: { [param]: key } })
  } catch (error) {
    throw failureOfStoreWrite(error, kind, "deleted")
  }
}

/** The line the person is asked to approve; the id is named once even where the name already holds it. */
function confirmation(store: Store, accountLabel: string): string {
  const described = describeStore(store)
  const named = described.includes(store.id) ? described : `${described} (${store.id})`
  return `Delete ${named} in the Cloudflare account ${accountLabel}. It was found empty, and deleting it is for good.`
}

/** Defines the `cloudflare_storage_delete` tool spec with injected dependencies. */
export function defineStorageDelete(deps?: CloudflareDeps): DeleteSpec {
  const spec: DeleteSpec = defineTool({
    id: "cloudflare_storage_delete",
    title: "Delete an empty Cloudflare R2 bucket, KV namespace or D1 database",
    description: [
      "Delete an R2 bucket, Workers KV namespace or D1 database, only when it is proven empty; the tool always asks first, since deleting is for good.",
      "Name the store by the id the lists give: `bucket` for r2, `namespace` for kv, `database` for d1; the other two are refused.",
      "The tool reads the store first (one that does not exist is not_found), then proves it empty: an R2 bucket holds no object, a KV namespace holds no key in its listing (up to 20 pages of 1000), a D1 database holds no table; a store that is not empty is refused and nothing is deleted.",
      "Cloudflare itself deletes a KV namespace or D1 database with its contents, so this check is what keeps them; what is written between the check and the delete is lost with the store.",
      "Cloudflare also refuses an R2 bucket that still holds objects or unfinished multipart uploads.",
      "Token permissions: Account → Workers R2 Storage → Edit, Account → Workers KV Storage → Edit, or Account → D1 → Edit, for the store being deleted.",
      "The result returns the store as it was read before the delete.",
      "Creating a store is cloudflare_storage_create.",
    ].join(" "),
    toolset: "storage",
    class: "administrative",
    input,
    output,
    targets: (args, ctx) => storeTargets(args.account, args.kind, () => storeKey(args), ctx, deps),
    async execute(args, ctx) {
      const key = storeKey(args)
      const client = clientFor(args.account, ctx, deps)

      const store = await readStore(client, args.kind, key)
      await assertEmpty(client, store)
      await confirmWrite(spec, ctx, confirmation(store, client.label))
      // An answer can take minutes; prove it again so the delete acts on what was approved.
      if (ctx.confirm) await assertEmpty(client, store)

      await sendDelete(client, args.kind, key)
      return { label: client.label, deleted: { kind: store.kind, name: store.name, id: store.id } }
    },
  })
  return spec
}

export const cloudflareStorageDelete = defineStorageDelete()
