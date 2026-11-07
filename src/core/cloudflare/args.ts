import { z } from "zod"
import { ToolError } from "../errors"

export const ACCOUNT_DESCRIPTION =
  'The label of the credential pair to use, or "default" for the unlabeled one; left out, the unlabeled pair, else the only label.'

export const accountArg = z.string().optional().describe(ACCOUNT_DESCRIPTION)

/** Refuses arguments the selected method does not accept. */
export function assertAcceptedKeys<M extends string>(
  accepted: Record<M, readonly string[]>,
  method: M,
  args: Record<string, unknown>,
): void {
  const allowed = new Set(accepted[method])
  for (const [key, value] of Object.entries(args)) {
    if (key === "method" || value === undefined) continue
    if (!allowed.has(key)) {
      throw new ToolError("invalid_argument", `Method "${method}" takes no \`${key}\`.`)
    }
  }
}
