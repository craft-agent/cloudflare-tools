import { z } from "zod"
import { isPlainObject } from "../cloudflare/reply"
import { ToolError } from "../errors"
import { clipText } from "../workers/shape"

export const databaseSchema = z.object({
  id: z.string().describe("The database's id."),
  name: z.string().nullable().describe("The database name, clipped to 200 characters, or null."),
  created: z.string().nullable().describe("When the database was created, or null."),
  version: z.string().nullable().describe("The database version, or null."),
})

export const databaseDetailSchema = databaseSchema.extend({
  size: z.number().nullable().describe("The database size in bytes, or null."),
  read_replication: z.string().nullable().describe("Read replication mode, or null."),
})

const schemaEntrySchema = z.object({
  name: z.string().describe("The schema object's name, clipped to 200 characters."),
  table: z.string().nullable().describe("Its table when different from its name, or null."),
  sql: z.string().nullable().describe("The complete schema SQL, returned as data, or null."),
})

export const schemaSchema = z.object({
  tables: z.array(schemaEntrySchema),
  indexes: z.array(schemaEntrySchema),
  views: z.array(schemaEntrySchema),
  triggers: z.array(schemaEntrySchema),
})

const SCHEMA_GROUPS = { table: "tables", index: "indexes", view: "views", trigger: "triggers" } as const

/** Shapes database metadata without copying other fields. */
export function shapeDatabase(raw: unknown): z.output<typeof databaseSchema> | undefined {
  if (!isPlainObject(raw) || typeof raw.uuid !== "string") return undefined
  return {
    id: raw.uuid,
    name: typeof raw.name === "string" ? clipText(raw.name) : null,
    created: typeof raw.created_at === "string" ? raw.created_at : null,
    version: typeof raw.version === "string" ? raw.version : null,
  }
}

/** Shapes one database's details, refusing an unexpected response. */
export function shapeDatabaseDetail(raw: unknown): z.output<typeof databaseDetailSchema> {
  const database = shapeDatabase(raw)
  if (!database || !isPlainObject(raw)) {
    throw new ToolError("upstream_error", "Cloudflare returned an unexpected D1 database response.")
  }
  const replication = isPlainObject(raw.read_replication) ? raw.read_replication : undefined
  return {
    ...database,
    size: typeof raw.file_size === "number" ? raw.file_size : null,
    read_replication: typeof replication?.mode === "string" ? replication.mode : null,
  }
}

/** Groups the fixed schema query's first statement result, never reading table rows. */
export function shapeSchema(raw: unknown): z.output<typeof schemaSchema> {
  const statement = Array.isArray(raw) ? raw[0] : undefined
  if (!isPlainObject(statement) || statement.success !== true || !Array.isArray(statement.results)) {
    throw new ToolError("upstream_error", "Cloudflare returned an unexpected D1 schema response.")
  }
  const schema: z.output<typeof schemaSchema> = { tables: [], indexes: [], views: [], triggers: [] }
  for (const row of statement.results) {
    if (!isPlainObject(row) || typeof row.name !== "string") continue
    if (row.type !== "table" && row.type !== "index" && row.type !== "view" && row.type !== "trigger") continue
    schema[SCHEMA_GROUPS[row.type]].push({
      name: clipText(row.name),
      table: typeof row.tbl_name === "string" && row.tbl_name !== row.name ? row.tbl_name : null,
      sql: typeof row.sql === "string" ? row.sql : null,
    })
  }
  return schema
}
