import { toolError } from "../cloudflare/client.fixtures"
import type { FakeRequest } from "../cloudflare/testing"
import type { CallDescription, ConfirmRequest, ToolContext, ToolSpec } from "../tool"
import { CTX } from "./fixtures"

type Describing = Pick<ToolSpec, "input" | "describe">

/** A context whose confirmation records what it was asked and accepts. */
export function confirming() {
  const asked: ConfirmRequest[] = []
  const ctx: ToolContext = {
    ...CTX,
    confirm: async (request) => {
      asked.push(request)
      return true
    },
  }
  return { asked, ctx }
}

/** What the tool's `describe` answers for `args`, with the questions it asked (none, ever). */
export async function describing(
  tool: Describing,
  args: object,
): Promise<{ description: CallDescription; asked: ConfirmRequest[] }> {
  const { asked, ctx } = confirming()
  const description = await tool.describe!(tool.input.parse(args), ctx)
  return { description, asked }
}

/** What the tool's `describe` throws for `args`, with the questions it asked (none, ever). */
export async function refusing(tool: Describing, args: object) {
  const { asked, ctx } = confirming()
  const error = await toolError(Promise.resolve(tool.describe!(tool.input.parse(args), ctx)))
  return { error, asked }
}

/** The requests that are not reads. */
export function writes(requests: FakeRequest[]): string[] {
  return requests.filter((request) => request.method !== "GET").map((request) => `${request.method} ${request.path}`)
}

/** How many reads of `path` the fake received. */
export function readsOf(requests: FakeRequest[], path: string): number {
  return requests.filter((request) => request.method === "GET" && request.path === path).length
}
