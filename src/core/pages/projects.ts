import { z } from "zod"
import type { CloudflareClient, Reply, RequestOptions } from "../cloudflare/client"
import { isPlainObject } from "../cloudflare/reply"
import { DEPLOYMENT_ID_PATTERN, PROJECT_NAME_PATTERN, type Route } from "../cloudflare/routes"
import { ToolError, isToolError } from "../errors"

const PROJECT_NAME_FORM = "1–58 lowercase letters, digits and `-`, starting with a letter or digit"

export const PROJECT_DESCRIPTION = `The Pages project's name, as \`list\` shows it: ${PROJECT_NAME_FORM}.`

export const projectArg = z.string().describe(PROJECT_DESCRIPTION)

/** A deployment's id, trimmed and lowercased; invalid UUIDs are refused. */
export function deploymentId(value: string, field: "deployment" | "replaces" = "deployment"): string {
  const id = value.trim().toLowerCase()
  if (!DEPLOYMENT_ID_PATTERN.test(id)) {
    const what =
      field === "replaces" ? "the id (a UUID) of the production deployment serving now" : "a deployment's id (a UUID)"
    throw new ToolError(
      "invalid_argument",
      `\`${field}\` must be ${what}, as cloudflare_pages_read deployments shows it; not its short_id.`,
    )
  }
  return id
}

/** Options when calling a Pages project route. */
export type RequestProjectOptions = Omit<RequestOptions, "path"> & {
  readonly path?: Readonly<Record<string, string>>
  readonly notFoundMessage?: string
}

/** A project's name, trimmed and never lowercased; invalid names are refused. */
export function projectName(value: string): string {
  const name = value.trim()
  if (!PROJECT_NAME_PATTERN.test(name)) {
    throw new ToolError("invalid_argument", `\`project\` must be ${PROJECT_NAME_FORM}.`)
  }
  return name
}

/** `value` when it is an object, else `upstream_error` naming the `response` that was unexpected. */
export function requireObject(value: unknown, response: string): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new ToolError("upstream_error", `Cloudflare returned an unexpected Pages ${response} response.`)
  }
  return value
}

/** Calls a project's route, pointing missing projects at `list`. */
export async function requestProject<T>(
  client: CloudflareClient,
  route: Route,
  project: string,
  options: RequestProjectOptions = {},
): Promise<Reply<T>> {
  try {
    return await client.request<T>(route, { ...options, path: { project_name: project, ...options.path } })
  } catch (error) {
    if (!isToolError(error) || error.code !== "not_found") throw error
    const message =
      options.notFoundMessage ??
      `No Pages project ${project} in the account ${client.label}; cloudflare_pages_read list shows its projects.`
    throw new ToolError("not_found", message, { cause: error })
  }
}
