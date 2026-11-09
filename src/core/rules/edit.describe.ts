import type { CallDescription, CallFact } from "../tool"
import { definitionOf, sameParameters, type Change } from "./edit.checks"
import { phaseInfo, type WritablePhase } from "./phases"
import type { Rule } from "./shape"
import { RULES_WORDS } from "./words"

/** What a change line shows for a part that is empty or missing. */
const NO_VALUE = "(none)"

const ARROW = "→"

function arrowed(from: string, to: string): string {
  return `${from} ${ARROW} ${to}`
}

function parametersText(parameters: Record<string, unknown> | null): string {
  return JSON.stringify(parameters ?? {})
}

/** The facts for the parts of the rule the change alters, in the order action, parameters, description, state, position. */
function changedFacts(current: Rule, change: Change): CallFact[] {
  const before = definitionOf({}, current)
  const after = change.definition
  const facts: CallFact[] = []
  if (after.action !== before.action) {
    facts.push({ label: RULES_WORDS.action, value: arrowed(before.action ?? NO_VALUE, after.action ?? NO_VALUE) })
  }
  if (!sameParameters(after.action_parameters, before.action_parameters)) {
    facts.push({
      label: RULES_WORDS.parameters,
      value: arrowed(parametersText(before.action_parameters), parametersText(after.action_parameters)),
    })
  }
  if ((after.description ?? "") !== (before.description ?? "")) {
    facts.push({
      label: RULES_WORDS.description,
      value: arrowed(before.description || NO_VALUE, after.description || NO_VALUE),
    })
  }
  if (after.enabled !== before.enabled) {
    facts.push({
      label: RULES_WORDS.state,
      value: { text: after.enabled ? RULES_WORDS.switchedOn : RULES_WORDS.switchedOff },
    })
  }
  if (change.move !== null) {
    const { from, to } = change.move
    facts.push({ label: RULES_WORDS.position, value: { text: RULES_WORDS.placeChange, values: { from, to } } })
  }
  return facts
}

/** The expression as the text shows it: the rule's own, or, when the change alters it, the old one, an arrow line and the new one. */
function expressionText(current: Rule, change: Change): string {
  const before = current.expression ?? ""
  const after = change.definition.expression ?? ""
  return before === after ? before : `${before}\n${ARROW}\n${after}`
}

/**
 * The description of a change: the rule (by its description, else its id) in its product and zone, a fact for each
 * part that changes, and the expression as its text. The rule as read is pinned, since it is sent back whole.
 */
export function describeRuleEdit(
  phase: WritablePhase,
  zoneName: string,
  current: Rule,
  change: Change,
): CallDescription {
  const body = expressionText(current, change)
  return {
    headline: {
      text: RULES_WORDS.ruleEdit,
      values: { rule: current.description || current.id, product: phaseInfo(phase).product, zone: zoneName },
    },
    facts: changedFacts(current, change),
    ...(body === "" ? {} : { text: { label: RULES_WORDS.expression, body } }),
    pins: { rule: JSON.stringify(current) },
  }
}
