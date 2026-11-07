import { z } from "zod"
import type { CloudflareClient, Reply, RequestOptions } from "../cloudflare/client"
import { SCRIPT_NAME_PATTERN, type Route } from "../cloudflare/routes"
import { ToolError, isToolError } from "../errors"

const SCRIPT_NAME_FORM = "1–63 lowercase letters, digits, `-` and `_`"

export const SCRIPT_DESCRIPTION = `The Worker's name, as \`list\` shows it: ${SCRIPT_NAME_FORM}.`

export const scriptArg = z.string().describe(SCRIPT_DESCRIPTION)

/** A Worker's name, trimmed; anything that is not one is `invalid_argument`. The case is never changed. */
export function scriptName(value: string): string {
  const name = value.trim()
  if (!SCRIPT_NAME_PATTERN.test(name)) {
    throw new ToolError("invalid_argument", `\`script\` must be ${SCRIPT_NAME_FORM}.`)
  }
  return name
}

/** Calls a route of one Worker; a Worker the account does not have is `not_found`, pointing at `list`. */
export async function requestScript<T>(
  client: CloudflareClient,
  route: Route,
  script: string,
  options: Omit<RequestOptions, "path"> = {},
): Promise<Reply<T>> {
  try {
    return await client.request<T>(route, { ...options, path: { script_name: script } })
  } catch (error) {
    if (!isToolError(error) || error.code !== "not_found") throw error
    throw new ToolError(
      "not_found",
      `No Worker ${script} in the account ${client.label}; cloudflare_workers_read list shows its Workers.`,
      { cause: error },
    )
  }
}
