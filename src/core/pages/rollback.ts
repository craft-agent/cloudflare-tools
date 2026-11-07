import { z } from "zod"
import { accountArg } from "../cloudflare/args"
import { cloudflareClient, type CloudflareClient, type CloudflareDeps } from "../cloudflare/client"
import { refusedByCloudflare } from "../cloudflare/refusal"
import { isPlainObject } from "../cloudflare/reply"
import { ROUTES } from "../cloudflare/routes"
import { ToolError, isAbortError } from "../errors"
import { ANY_TARGET } from "../targets"
import { confirmWrite, defineTool, type ToolSpec } from "../tool"
import { projectArg, projectName, requestProject } from "./projects"
import { checkServable, checkServing, confirmation, parseRequest } from "./rollback.checks"
import { deploymentSchema, shapeDeployment, shapeLiveRef } from "./shape"

const NOTHING_CHANGED = "Nothing changed."
const MAYBE_CHANGED =
  "Cloudflare may or may not have switched it; read cloudflare_pages_read deployments before sending it again."

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

/**
 * The failure of the one POST. Cloudflare's refusal means nothing changed; a failure that does not tell (5xx,
 * timeout, network) may or may not have switched production. A cancellation passes untouched.
 */
function failureOfSend(error: unknown): unknown {
  if (isAbortError(error) || !(error instanceof ToolError)) return error
  if (refusedByCloudflare(error)) {
    return new ToolError(error.code, `${error.message} ${NOTHING_CHANGED}`, { cause: error })
  }
  if (error.code === "upstream_error") {
    return new ToolError("upstream_error", `${error.message} ${MAYBE_CHANGED}`, { cause: error })
  }
  return error
}

async function sendRollback(client: CloudflareClient, project: string, deployment: string): Promise<unknown> {
  try {
    const reply = await client.request<unknown>(ROUTES.pagesRollback, {
      path: { project_name: project, deployment_id: deployment },
    })
    return reply.result
  } catch (error) {
    throw failureOfSend(error)
  }
}

function requireObject(value: unknown, response: string): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new ToolError("upstream_error", `Cloudflare returned an unexpected Pages ${response} response.`)
  }
  return value
}

/** Defines the `cloudflare_pages_rollback` tool spec with injected dependencies. */
export function definePagesRollback(deps?: CloudflareDeps): RollbackSpec {
  const spec: RollbackSpec = defineTool({
    id: "cloudflare_pages_rollback",
    title: "Roll back a Cloudflare Pages project",
    description: [
      "Roll a Cloudflare Pages project's production back, or forward, to a production deployment that built successfully; the tool always asks first.",
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
    async execute(args, ctx) {
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
