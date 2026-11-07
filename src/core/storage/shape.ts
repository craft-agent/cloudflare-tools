import { z } from "zod"
import { isPlainObject } from "../cloudflare/reply"
import { clipText } from "../workers/shape"

export const bucketSchema = z.object({
  name: z.string().describe("The bucket's name."),
  created: z.string().nullable().describe("When the bucket was created, or null."),
  location: z.string().nullable().describe("The bucket's location (e.g. wnam, enam), or null."),
  storage_class: z.string().nullable().describe("The bucket's default storage class (e.g. Standard), or null."),
})

export type Bucket = z.output<typeof bucketSchema>

/** Shapes an R2 bucket API response entry into a clean bucket record, or undefined if invalid. */
export function shapeBucket(raw: unknown): Bucket | undefined {
  if (!isPlainObject(raw) || typeof raw.name !== "string") return undefined
  return {
    name: raw.name,
    created: typeof raw.creation_date === "string" ? raw.creation_date : null,
    location: typeof raw.location === "string" ? raw.location : null,
    storage_class: typeof raw.storage_class === "string" ? raw.storage_class : null,
  }
}

export const objectSchema = z.object({
  key: z.string().describe("The object's key (path), clipped to 200 characters."),
  size: z.number().nullable().describe("The object's size in bytes, or null."),
  last_modified: z.string().nullable().describe("When the object was last modified, or null."),
  content_type: z.string().nullable().describe("The object's Content-Type, or null."),
})

export type StorageObject = z.output<typeof objectSchema>

/** Shapes an R2 object API response entry into a clean object record, never copying custom metadata or etag. */
export function shapeObject(raw: unknown): StorageObject | undefined {
  if (!isPlainObject(raw) || typeof raw.key !== "string") return undefined
  const httpMeta = isPlainObject(raw.http_metadata) ? raw.http_metadata : undefined
  const contentType = typeof httpMeta?.contentType === "string" ? httpMeta.contentType : null
  return {
    key: clipText(raw.key),
    size: typeof raw.size === "number" ? raw.size : null,
    last_modified: typeof raw.last_modified === "string" ? raw.last_modified : null,
    content_type: contentType,
  }
}

export const r2DevSchema = z.object({
  enabled: z.boolean().describe("Whether the r2.dev managed domain is enabled."),
  domain: z.string().nullable().describe("The r2.dev domain name, or null."),
})

export type R2Dev = z.output<typeof r2DevSchema>

/** Shapes managed domain settings without copying the bucket ID. */
export function shapeR2Dev(raw: unknown): R2Dev {
  if (!isPlainObject(raw)) return { enabled: false, domain: null }
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : false,
    domain: typeof raw.domain === "string" ? raw.domain : null,
  }
}

export const customDomainSchema = z.object({
  domain: z.string().describe("The custom domain name."),
  enabled: z.boolean().nullable().describe("Whether the domain is enabled, or null."),
  ownership: z.string().nullable().describe("The domain ownership verification status, or null."),
  ssl: z.string().nullable().describe("The SSL status, or null."),
  zone: z.string().nullable().describe("The zone name, or null."),
})

export type CustomDomain = z.output<typeof customDomainSchema>

/** Shapes a custom domain, dropping entries without a domain name. */
export function shapeCustomDomain(raw: unknown): CustomDomain | undefined {
  if (!isPlainObject(raw) || typeof raw.domain !== "string") return undefined
  const status = isPlainObject(raw.status) ? raw.status : undefined
  return {
    domain: raw.domain,
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : null,
    ownership: typeof status?.ownership === "string" ? status.ownership : null,
    ssl: typeof status?.ssl === "string" ? status.ssl : null,
    zone: typeof raw.zoneName === "string" ? raw.zoneName : null,
  }
}

export const corsRuleSchema = z.object({
  id: z.string().nullable().describe("The CORS rule ID, or null."),
  origins: z.array(z.string()).describe("Allowed origins."),
  methods: z.array(z.string()).describe("Allowed HTTP methods."),
  headers: z.array(z.string()).describe("Allowed HTTP headers."),
  expose_headers: z.array(z.string()).describe("Exposed headers."),
  max_age_seconds: z.number().nullable().describe("Max age in seconds, or null."),
})

export type CorsRule = z.output<typeof corsRuleSchema>

function stringsArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

/** Shapes a CORS rule, keeping only strings in its header, method and origin lists. */
export function shapeCorsRule(raw: unknown): CorsRule | undefined {
  if (!isPlainObject(raw)) return undefined
  const allowed = isPlainObject(raw.allowed) ? raw.allowed : undefined
  return {
    id: typeof raw.id === "string" ? raw.id : null,
    origins: stringsArray(allowed?.origins),
    methods: stringsArray(allowed?.methods),
    headers: stringsArray(allowed?.headers),
    expose_headers: stringsArray(raw.exposeHeaders),
    max_age_seconds: typeof raw.maxAgeSeconds === "number" ? raw.maxAgeSeconds : null,
  }
}

export const lifecycleConditionSchema = z.object({
  type: z.string().nullable().describe("The condition type (e.g. Age, Date), or null."),
  max_age_seconds: z.number().nullable().describe("Max age in seconds, or null."),
  date: z.string().nullable().describe("Target date, or null."),
})

export type LifecycleCondition = z.output<typeof lifecycleConditionSchema>

/** Shapes an age or date condition, or null when absent. */
export function shapeLifecycleCondition(raw: unknown): LifecycleCondition | null {
  if (!isPlainObject(raw)) return null
  return {
    type: typeof raw.type === "string" ? raw.type : null,
    max_age_seconds: typeof raw.maxAge === "number" ? raw.maxAge : null,
    date: typeof raw.date === "string" ? raw.date : null,
  }
}

export const storageClassTransitionSchema = z.object({
  storage_class: z.string().nullable().describe("Target storage class, or null."),
  condition: lifecycleConditionSchema.nullable().describe("The transition condition, or null."),
})

export const lifecycleRuleSchema = z.object({
  id: z.string().nullable().describe("The lifecycle rule ID, or null."),
  enabled: z.boolean().nullable().describe("Whether the rule is enabled, or null."),
  prefix: z.string().nullable().describe("Prefix condition, or null."),
  delete_objects: lifecycleConditionSchema.nullable().describe("Delete objects transition condition, or null."),
  abort_multipart_uploads: lifecycleConditionSchema
    .nullable()
    .describe("Abort multipart uploads transition condition, or null."),
  storage_class_transitions: z.array(storageClassTransitionSchema).describe("Storage class transitions."),
})

export type LifecycleRule = z.output<typeof lifecycleRuleSchema>

/** Shapes lifecycle transitions without copying other rule fields. */
export function shapeLifecycleRule(raw: unknown): LifecycleRule | undefined {
  if (!isPlainObject(raw)) return undefined
  const conditions = isPlainObject(raw.conditions) ? raw.conditions : undefined
  const prefix = typeof conditions?.prefix === "string" ? conditions.prefix : null

  const deleteObjects = isPlainObject(raw.deleteObjectsTransition)
    ? shapeLifecycleCondition(raw.deleteObjectsTransition.condition)
    : null

  const abortMultipart = isPlainObject(raw.abortMultipartUploadsTransition)
    ? shapeLifecycleCondition(raw.abortMultipartUploadsTransition.condition)
    : null

  const rawTransitions = Array.isArray(raw.storageClassTransitions) ? raw.storageClassTransitions : []
  const storageClassTransitions = rawTransitions.flatMap((item) => {
    if (!isPlainObject(item)) return []
    return [
      {
        storage_class: typeof item.storageClass === "string" ? item.storageClass : null,
        condition: shapeLifecycleCondition(item.condition),
      },
    ]
  })

  return {
    id: typeof raw.id === "string" ? raw.id : null,
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : null,
    prefix,
    delete_objects: deleteObjects,
    abort_multipart_uploads: abortMultipart,
    storage_class_transitions: storageClassTransitions,
  }
}

export const publicAccessSchema = z.object({
  r2_dev: r2DevSchema.describe("r2.dev managed domain settings."),
  custom_domains: z.array(customDomainSchema).describe("Custom domains connected to the bucket."),
})
