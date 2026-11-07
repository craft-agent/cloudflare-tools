import { z } from "zod"
import { isPlainObject } from "../cloudflare/reply"

/** How many characters of a message or tag a result keeps. */
export const MAX_TEXT_LENGTH = 200

const MESSAGE_ANNOTATION = "workers/message"
const TAG_ANNOTATION = "workers/tag"
const TRIGGERED_BY_ANNOTATION = "workers/triggered_by"

/** Text people wrote, cut to `MAX_TEXT_LENGTH` characters and ended with "…" when it was longer. */
export function clipText(text: string): string {
  if (text.length <= MAX_TEXT_LENGTH) return text
  const characters = Array.from(text)
  return characters.length <= MAX_TEXT_LENGTH ? text : `${characters.slice(0, MAX_TEXT_LENGTH).join("")}…`
}

function asObject(value: unknown): Record<string, unknown> {
  return isPlainObject(value) ? value : {}
}

function textOr<T extends string | null>(value: unknown, fallback: T): string | T {
  return typeof value === "string" ? value : fallback
}

function clippedOrNull(value: unknown): string | null {
  return typeof value === "string" ? clipText(value) : null
}

function stringsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function listOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export const scriptListItemSchema = z.object({
  name: z.string().describe("The Worker's name."),
  created_on: z.string().nullable().describe("When the Worker was created, or null."),
  modified_on: z.string().nullable().describe("When the Worker was last modified, or null."),
  compatibility_date: z.string().nullable().describe("The Worker's compatibility date, or null."),
  usage_model: z.string().nullable().describe("The Worker's usage model (e.g. standard), or null."),
  handlers: z.array(z.string()).describe("The handlers the Worker exports (e.g. fetch, scheduled)."),
  has_assets: z.boolean().describe("Whether the Worker serves static assets."),
})

export const tailConsumerSchema = z.object({
  service: z.string().describe("The Worker that receives this Worker's logs."),
  environment: z.string().nullable().describe("The consumer's environment, or null."),
  namespace: z.string().nullable().describe("The consumer's dispatch namespace, or null."),
})

export const bindingSchema = z.object({
  name: z.string().describe("The binding's name in the Worker's code."),
  type: z.string().describe("The binding's type (e.g. kv_namespace, plain_text, secret_text)."),
})

export const workersDevSchema = z.object({
  enabled: z.boolean().describe("Whether the Worker is served on its workers.dev address."),
  previews_enabled: z.boolean().describe("Whether its version previews are served on workers.dev."),
})

export const deploymentVersionSchema = z.object({
  version_id: z.string().describe("The version's id."),
  percentage: z.number().describe("The share of traffic the version gets, in percent."),
})

export const deploymentSchema = z.object({
  id: z.string().describe("The deployment id."),
  created_on: z.string().nullable().describe("When the deployment was made, or null."),
  source: z.string().nullable().describe("What made the deployment (e.g. wrangler, api, dash), or null."),
  author_email: z.string().nullable().describe("The email of whoever made the deployment, or null."),
  message: z.string().nullable().describe("The deployment's message, clipped to 200 characters, or null."),
  triggered_by: z.string().nullable().describe("What triggered the deployment (e.g. deploy, rollback), or null."),
  versions: z.array(deploymentVersionSchema).describe("The versions the deployment serves, with their traffic shares."),
})

export const versionSchema = z.object({
  id: z.string().describe("The version id."),
  number: z.number().nullable().describe("The version's number, counting from 1, or null."),
  created_on: z.string().nullable().describe("When the version was uploaded, or null."),
  source: z.string().nullable().describe("What uploaded the version (e.g. wrangler, api, dash), or null."),
  author_email: z.string().nullable().describe("The email of whoever uploaded the version, or null."),
  message: z.string().nullable().describe("The version's message, clipped to 200 characters, or null."),
  tag: z.string().nullable().describe("The version's tag, clipped to 200 characters, or null."),
})

export const workerZoneSchema = z.object({
  id: z.string().describe("The zone id."),
  name: z.string().describe("The zone's domain name."),
})

export const routeSchema = z.object({
  id: z.string().describe("The route id."),
  pattern: z.string().describe("The URL pattern the route matches."),
  script: z.string().nullable().describe("The Worker's name, or null when the pattern is excluded from every Worker."),
})

export const domainSchema = z.object({
  id: z.string().describe("The custom domain id."),
  hostname: z.string().describe("The custom domain's hostname."),
  script: z.string().describe("The Worker served on the custom domain."),
  zone: workerZoneSchema.describe("The zone the custom domain belongs to."),
  enabled: z.boolean().describe("Whether the custom domain is enabled."),
  previews_enabled: z.boolean().describe("Whether version previews are enabled on the custom domain."),
})

export const scheduleSchema = z.object({
  cron: z.string().nullable().describe("The cron expression; times are UTC, or null when missing."),
  created_on: z.string().nullable().describe("When the cron trigger was created, or null."),
  modified_on: z.string().nullable().describe("When the cron trigger was last modified, or null."),
})

export const secretSchema = z.object({
  name: z.string().describe("The secret's name."),
  type: z.string().describe("The secret's type; never its value."),
})

type ScriptListItem = z.infer<typeof scriptListItemSchema>
type ScriptSettings = {
  compatibility_date: string | null
  compatibility_flags: string[]
  usage_model: string | null
  placement: string | null
  observability: boolean
  logpush: boolean
  tail_consumers: z.infer<typeof tailConsumerSchema>[]
  bindings: z.infer<typeof bindingSchema>[]
}
type WorkersDev = z.infer<typeof workersDevSchema>
export type Deployment = z.infer<typeof deploymentSchema>
type Version = z.infer<typeof versionSchema>

/** One Worker as the list shows it; missing or odd fields become null, [] and false. */
export function shapeScript(raw: unknown): ScriptListItem {
  const item = asObject(raw)
  return {
    name: textOr(item.id, ""),
    created_on: textOr(item.created_on, null),
    modified_on: textOr(item.modified_on, null),
    compatibility_date: textOr(item.compatibility_date, null),
    usage_model: textOr(item.usage_model, null),
    handlers: stringsOf(item.handlers),
    has_assets: item.has_assets === true,
  }
}

/** A Worker's settings. Bindings keep their name and type only: the other fields of a binding can hold values. */
export function shapeSettings(raw: unknown): ScriptSettings {
  const settings = asObject(raw)
  return {
    compatibility_date: textOr(settings.compatibility_date, null),
    compatibility_flags: stringsOf(settings.compatibility_flags),
    usage_model: textOr(settings.usage_model, null),
    placement: textOr(asObject(settings.placement).mode, null),
    observability: asObject(settings.observability).enabled === true,
    logpush: settings.logpush === true,
    tail_consumers: listOf(settings.tail_consumers).map((entry) => {
      const consumer = asObject(entry)
      return {
        service: textOr(consumer.service, ""),
        environment: textOr(consumer.environment, null),
        namespace: textOr(consumer.namespace, null),
      }
    }),
    bindings: listOf(settings.bindings).map((entry) => {
      const binding = asObject(entry)
      return { name: textOr(binding.name, ""), type: textOr(binding.type, "") }
    }),
  }
}

/** The workers.dev switches of a Worker. */
export function shapeWorkersDev(raw: unknown): WorkersDev {
  const subdomain = asObject(raw)
  return { enabled: subdomain.enabled === true, previews_enabled: subdomain.previews_enabled === true }
}

/** One deployment; its message is clipped. */
export function shapeDeployment(raw: unknown): Deployment {
  const item = asObject(raw)
  const annotations = asObject(item.annotations)
  return {
    id: textOr(item.id, ""),
    created_on: textOr(item.created_on, null),
    source: textOr(item.source, null),
    author_email: textOr(item.author_email, null),
    message: clippedOrNull(annotations[MESSAGE_ANNOTATION]),
    triggered_by: textOr(annotations[TRIGGERED_BY_ANNOTATION], null),
    versions: listOf(item.versions).map((entry) => {
      const served = asObject(entry)
      return {
        version_id: textOr(served.version_id, ""),
        percentage: typeof served.percentage === "number" ? served.percentage : 0,
      }
    }),
  }
}

/** One version; its message and tag are clipped, and `annotations` is a field of the version itself. */
export function shapeVersion(raw: unknown): Version {
  const item = asObject(raw)
  const metadata = asObject(item.metadata)
  const annotations = asObject(item.annotations)
  return {
    id: textOr(item.id, ""),
    number: typeof item.number === "number" ? item.number : null,
    created_on: textOr(metadata.created_on, null),
    source: textOr(metadata.source, null),
    author_email: textOr(metadata.author_email, null),
    message: clippedOrNull(annotations[MESSAGE_ANNOTATION]),
    tag: clippedOrNull(annotations[TAG_ANNOTATION]),
  }
}

/** One route; a null script excludes the pattern from every Worker. */
export function shapeRoute(raw: unknown): z.infer<typeof routeSchema> {
  const item = asObject(raw)
  return { id: textOr(item.id, ""), pattern: textOr(item.pattern, ""), script: textOr(item.script, null) }
}

/** One custom domain, without certificate or environment fields. */
export function shapeDomain(raw: unknown): z.infer<typeof domainSchema> {
  const item = asObject(raw)
  return {
    id: textOr(item.id, ""),
    hostname: textOr(item.hostname, ""),
    script: textOr(item.service, ""),
    zone: { id: textOr(item.zone_id, ""), name: textOr(item.zone_name, "") },
    enabled: item.enabled !== false,
    previews_enabled: item.previews_enabled === true,
  }
}

/** One cron trigger; cron times are UTC. */
export function shapeSchedule(raw: unknown): z.infer<typeof scheduleSchema> {
  const item = asObject(raw)
  return {
    cron: textOr(item.cron, null),
    created_on: textOr(item.created_on, null),
    modified_on: textOr(item.modified_on, null),
  }
}

/** One secret's name and type only; other fields can hold values. */
export function shapeSecret(raw: unknown): z.infer<typeof secretSchema> {
  const item = asObject(raw)
  return { name: textOr(item.name, ""), type: textOr(item.type, "") }
}
