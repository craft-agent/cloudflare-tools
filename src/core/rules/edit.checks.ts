import { isDeepStrictEqual } from "node:util"
import { ToolError } from "../errors"
import { NOTHING_CHANGED } from "./errors"
import type { Position } from "./position"
import type { Entrypoint, Rule } from "./shape"

/** What a call may change about a rule: each part left out stays as it is. */
export type EditArgs = {
  expression?: string
  action?: string
  action_parameters?: Record<string, unknown>
  description?: string
  enabled?: boolean
  position?: Position
}

/** What the rule is to be: each part is the one the call names, or else the rule's own. An empty description is none. */
export type Definition = {
  expression: string | null
  action: string | null
  action_parameters: Record<string, unknown> | null
  description: string | null
  enabled: boolean
}

/** A move of the rule to another place: the position Cloudflare takes, and the places the rule leaves and takes. */
export type Move = { position: Position; from: number; to: number }

/** The change a call makes: what the rule is to be, and where it moves to (null when it stays where it is). */
export type Change = { definition: Definition; move: Move | null }

const CHANGE_KEYS = ["expression", "action", "action_parameters", "description", "enabled", "position"] as const

/** Refuses a call that names no change. */
export function assertNamed(args: EditArgs): void {
  if (CHANGE_KEYS.some((key) => args[key] !== undefined)) return
  throw new ToolError(
    "invalid_argument",
    `Name at least one of expression, action, action_parameters, description, enabled or position. ${NOTHING_CHANGED}`,
  )
}

/** The phase's entry point; `not_found` when the phase has none, and so no rules. */
export function requireEntrypoint(entrypoint: Entrypoint | null, product: string, zoneName: string): Entrypoint {
  if (entrypoint !== null) return entrypoint
  throw new ToolError("not_found", `${product} of ${zoneName} has no rules. ${NOTHING_CHANGED}`)
}

/** The rule `id` among the phase's rules; `not_found` when there is none. */
export function findRule(rules: readonly Rule[], id: string, product: string, zoneName: string): Rule {
  const found = rules.find((rule) => rule.id === id)
  if (found === undefined) {
    throw new ToolError("not_found", `No rule ${id} in ${product} of ${zoneName}. ${NOTHING_CHANGED}`)
  }
  return found
}

/** Refuses the call when the rule is at another version than `replaces` says, so a rule changed since it was read is not overwritten. */
export function assertNotStale(current: Rule, replaces: string): void {
  if (current.version === replaces) return
  throw new ToolError(
    "stale",
    `Rule ${current.id} is now version ${current.version ?? "unknown"}, not ${replaces}; read the phase again before changing it. ${NOTHING_CHANGED}`,
  )
}

/** What the rule is to be once `args` are applied to it. */
export function definitionOf(args: EditArgs, current: Rule): Definition {
  return {
    expression: args.expression ?? current.expression,
    action: args.action ?? current.action,
    action_parameters: args.action_parameters ?? current.action_parameters,
    description: args.description ?? current.description,
    enabled: args.enabled ?? current.enabled ?? true,
  }
}

/** Whether two sets of action parameters are the same; none is `{}`. */
export function sameParameters(a: Record<string, unknown> | null, b: Record<string, unknown> | null): boolean {
  return isDeepStrictEqual(a ?? {}, b ?? {})
}

/** Whether two definitions make the same rule: a missing description is empty, missing parameters are `{}`. */
export function sameDefinition(a: Definition, b: Definition): boolean {
  return (
    (a.expression ?? "") === (b.expression ?? "") &&
    a.action === b.action &&
    sameParameters(a.action_parameters, b.action_parameters) &&
    (a.description ?? "") === (b.description ?? "") &&
    a.enabled === b.enabled
  )
}

/**
 * The place the rule takes when `position` is applied: after it is taken out of the phase, `before` and `after` count
 * against the other rules. Refuses a rule that is not another rule of the phase, and an index past the last place.
 */
function placeAfter(position: Position, current: Rule, rules: readonly Rule[], product: string, zoneName: string) {
  if (position.index !== undefined) {
    if (position.index <= rules.length) return position.index
    throw new ToolError(
      "invalid_argument",
      `Position ${position.index} is past the end of ${product}: the last place is ${rules.length}. ${NOTHING_CHANGED}`,
    )
  }
  const named = position.before ?? position.after
  if (named === undefined) return current.position
  if (named === current.id) {
    throw new ToolError("invalid_argument", `Rule ${named} cannot be placed before or after itself. ${NOTHING_CHANGED}`)
  }
  const target = rules.find((rule) => rule.id === named)
  if (target === undefined) {
    throw new ToolError("invalid_argument", `No rule ${named} in ${product} of ${zoneName}. ${NOTHING_CHANGED}`)
  }
  const shifted = target.position > current.position ? target.position - 1 : target.position
  return position.before === undefined ? shifted + 1 : shifted
}

/**
 * The change `args` make to `current`. A position that leaves the rule where it is is no move; a change that alters
 * nothing is `invalid_argument`.
 */
export function planChange(
  args: EditArgs,
  current: Rule,
  rules: readonly Rule[],
  product: string,
  zoneName: string,
): Change {
  const definition = definitionOf(args, current)
  const to =
    args.position === undefined ? current.position : placeAfter(args.position, current, rules, product, zoneName)
  const move =
    args.position === undefined || to === current.position
      ? null
      : { position: args.position, from: current.position, to }

  if (move === null && sameDefinition(definition, definitionOf({}, current))) {
    throw new ToolError("invalid_argument", `Rule ${current.id} already reads that way. ${NOTHING_CHANGED}`)
  }
  return { definition, move }
}
