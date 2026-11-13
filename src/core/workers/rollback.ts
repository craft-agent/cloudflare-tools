import { z } from "zod"
import { accountArg } from "../cloudflare/args"
import { cloudflareClient, type CloudflareClient, type CloudflareDeps } from "../cloudflare/client"
import { failureOfWrite, refusedByCloudflare, type WriteFailureNotes } from "../cloudflare/refusal"
import { isPlainObject } from "../cloudflare/reply"
import { ROUTES } from "../cloudflare/routes"
import { ToolError, isAbortError } from "../errors"
import { ANY_TARGET } from "../targets"
import { confirmWrite, defineTool, type CallDescription, type ToolContext, type ToolSpec } from "../tool"
import {
  checkHistory,
  confirmation,
  parseRequest,
  sharesOf,
  toPercentage,
  type RollbackRequest,
} from "./rollback.checks"
import { requestScript, scriptArg, scriptName } from "./scripts"
import { deploymentSchema, shapeDeployment, type Deployment } from "./shape"
import { WORKERS_WORDS } from "./words"

const MAX_VERSIONS = 2
const PAGE_SIZE = 100
const MAX_PAGES = 10

const SECRET_MENTION = /secret/i

const WRITE_NOTES: WriteFailureNotes = {
  nothing: "Nothing was deployed.",
  maybe:
    "Cloudflare may or may not have deployed it; read cloudflare_workers_read deployments before sending it again.",
}

const input = z.object({
  account: accountArg,
  script: scriptArg,
  versions: z
    .array(
      z
        .object({
          version_id: z
            .string()
            .describe("The version's id (a UUID), as cloudflare_workers_read deployments shows it."),
          percentage: z.number().describe("The share of traffic for the version: 0.01 to 100, at most two decimals."),
        })
        .strict(),
    )
    .min(1)
    .max(MAX_VERSIONS)
    .describe(
      `The ${MAX_VERSIONS} versions at most to serve and their shares of traffic, from an earlier deployment of cloudflare_workers_read deployments (or one version at 100); the percentages add up to 100.`,
    ),
  replaces: z
    .string()
    .describe(
      "The id (a UUID) of the deployment serving now: the first of cloudflare_workers_read deployments. The call is refused as stale when another deployment came first.",
    ),
  message: z
    .string()
    .optional()
    .describe('A note for the deployment: one line of 1 to 100 characters; left out, "Rolled back".'),
})

const output = z.object({
  label: z.string().describe("The account label."),
  script: z.string().describe("The Worker's name."),
  replaced: deploymentSchema.describe("The deployment that served before."),
  deployment: deploymentSchema
    .nullable()
    .describe(
      "The new deployment: its id and what Cloudflare reports, with the versions, shares and message the call sent where Cloudflare's reply leaves them out; null when the reply names no deployment.",
    ),
})

type RollbackSpec = ToolSpec<typeof input, typeof output>

/** The new deployment: Cloudflare's reply, which may hold little more than the id, filled in from what was sent. */
function newDeployment(result: unknown, request: RollbackRequest): Deployment | null {
  if (!isPlainObject(result) || typeof result.id !== "string") return null
  const reported = shapeDeployment(result)
  return {
    ...reported,
    message: reported.message ?? request.message,
    versions:
      reported.versions.length > 0
        ? reported.versions
        : request.split.map((entry) => ({ version_id: entry.versionId, percentage: toPercentage(entry.share) })),
  }
}

function unexpectedReply(): ToolError {
  return new ToolError("upstream_error", "Cloudflare returned an unexpected Workers deployments response.")
}

/** The Worker's deployments, latest first: pages of `PAGE_SIZE` are walked while they are full, up to `MAX_PAGES`. */
async function readDeployments(client: CloudflareClient, script: string): Promise<Deployment[]> {
  const deployments: Deployment[] = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    const reply = await requestScript<unknown>(client, ROUTES.workersDeployments, script, {
      query: { page, per_page: PAGE_SIZE },
    })
    const entries = isPlainObject(reply.result) ? reply.result.deployments : undefined
    if (!Array.isArray(entries)) throw unexpectedReply()
    deployments.push(...entries.map(shapeDeployment))
    if (entries.length < PAGE_SIZE) break
  }
  return deployments
}

/**
 * The failure of the one POST. Cloudflare's refusal means nothing was deployed, and a refusal about the Worker's
 * secrets is explained and never forced; a failure that does not tell (5xx, timeout, network) may or may not have
 * deployed. A cancellation passes untouched.
 */
function failureOfSend(error: unknown, script: string): unknown {
  if (
    error instanceof ToolError &&
    !isAbortError(error) &&
    refusedByCloudflare(error) &&
    SECRET_MENTION.test(error.message)
  ) {
    return new ToolError(
      error.code,
      `Cloudflare refused the rollback because Worker ${script}'s secrets changed since that version served: the old code would run with today's secrets. Rolling back past it is a decision for the user, in Wrangler (wrangler rollback) or the dashboard; this tool never forces it. ${WRITE_NOTES.nothing}`,
      { cause: error },
    )
  }
  return failureOfWrite(error, WRITE_NOTES)
}

async function sendRollback(client: CloudflareClient, script: string, request: RollbackRequest): Promise<unknown> {
  try {
    const reply = await client.request<unknown>(ROUTES.workersDeploy, {
      path: { script_name: script },
      body: {
        strategy: "percentage",
        versions: request.split.map((entry) => ({
          version_id: entry.versionId,
          percentage: toPercentage(entry.share),
        })),
        annotations: { "workers/message": request.message },
      },
    })
    return reply.result
  } catch (error) {
    throw failureOfSend(error, script)
  }
}

/** What a call will do: the Worker, the request, the client and the history as it checks out; refuses what the tool refuses before it asks. */
async function planRollback(args: z.output<typeof input>, ctx: ToolContext, deps?: CloudflareDeps) {
  const script = scriptName(args.script)
  const request = parseRequest(args)
  const client = cloudflareClient(args.account, { ...deps, signal: ctx.signal })

  const history = checkHistory(script, request, await readDeployments(client, script))
  return { script, request, client, history }
}

/** The description of a rollback: the versions serving now, the versions to serve instead and the message. */
async function describeRollback(
  args: z.output<typeof input>,
  ctx: ToolContext,
  deps?: CloudflareDeps,
): Promise<CallDescription> {
  const { script, request, history } = await planRollback(args, ctx, deps)
  const serving = [...sharesOf(history.serving)].map(([versionId, share]) => `${versionId} ${toPercentage(share)}%`)
  const next = request.split.map((entry) => `${entry.versionId} ${toPercentage(entry.share)}%`)
  return {
    headline: { text: WORKERS_WORDS.rollback, values: { script } },
    facts: [
      ...(serving.length === 0 ? [] : [{ label: WORKERS_WORDS.servingNow, value: serving.join(", ") }]),
      { label: WORKERS_WORDS.serveInstead, value: next.join(", ") },
      { label: WORKERS_WORDS.effect, value: { text: WORKERS_WORDS.effectRollback } },
    ],
    text: { label: WORKERS_WORDS.message, body: request.message },
  }
}

/** Defines the `cloudflare_workers_rollback` tool spec with injected dependencies. */
export function defineWorkersRollback(deps?: CloudflareDeps): RollbackSpec {
  const spec: RollbackSpec = defineTool({
    id: "cloudflare_workers_rollback",
    title: "Roll back a Cloudflare Worker",
    intent: "About to roll back a Worker",
    description: [
      "Roll a Cloudflare Worker back to versions that served traffic before, in one new deployment; the tool always asks first in attended runs.",
      "The arguments come from cloudflare_workers_read deployments: `replaces` is the id of the first deployment (the one serving now), `versions` the versions and shares of an earlier deployment to return to.",
      "A version that never served is refused, and so is the split that serves now; `stale` means another deployment came first, so read the deployments again before trying again.",
      "Cloudflare refuses a rollback past a change of the Worker's secrets; this tool never forces it, and the user decides in Wrangler (wrangler rollback) or the dashboard.",
      "Visitors get the old code at once, and the Worker's secrets stay as they are now.",
      "The result holds the deployment it replaced and the new one.",
      "Wrangler deploys new code.",
    ].join(" "),
    toolset: "workers",
    class: "administrative",
    input,
    output,
    targets(args, ctx) {
      try {
        const client = cloudflareClient(args.account, { ...deps, signal: ctx.signal })
        return [`${client.accountId}/workers/scripts/${scriptName(args.script)}`]
      } catch (error) {
        if (isAbortError(error) || ctx.signal?.aborted) throw error
        return [ANY_TARGET]
      }
    },
    describe: (args, ctx) => describeRollback(args, ctx, deps),
    async execute(args, ctx) {
      const { script, request, client, history } = await planRollback(args, ctx, deps)
      await confirmWrite(spec, ctx, confirmation(script, client.label, request, history))

      const result = await sendRollback(client, script, request)
      return {
        label: client.label,
        script,
        replaced: history.serving,
        deployment: newDeployment(result, request),
      }
    },
  })
  return spec
}

export const cloudflareWorkersRollback = defineWorkersRollback()
