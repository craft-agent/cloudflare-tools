import { z } from "zod"
import { isPlainObject } from "../cloudflare/reply"
import { clipText } from "../workers/shape"

const MS_PER_SECOND = 1000

export const namespaceSchema = z.object({
  id: z.string().describe("The namespace's id."),
  title: z.string().nullable().describe("The namespace title, clipped to 200 characters, or null."),
})

export const keySchema = z.object({
  name: z.string().describe("The key's name, clipped to 200 characters."),
  expires: z.string().nullable().describe("The key's UTC expiration time, or null."),
})

/** Shapes a namespace without copying other fields. */
export function shapeNamespace(raw: unknown): z.output<typeof namespaceSchema> | undefined {
  if (!isPlainObject(raw) || typeof raw.id !== "string") return undefined
  return { id: raw.id, title: typeof raw.title === "string" ? clipText(raw.title) : null }
}

/** Shapes key names and expiration times, never values or metadata. */
export function shapeKey(raw: unknown): z.output<typeof keySchema> | undefined {
  if (!isPlainObject(raw) || typeof raw.name !== "string") return undefined
  const date = typeof raw.expiration === "number" ? new Date(raw.expiration * MS_PER_SECOND) : null
  return {
    name: clipText(raw.name),
    expires: date && Number.isFinite(date.getTime()) ? date.toISOString() : null,
  }
}
