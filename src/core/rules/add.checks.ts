import { isDeepStrictEqual } from "node:util"
import { ToolError } from "../errors"
import { NOTHING_CHANGED } from "./errors"
import { phaseInfo, type WritablePhase } from "./phases"
import type { Rule } from "./shape"

/** The rule a call would add, as far as the duplicate check compares it. */
export type NewRule = {
  expression: string
  action: string
  action_parameters?: Record<string, unknown>
}

/** Refuses an action the phase does not take, before anything is sent. */
export function assertActionFits(phase: WritablePhase, action: string): void {
  const { product, actions } = phaseInfo(phase)
  const takes: readonly string[] = actions
  if (takes.includes(action)) return
  throw new ToolError(
    "invalid_argument",
    `The action of a rule in ${product} must be ${takes.join(" or ")}, not ${JSON.stringify(action)}. ${NOTHING_CHANGED}`,
  )
}

/**
 * Refuses a rule the phase already holds: the same expression, action and parameters (a rule without parameters has
 * none, like `{}`), so a retried add does not add twice.
 */
export function assertNotDuplicate(rules: readonly Rule[], added: NewRule): void {
  const parameters = added.action_parameters ?? {}
  const existing = rules.find(
    (rule) =>
      rule.expression === added.expression &&
      rule.action === added.action &&
      isDeepStrictEqual(rule.action_parameters ?? {}, parameters),
  )
  if (existing === undefined) return
  throw new ToolError(
    "invalid_argument",
    `Rule ${existing.id} (position ${existing.position}) already has that expression and action. ${NOTHING_CHANGED}`,
  )
}
