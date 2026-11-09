import type { CallFact } from "../tool"
import type { CatchAllState } from "./catchall.current"
import type { Action } from "./rule"
import { EMAIL_WORDS } from "./words"

/** An action as the API names it: `forward sales@example.net`, `drop`, `worker inbox`. It is the call's data, so it is never translated. */
export function actionText(action: Action): string {
  switch (action.type) {
    case "forward":
      return `forward ${action.to}`
    case "drop":
      return "drop"
    case "worker":
      return `worker ${action.worker}`
  }
}

/** The fact that comes first when Email Routing is off on the zone (`false`); none when it is on or could not be read (`null`). */
export function routingOffFacts(routingEnabled: boolean | null): CallFact[] {
  return routingEnabled === false ? [{ label: EMAIL_WORDS.emailRouting, value: { text: EMAIL_WORDS.routingOff } }] : []
}

/** The value of a catch-all's state: `off` while it is disabled, else its action. */
export function stateValue(state: CatchAllState): CallFact["value"] {
  return state === "disabled" ? { text: EMAIL_WORDS.off } : actionText(state)
}
