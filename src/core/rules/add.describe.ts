import type { CallDescription, CallFact } from "../tool"
import type { NewRule } from "./add.checks"
import { phaseInfo, type WritablePhase } from "./phases"
import type { Position } from "./position"
import type { Rule } from "./shape"
import { RULES_WORDS } from "./words"

/** What the description of an add shows of the call. */
type Described = NewRule & {
  phase: WritablePhase
  description?: string
  enabled?: boolean
  position?: Position
}

/** How a rule is named in a position: its description when it has one, else its id. */
function ruleName(rules: readonly Rule[], id: string): string {
  return rules.find((rule) => rule.id === id)?.description || id
}

function positionValue(position: Position, rules: readonly Rule[]): CallFact["value"] {
  if (position.before !== undefined) {
    return { text: RULES_WORDS.beforeRule, values: { rule: ruleName(rules, position.before) } }
  }
  if (position.after !== undefined) {
    return { text: RULES_WORDS.afterRule, values: { rule: ruleName(rules, position.after) } }
  }
  return { text: RULES_WORDS.atPosition, values: { index: position.index! } }
}

/**
 * The description of an add: the action, the parameters, the place and the description when given, and that the rule
 * is off; the expression is its text, as it will be sent. `rules` are the phase's rules now, which name the rule a
 * position refers to.
 */
export function describeRuleAdd(args: Described, zoneName: string, rules: readonly Rule[]): CallDescription {
  const facts: CallFact[] = [
    { label: RULES_WORDS.action, value: args.action },
    ...(args.action_parameters === undefined
      ? []
      : [{ label: RULES_WORDS.parameters, value: JSON.stringify(args.action_parameters) }]),
    ...(args.position === undefined
      ? []
      : [{ label: RULES_WORDS.position, value: positionValue(args.position, rules) }]),
    ...(args.description === undefined ? [] : [{ label: RULES_WORDS.description, value: args.description }]),
    ...(args.enabled === false ? [{ label: RULES_WORDS.state, value: { text: RULES_WORDS.off } }] : []),
  ]
  return {
    headline: {
      text: RULES_WORDS.ruleAdd,
      values: { product: phaseInfo(args.phase).product, zone: zoneName },
    },
    facts,
    text: { label: RULES_WORDS.expression, body: args.expression },
  }
}
