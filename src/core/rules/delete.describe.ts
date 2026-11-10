import type { CallDescription, CallFact } from "../tool"
import { phaseInfo, type WritablePhase } from "./phases"
import type { Rule } from "./shape"
import { RULES_WORDS } from "./words"

/** The facts of a rule: its action, parameters when it has any, place, description when it has one, and that it is off. */
function ruleFacts(rule: Rule): CallFact[] {
  const hasParameters = rule.action_parameters !== null && Object.keys(rule.action_parameters).length > 0
  return [
    ...(rule.action === null ? [] : [{ label: RULES_WORDS.action, value: rule.action }]),
    ...(hasParameters ? [{ label: RULES_WORDS.parameters, value: JSON.stringify(rule.action_parameters) }] : []),
    { label: RULES_WORDS.position, value: { text: RULES_WORDS.atPosition, values: { index: rule.position } } },
    ...(rule.description ? [{ label: RULES_WORDS.description, value: rule.description }] : []),
    ...(rule.enabled === false ? [{ label: RULES_WORDS.state, value: { text: RULES_WORDS.off } }] : []),
  ]
}

/**
 * The description of a delete: the rule (by its description, else its id) in its product and zone, what it does and
 * where it sits, and its expression as its text. The rule as read is pinned, so a rule changed since is stale.
 */
export function describeRuleDelete(phase: WritablePhase, zoneName: string, rule: Rule): CallDescription {
  return {
    headline: {
      text: RULES_WORDS.ruleDelete,
      values: { rule: rule.description || rule.id, product: phaseInfo(phase).product, zone: zoneName },
    },
    facts: ruleFacts(rule),
    ...(rule.expression ? { text: { label: RULES_WORDS.expression, body: rule.expression } } : {}),
    pins: { rule: JSON.stringify(rule) },
  }
}
