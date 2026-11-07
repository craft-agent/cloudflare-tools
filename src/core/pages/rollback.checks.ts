import type { z } from "zod"
import { DEPLOYMENT_ID_PATTERN } from "../cloudflare/routes"
import { ToolError } from "../errors"
import { deploymentId } from "./projects"
import type { deploymentSchema, liveRefSchema } from "./shape"

const PRODUCTION = "production"
const BUILD_SUCCEEDED = "success"
const UNKNOWN = "unknown"

/** The production deployment serving now, as the project names it. */
export type Serving = z.infer<typeof liveRefSchema>

/** A deployment as the tools report it. */
export type Candidate = z.infer<typeof deploymentSchema>

/** What a caller asks for, checked and normalized: the deployment to serve and the one it replaces. */
export type RollbackRequest = { deployment: string; replaces: string }

function refuse(problem: string): never {
  throw new ToolError("invalid_argument", problem)
}

function replacesId(value: string): string {
  const id = value.trim().toLowerCase()
  if (!DEPLOYMENT_ID_PATTERN.test(id)) {
    refuse(
      "`replaces` must be the id (a UUID) of the production deployment serving now, as cloudflare_pages_read deployments shows it; not its short_id.",
    )
  }
  return id
}

/** Checks the arguments alone, before anything is read: both ids are UUIDs. */
export function parseRequest(args: { deployment: string; replaces: string }): RollbackRequest {
  return { deployment: deploymentId(args.deployment), replaces: replacesId(args.replaces) }
}

function nameOf(shortId: string | null, id: string): string {
  return shortId ?? id
}

function dateOf(createdOn: string | null): string {
  return createdOn ?? "date unknown"
}

/**
 * Checks the project's production deployment against the request: one is serving, it is `replaces` (else `stale`),
 * and it is not the deployment asked for.
 */
export function checkServing(project: string, serving: Serving | null, request: RollbackRequest): Serving {
  if (serving === null) {
    refuse(`Pages project ${project} has no production deployment serving now, so there is nothing to roll back from.`)
  }
  if (serving.id.toLowerCase() !== request.replaces) {
    throw new ToolError(
      "stale",
      `Pages project ${project} is now serving deployment ${nameOf(serving.short_id, serving.id)} (${serving.id}, ${dateOf(serving.created_on)}), not ${request.replaces}: another deployment or rollback came first. Read cloudflare_pages_read deployments again before rolling back.`,
    )
  }
  if (serving.id.toLowerCase() === request.deployment) {
    refuse(`Deployment ${nameOf(serving.short_id, serving.id)} is already what Pages project ${project} serves.`)
  }
  return serving
}

/** Checks that the deployment can serve production: a production one, not skipped, whose build succeeded. */
export function checkServable(target: Candidate): void {
  const name = nameOf(target.short_id, target.id ?? UNKNOWN)
  if (target.environment !== PRODUCTION) {
    refuse(`Deployment ${name} is a preview deployment; only a production deployment can serve production.`)
  }
  if (target.skipped) refuse(`Deployment ${name} was skipped, so it has nothing to serve.`)
  if (target.status.status !== BUILD_SUCCEEDED) {
    refuse(
      `Deployment ${name} did not build successfully (stage ${target.status.stage ?? UNKNOWN}: ${target.status.status ?? UNKNOWN}).`,
    )
  }
}

/** The one plain line the person is asked to approve. */
export function confirmation(project: string, label: string, serving: Serving, target: Candidate): string {
  const branch = target.trigger.branch === null ? "" : `, branch ${target.trigger.branch}`
  const next = `${nameOf(target.short_id, target.id ?? UNKNOWN)} (${dateOf(target.created_on)}${branch})`
  const current = nameOf(serving.short_id, serving.id)
  return `Roll back Pages project ${project} in the Cloudflare account ${label}: serve deployment ${next} instead of ${current} (${dateOf(serving.created_on)}). Visitors get it at once; rolling back again to ${current} undoes it.`
}
