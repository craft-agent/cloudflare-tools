import { toolError } from "./cloudflare/client.fixtures"
import type { CallDescription, ConfirmRequest, ToolContext, ToolSpec } from "./tool"

type Describing = Pick<ToolSpec, "input" | "describe">

/** A context whose confirmation records what it was asked and accepts. */
export function confirming(base: ToolContext = { cwd: process.cwd() }) {
  const asked: ConfirmRequest[] = []
  const ctx: ToolContext = {
    ...base,
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
