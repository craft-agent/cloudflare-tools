import { domainToASCII } from "node:url"
import { ToolError } from "../errors"

const APEX = "@"
const WILDCARD = "*"
const MAX_NAME_LENGTH = 253
const MAX_LABEL_LENGTH = 63
const LABEL_PATTERN = /^[a-z0-9_-]+$/
const NON_ASCII_PATTERN = /[^\x00-\x7f]/

function refuse(input: string, reason: string): never {
  throw new ToolError("invalid_argument", `"${input}" is not a valid record name: ${reason}.`)
}

function isUnder(name: string, zone: string): boolean {
  return name === zone || name.endsWith(`.${zone}`)
}

/** Converts IDN labels to punycode, leaving a leading `*` label alone; a name that is plain ASCII is kept as it is. */
function toAscii(name: string, input: string): string {
  if (!NON_ASCII_PATTERN.test(name)) return name
  const wildcard = name.startsWith(`${WILDCARD}.`)
  const ascii = domainToASCII(wildcard ? name.slice(WILDCARD.length + 1) : name)
  if (!ascii) refuse(input, "it holds a character a DNS name cannot hold")
  return wildcard ? `${WILDCARD}.${ascii}` : ascii
}

function assertValidLabel(label: string, index: number, input: string): void {
  if (label === "") refuse(input, "it has an empty label")
  if (label.length > MAX_LABEL_LENGTH) refuse(input, `a label is longer than ${MAX_LABEL_LENGTH} characters`)
  if (label === WILDCARD) {
    if (index !== 0) refuse(input, `\`${WILDCARD}\` is allowed only as the whole leftmost label`)
    return
  }
  if (!LABEL_PATTERN.test(label)) {
    refuse(
      input,
      `label "${label}" may hold only letters, digits, \`-\` and \`_\` (\`${WILDCARD}\` only as the whole leftmost label)`,
    )
  }
  if (label.startsWith("-") || label.endsWith("-")) refuse(input, `label "${label}" starts or ends with \`-\``)
}

/**
 * The full lowercased ASCII name `input` stands for in `zone` (the zone's ASCII name).
 * `input` may be relative to the zone (`www`), the apex (`@`, or the zone itself) or a full name, with or without a trailing dot;
 * a name with a trailing dot is always full and must lie under the zone. Anything else is `invalid_argument`.
 */
export function recordName(input: string, zone: string): string {
  const lower = input.trim().toLowerCase()
  if (lower === "") refuse(input, "it is empty")
  if (lower === APEX) return zone

  const isFull = lower.endsWith(".")
  const bare = isFull ? lower.slice(0, -1) : lower
  if (bare === "") refuse(input, "it is empty")

  const ascii = toAscii(bare, input)
  const name = isUnder(ascii, zone)
    ? ascii
    : isFull
      ? refuse(input, `it is not in the zone ${zone}`)
      : `${ascii}.${zone}`

  if (name.length > MAX_NAME_LENGTH) refuse(input, `the full name is longer than ${MAX_NAME_LENGTH} characters`)
  name.split(".").forEach((label, index) => assertValidLabel(label, index, input))
  if (!isUnder(name, zone)) refuse(input, `it is not in the zone ${zone}`)
  return name
}

/** `@` for the zone's apex, else the part of `name` before `.${zone}`; a name outside the zone is returned as it is. */
export function relativeName(name: string, zone: string): string {
  if (name === zone) return APEX
  return name.endsWith(`.${zone}`) ? name.slice(0, -(zone.length + 1)) : name
}
