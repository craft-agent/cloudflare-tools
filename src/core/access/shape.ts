import { z } from "zod"

export const accountLabelSchema = z.string().describe("The account label.")

export const zoneSchema = z.object({
  id: z.string().describe("The zone id."),
  name: z.string().describe("The zone domain name."),
})

export function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

export function numberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null
}

export function booleanOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null
}

/** The strings of a list; a missing or non-list value gives an empty list. */
export function stringsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

/** Filters and maps rows, dropping entries that cannot be shaped. */
export function shapeRows<T>(rows: unknown[], shape: (row: unknown) => T | undefined): T[] {
  return rows.flatMap((row) => {
    const shaped = shape(row)
    return shaped ? [shaped] : []
  })
}
