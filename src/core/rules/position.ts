import { z } from "zod"
import { ToolError } from "../errors"
import { NOTHING_CHANGED } from "./errors"
import { ruleIdArg } from "./rule.args"
import type { Entrypoint } from "./shape"

/** Where a new rule goes among a phase's rules: before or after a rule, or at a place counted from 1. */
export const positionArg = z
  .strictObject({
    before: ruleIdArg.optional().describe("Put the rule right before the rule with this id."),
    after: ruleIdArg.optional().describe("Put the rule right after the rule with this id."),
    index: z.number().int().min(1).optional().describe("Put the rule at this place, counted from 1 (int ≥ 1)."),
  })
  .refine((position) => Object.values(position).filter((value) => value !== undefined).length === 1, {
    message: "give exactly one of before, after and index",
  })
  .describe(
    "Where the rule goes, as exactly one of before (a rule id), after (a rule id) or index (a place counted from 1). Left out, the rule goes last. Rule ids come from cloudflare_rules_read rules.",
  )

export type Position = z.output<typeof positionArg>

/** A position as Cloudflare takes it: only the one key that was given. */
export function positionBody(position: Position): Record<string, string | number> {
  return Object.fromEntries(Object.entries(position).filter(([, value]) => value !== undefined))
}

/**
 * Refuses a position the phase cannot give. A phase with no entry point has no rules yet, so only the first place
 * exists; otherwise `before` and `after` must name a rule of the phase and `index` must not pass the place after the
 * last rule.
 */
export function assertPositionFits(
  position: Position | undefined,
  entrypoint: Entrypoint | null,
  product: string,
  zoneName: string,
): void {
  if (position === undefined) return
  if (entrypoint === null) {
    if (position.index === 1) return
    throw new ToolError(
      "invalid_argument",
      `${product} of ${zoneName} has no rules yet, so the position can only be first. ${NOTHING_CHANGED}`,
    )
  }

  const named = position.before ?? position.after
  if (named !== undefined && !entrypoint.rules.some((rule) => rule.id === named)) {
    throw new ToolError("invalid_argument", `No rule ${named} in ${product}. ${NOTHING_CHANGED}`)
  }

  const last = entrypoint.rules.length + 1
  if (position.index !== undefined && position.index > last) {
    throw new ToolError(
      "invalid_argument",
      `Position ${position.index} is past the end of ${product}: the last place a new rule can take is ${last}. ${NOTHING_CHANGED}`,
    )
  }
}
