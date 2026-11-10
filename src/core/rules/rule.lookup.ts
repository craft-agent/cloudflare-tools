import { ToolError } from "../errors"
import { NOTHING_CHANGED } from "./errors"
import type { Entrypoint, Rule } from "./shape"

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
