import { z } from "zod"
import { accountArg } from "../cloudflare/args"
import type { CloudflareClient, CloudflareDeps } from "../cloudflare/client"
import { isPlainObject } from "../cloudflare/reply"
import { BUCKET_NAME_PATTERN, D1_NAME_PATTERN, ROUTES, type Route } from "../cloudflare/routes"
import { ToolError } from "../errors"
import {
  defineTool,
  StepErrors,
  stepErrorsSchema,
  type CallDescription,
  type ToolContext,
  type ToolSpec,
} from "../tool"
import { STORAGE_WORDS } from "./words"
import { clientFor, failureOfStoreWrite, KIND_INFO, kindSchema, storeTargets, type Kind } from "./write"

const KV_TITLE_MAX_LENGTH = 512
const CONTROL_CHARACTER_PATTERN = /[\x00-\x1f]/

const input = z.object({
  account: accountArg,
  kind: kindSchema,
  name: z
    .string()
    .describe(
      "The new store's name. r2: 3–63 lowercase letters, digits and `-`, starting and ending with a letter or digit. kv: the namespace's title, 1–512 characters on one line. d1: 1–63 lowercase letters, digits, `-` and `_`, starting with a letter or digit.",
    ),
})

type Args = z.output<typeof input>

const output = z.object({
  label: z.string().describe("The account label."),
  created: z
    .strictObject({
      kind: kindSchema,
      name: z
        .string()
        .describe(
          "The name the store was created with: the bucket's name, the namespace's title or the database's name.",
        ),
      id: z
        .string()
        .nullable()
        .describe(
          "The bucket's name, the namespace's id or the database's id; null when Cloudflare's reply lacked it (see `errors`).",
        ),
    })
    .describe("The new, empty store."),
  errors: stepErrorsSchema.optional(),
})

type CreateSpec = ToolSpec<typeof input, typeof output>

/** What each kind's name must look like, and the rule in words for the refusal. */
const NAME_RULES: Record<Kind, { valid(name: string): boolean; rule: string }> = {
  r2: {
    valid: (name) => BUCKET_NAME_PATTERN.test(name),
    rule: "3–63 lowercase letters, digits and `-`, starting and ending with a letter or digit",
  },
  kv: {
    valid: (name) => name.length >= 1 && name.length <= KV_TITLE_MAX_LENGTH && !CONTROL_CHARACTER_PATTERN.test(name),
    rule: `1–${KV_TITLE_MAX_LENGTH} characters on one line`,
  },
  d1: {
    valid: (name) => D1_NAME_PATTERN.test(name),
    rule: "1–63 lowercase letters, digits, `-` and `_`, starting with a letter or digit",
  },
}

/** What a request creating a store sends and where the new store's id sits in the reply. */
const CREATE: Record<Kind, { route: Route; body(name: string): Record<string, string>; idField: string | undefined }> =
  {
    r2: { route: ROUTES.r2BucketCreate, body: (name) => ({ name }), idField: undefined },
    kv: { route: ROUTES.kvNamespaceCreate, body: (title) => ({ title }), idField: "id" },
    d1: { route: ROUTES.d1DatabaseCreate, body: (name) => ({ name }), idField: "uuid" },
  }

/** The store's name as `kind` takes it, or `invalid_argument` saying the rule. */
function storeName(args: Args): string {
  const { valid, rule } = NAME_RULES[args.kind]
  if (!valid(args.name)) {
    throw new ToolError("invalid_argument", `\`name\` of a ${KIND_INFO[args.kind].noun} must be ${rule}.`)
  }
  return args.name
}

async function sendCreate(client: CloudflareClient, kind: Kind, name: string): Promise<unknown> {
  const { route, body } = CREATE[kind]
  try {
    return (await client.request<unknown>(route, { body: body(name) })).result
  } catch (error) {
    throw failureOfStoreWrite(error, kind, "created")
  }
}

/** The new store's id from Cloudflare's reply; the bucket's name is its id. */
function createdId(kind: Kind, name: string, result: unknown): string {
  const { idField } = CREATE[kind]
  if (idField === undefined) return name
  const id = isPlainObject(result) ? result[idField] : undefined
  if (typeof id !== "string" || id === "") {
    const method = KIND_INFO[kind].readMethod.created
    throw new ToolError(
      "upstream_error",
      `Cloudflare created the ${KIND_INFO[kind].noun} ${name} but its reply lacked the id; read cloudflare_storage_read ${method} to find it.`,
    )
  }
  return id
}

/** The headline template of each kind's create. */
const HEADLINES: Record<Kind, string> = {
  r2: STORAGE_WORDS.createR2,
  kv: STORAGE_WORDS.createKv,
  d1: STORAGE_WORDS.createD1,
}

/** What a call will do: the store's name as its kind takes it and the client of the account; refuses what the tool refuses before it writes. */
function planCreate(args: Args, ctx: ToolContext, deps?: CloudflareDeps) {
  const name = storeName(args)
  const client = clientFor(args.account, ctx, deps)
  return { name, client }
}

/** The description of the call: the kind and the name of the store it creates. */
async function describeCreate(args: Args, ctx: ToolContext, deps?: CloudflareDeps): Promise<CallDescription> {
  const { name } = planCreate(args, ctx, deps)
  return { headline: { text: HEADLINES[args.kind], values: { name } }, facts: [] }
}

/** Defines the `cloudflare_storage_create` tool spec with injected dependencies. */
export function defineStorageCreate(deps?: CloudflareDeps): CreateSpec {
  return defineTool({
    id: "cloudflare_storage_create",
    title: "Create a Cloudflare R2 bucket, KV namespace or D1 database",
    intent: "About to create a store",
    description: [
      "Create an empty R2 bucket, Workers KV namespace or D1 database from a name alone.",
      "Cloudflare chooses the location; no location hint, storage class or jurisdiction is sent, so the store is in the default jurisdiction only.",
      "The new store is empty, not public and bound to no Worker.",
      "No lookup comes first: Cloudflare refuses a name that is taken, and the refusal is passed on.",
      "The result holds the store's kind, name and id (the bucket's name, the namespace's id or the database's id); if Cloudflare's reply lacks the id, the store still exists, `id` is null and `errors` says how to find it.",
      "Token permissions: Account → Workers R2 Storage → Edit, Account → Workers KV Storage → Edit, or Account → D1 → Edit, for the store being created.",
      "Deleting an empty store is cloudflare_storage_delete.",
    ].join(" "),
    toolset: "storage",
    class: "add",
    input,
    output,
    targets: (args, ctx) => storeTargets(args.account, args.kind, () => storeName(args), ctx, deps),
    describe: (args, ctx) => describeCreate(args, ctx, deps),
    async execute(args, ctx) {
      const { name, client } = planCreate(args, ctx, deps)

      const result = await sendCreate(client, args.kind, name)
      const steps = new StepErrors()
      const id = await steps.record("id", async () => createdId(args.kind, name, result))
      return {
        label: client.label,
        created: { kind: args.kind, name, id: id ?? null },
        ...(steps.any ? { errors: steps.errors } : {}),
      }
    },
  })
}

export const cloudflareStorageCreate = defineStorageCreate()
