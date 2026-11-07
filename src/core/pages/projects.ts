import { z } from "zod"
import type { CloudflareClient, Reply, RequestOptions } from "../cloudflare/client"
import { PROJECT_NAME_PATTERN, type Route } from "../cloudflare/routes"
import { ToolError, isToolError } from "../errors"

const PROJECT_NAME_FORM = "1–58 lowercase letters, digits and `-`, starting with a letter or digit"

export const PROJECT_DESCRIPTION = `The Pages project's name, as \`list\` shows it: ${PROJECT_NAME_FORM}.`

export const projectArg = z.string().describe(PROJECT_DESCRIPTION)

/** A project's name, trimmed and never lowercased; invalid names are refused. */
export function projectName(value: string): string {
  const name = value.trim()
  if (!PROJECT_NAME_PATTERN.test(name)) {
    throw new ToolError("invalid_argument", `\`project\` must be ${PROJECT_NAME_FORM}.`)
  }
  return name
}

/** Calls a project's route, pointing missing projects at `list`. */
export async function requestProject<T>(
  client: CloudflareClient,
  route: Route,
  project: string,
  options: Omit<RequestOptions, "path"> = {},
): Promise<Reply<T>> {
  try {
    return await client.request<T>(route, { ...options, path: { project_name: project } })
  } catch (error) {
    if (!isToolError(error) || error.code !== "not_found") throw error
    throw new ToolError(
      "not_found",
      `No Pages project ${project} in the account ${client.label}; cloudflare_pages_read list shows its projects.`,
      { cause: error },
    )
  }
}
