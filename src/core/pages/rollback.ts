import { z } from "zod"
import { accountArg } from "../cloudflare/args"
import { cloudflareClient, type CloudflareClient, type CloudflareDeps } from "../cloudflare/client"
import { failureOfWrite, type WriteFailureNotes } from "../cloudflare/refusal"
import { isPlainObject } from "../cloudflare/reply"
import { ROUTES } from "../cloudflare/routes"
import { isAbortError } from "../errors"
import { ANY_TARGET } from "../targets"
import { confirmWrite, defineTool, type CallDescription, type ToolContext, type ToolSpec } from "../tool"
import { projectArg, projectName, requestProject, requireObject } from "./projects"
import { checkServable, checkServing, confirmation, parseRequest } from "./rollback.checks"
import { deploymentSchema, shapeDeployment, shapeLiveRef } from "./shape"
import { PAGES_WORDS } from "./words"

const WRITE_NOTES: WriteFailureNotes = {
  nothing: "Nothing changed.",
  maybe: "Cloudflare may or may not have switched it; read cloudflare_pages_read deployments before sending it again.",
}

const input = z.object({
  account: accountArg,
  project: projectArg,
  deployment: z
    .string()
    .describe(
      "The id (a UUID) of the production deployment to serve, as cloudflare_pages_read deployments shows it; older or newer than the one serving now.",
    ),
  replaces: z
    .string()
    .describe(
      "The id (a UUID) of the production deployment serving now: the one cloudflare_pages_read deployments marks live. The call is refused as stale when another deployment or rollback came first.",
    ),
})

const output = z.object({
  label: z.string().describe("The account label."),
  project: z.string().describe("The Pages project's name."),
  replaced: deploymentSchema.describe("The production deployment that served before."),
  deployment: deploymentSchema.describe("The deployment serving now, as Cloudflare reports it."),
})

type RollbackSpec = ToolSpec<typeof input, typeof output>

async function sendRollback(client: CloudflareClient, project: string, deployment: string): Promise<unknown> {
  try {
    const reply = await client.request<unknown>(ROUTES.pagesRollback, {
      path: { project_name: project, deployment_id: deployment },
    })
    return reply.result
  } catch (error) {
    throw failureOfWrite(error, WRITE_NOTES)
  }
}

/** What a call will do: the project, the client, the deployment serving now and the one to serve; refuses what the tool refuses before it asks. */
async function planRollback(args: z.output<typeof input>, ctx: ToolContext, deps?: CloudflareDeps) {
  const project = projectName(args.project)
  const request = parseRequest(args)
  const client = cloudflareClient(args.account, { ...deps, signal: ctx.signal })

  const projectReply = await requestProject<unknown>(client, ROUTES.pagesProject, project)
  const canonical = requireObject(projectReply.result, "project").canonical_deployment
  const serving = checkServing(project, shapeLiveRef(canonical), request)

  const deploymentReply = await requestProject<unknown>(client, ROUTES.pagesDeployment, project, {
    path: { deployment_id: request.deployment },
    notFoundMessage: `No deployment ${request.deployment} in Pages project ${project} of the account ${client.label}; cloudflare_pages_read deployments lists them.`,
  })
  const target = shapeDeployment(requireObject(deploymentReply.result, "deployment"), true)
  checkServable(target)
  return { project, request, client, canonical, serving, target }
}

/** The description of a rollback: the deployment serving now and the one to serve instead. */
async function describeRollback(
  args: z.output<typeof input>,
  ctx: ToolContext,
  deps?: CloudflareDeps,
): Promise<CallDescription> {
  const { project, request, serving, target } = await planRollback(args, ctx, deps)
  const named = (parts: (string | null)[]) => parts.filter((part) => part !== null).join("  ")
  return {
    headline: { text: PAGES_WORDS.rollback, values: { project } },
    facts: [
      { label: PAGES_WORDS.servingNow, value: named([serving.short_id ?? serving.id, serving.created_on]) },
      {
        label: PAGES_WORDS.serveInstead,
        value: named([target.short_id ?? target.id ?? request.deployment, target.created_on, target.trigger.branch]),
      },
      { label: PAGES_WORDS.effect, value: { text: PAGES_WORDS.effectRollback } },
    ],
  }
}

/** Defines the `cloudflare_pages_rollback` tool spec with injected dependencies. */
export function definePagesRollback(deps?: CloudflareDeps): RollbackSpec {
  const spec: RollbackSpec = defineTool({
    id: "cloudflare_pages_rollback",
    title: "Roll back a Cloudflare Pages project",
    intent: "About to roll back a Pages project",
    description: [
      "Roll a Cloudflare Pages project's production back, or forward, to a production deployment that built successfully; the tool always asks first in attended runs.",
      "The arguments come from cloudflare_pages_read deployments: `replaces` is the id of the deployment marked live (the one serving production now), `deployment` the id of the one to serve, older or newer.",
      "A preview, a skipped deployment and a failed build are refused, and so is the deployment serving now; `stale` means another deployment or rollback came first, so read the deployments again before trying again.",
      "No new deployment is made: the project serves the chosen one at once, and rolling back to the one it replaced undoes it.",
      "The result holds the deployment it replaced and the one serving now.",
      "Building and deploying stay with Git and Wrangler.",
    ].join(" "),
    toolset: "pages",
    class: "administrative",
    input,
    output,
    targets(args, ctx) {
      try {
        const client = cloudflareClient(args.account, { ...deps, signal: ctx.signal })
        return [`${client.accountId}/pages/projects/${projectName(args.project)}`]
      } catch (error) {
        if (isAbortError(error) || ctx.signal?.aborted) throw error
        return [ANY_TARGET]
      }
    },
    describe: (args, ctx) => describeRollback(args, ctx, deps),
    async execute(args, ctx) {
      const { project, request, client, canonical, serving, target } = await planRollback(args, ctx, deps)
      await confirmWrite(spec, ctx, confirmation(project, client.label, serving, target))

      const result = await sendRollback(client, project, request.deployment)
      return {
        label: client.label,
        project,
        replaced: shapeDeployment(canonical, false),
        deployment: isPlainObject(result) && typeof result.id === "string" ? shapeDeployment(result, true) : target,
      }
    },
  })
  return spec
}

export const cloudflarePagesRollback = definePagesRollback()
