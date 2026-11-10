import { z } from "zod"
import { RULESET_ID_PATTERN } from "../cloudflare/routes"

/** The most characters a rule's filter expression may hold. */
export const EXPRESSION_MAX_LENGTH = 4096

/** The most characters a rule's description may hold. */
export const DESCRIPTION_MAX_LENGTH = 500

/** The id of a rule of a phase: 32 lowercase hex digits. */
export const ruleIdArg = z.string().regex(RULESET_ID_PATTERN, "must be a rule id: 32 lowercase hex digits")
