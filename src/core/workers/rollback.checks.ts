import { ToolError } from "../errors"
import type { Deployment } from "./shape"

/** The message a rollback carries when the caller gives none. */
export const DEFAULT_MESSAGE = "Rolled back"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LINE_BREAK = /[\r\n]/
const MAX_MESSAGE_LENGTH = 100
const STEPS_PER_PERCENT = 100
const FULL_SHARE = 100 * STEPS_PER_PERCENT
const MIN_SHARE = 1
const ROUNDING_TOLERANCE = 1e-6

/** One version of the requested split; the share is in hundredths of a percent, so sums compare as integers. */
export type SplitEntry = { versionId: string; share: number }

/** What a caller asks for, checked and normalized. */
export type RollbackRequest = { split: SplitEntry[]; replaces: string; message: string }

type RollbackArguments = {
  versions: { version_id: string; percentage: number }[]
  replaces: string
  message?: string
}

function refuse(problem: string): never {
  throw new ToolError("invalid_argument", problem)
}

function asUuid(value: string, field: string): string {
  if (!UUID_PATTERN.test(value)) refuse(`${field} must be a UUID, as cloudflare_workers_read deployments shows it.`)
  return value.toLowerCase()
}

function shareOf(percentage: number, field: string): number {
  const scaled = percentage * STEPS_PER_PERCENT
  const share = Math.round(scaled)
  if (Math.abs(scaled - share) > ROUNDING_TOLERANCE || share < MIN_SHARE || share > FULL_SHARE) {
    refuse(`${field}: percentage must be a number from 0.01 to 100 with at most two decimals.`)
  }
  return share
}

function oneLine(message: string | undefined): string {
  if (message === undefined) return DEFAULT_MESSAGE
  const trimmed = message.trim()
  const length = Array.from(trimmed).length
  if (LINE_BREAK.test(message) || length < 1 || length > MAX_MESSAGE_LENGTH) {
    refuse(`\`message\` must be one line of 1 to ${MAX_MESSAGE_LENGTH} characters.`)
  }
  return trimmed
}

/** Checks the arguments alone, before anything is read: ids, shares, their sum, the message. */
export function parseRequest(args: RollbackArguments): RollbackRequest {
  const firstSeen = new Map<string, number>()
  const split = args.versions.map((entry, index) => {
    const field = `versions[${index}]`
    const versionId = asUuid(entry.version_id, `${field}.version_id`)
    const earlier = firstSeen.get(versionId)
    if (earlier !== undefined) {
      refuse(`${field} repeats versions[${earlier}]: the version ${versionId} can be listed once.`)
    }
    firstSeen.set(versionId, index)
    return { versionId, share: shareOf(entry.percentage, field) }
  })
  const total = split.reduce((sum, entry) => sum + entry.share, 0)
  if (total !== FULL_SHARE) refuse(`versions: the percentages add up to ${toPercentage(total)}, not 100.`)
  return { split, replaces: asUuid(args.replaces, "`replaces`"), message: oneLine(args.message) }
}

/** A share in hundredths of a percent, as the percentage Cloudflare takes. */
export function toPercentage(share: number): number {
  return share / STEPS_PER_PERCENT
}

/** The versions a deployment serves, by lowercase id, each with its share in hundredths of a percent; a share that rounds to none is left out. */
export function sharesOf(deployment: Deployment): Map<string, number> {
  const shares = new Map<string, number>()
  for (const entry of deployment.versions) {
    const share = Math.round(entry.percentage * STEPS_PER_PERCENT)
    if (share > 0) shares.set(entry.version_id.toLowerCase(), share)
  }
  return shares
}

function describeServing(deployment: Deployment): string {
  return `deployment ${deployment.id} (${deployment.created_on ?? "date unknown"})`
}

/** What the checks against the Worker's history found: the deployment serving now and where each requested version served before. */
export type History = { serving: Deployment; servedIn: string[] }

/**
 * Checks the request against the deployments, latest first: some deployment exists, the first is `replaces`
 * (else `stale`), every requested version had a share in an earlier one, and the split is not the serving one.
 */
export function checkHistory(script: string, request: RollbackRequest, deployments: Deployment[]): History {
  const [serving, ...earlier] = deployments
  if (serving === undefined) {
    refuse(`Worker ${script} has no deployment, so there is nothing to roll back.`)
  }
  if (serving.id.toLowerCase() !== request.replaces) {
    throw new ToolError(
      "stale",
      `Worker ${script} is now serving ${describeServing(serving)}, not ${request.replaces}: another deployment came first. Read cloudflare_workers_read deployments again before rolling back.`,
    )
  }

  const servedIn = request.split.map((entry, index) => {
    const found = earlier.find((deployment) => sharesOf(deployment).has(entry.versionId))
    if (found === undefined) {
      refuse(
        `versions[${index}]: version ${entry.versionId} never served traffic before the deployment serving now, so this is not a rollback; deploying new code stays with Wrangler (wrangler versions deploy).`,
      )
    }
    return found.created_on === null ? "an earlier deployment" : `a deployment of ${found.created_on}`
  })

  const current = sharesOf(serving)
  if (
    current.size === request.split.length &&
    request.split.every((entry) => current.get(entry.versionId) === entry.share)
  ) {
    refuse(
      `versions: the split is already what Worker ${script} serves (${describeServing(serving)}), so there is nothing to roll back.`,
    )
  }
  return { serving, servedIn }
}

/** The one plain line the person is asked to approve. */
export function confirmation(script: string, label: string, request: RollbackRequest, history: History): string {
  const next = request.split
    .map((entry, index) => `${entry.versionId} at ${toPercentage(entry.share)}% (served in ${history.servedIn[index]})`)
    .join(" and ")
  const current = [...sharesOf(history.serving)]
    .map(([versionId, share]) => `${versionId} at ${toPercentage(share)}%`)
    .join(" and ")
  return `Roll back Worker ${script} in the Cloudflare account ${label}: serve ${next} instead of ${current}. Visitors get that code at once; the Worker's secrets stay as they are now.`
}
