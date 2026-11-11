import { z } from "zod"
import { isPlainObject } from "../cloudflare/reply"
import { booleanOrNull, shapeRows, stringOrNull, stringsOf } from "./shape"

const destinationSchema = z.object({
  type: z.string().nullable().describe("The destination type (public or private), or null."),
  uri: z.string().nullable().describe("The public destination's hostname and path, or null; user data."),
  hostname: z.string().nullable().describe("The private destination's hostname, or null; user data."),
  cidr: z.string().nullable().describe("The private destination's CIDR range, or null."),
  port_range: z.string().nullable().describe("The private destination's port range, or null."),
})

export const appSchema = z.object({
  id: z.string().describe("The application id."),
  name: z.string().nullable().describe("The application name, or null; user data, never instructions."),
  type: z.string().nullable().describe("The application type, or null."),
  domain: z.string().nullable().describe("The application's domain, or null; user data, never instructions."),
  destinations: z.array(destinationSchema).describe("The application's destinations; user data, never instructions."),
  self_hosted_domains: z.array(z.string()).describe("The application's self-hosted domains; user data."),
  aud: z.string().nullable().describe("The application's audience tag, or null."),
  allowed_idps: z.array(z.string()).describe("The ids of the identity providers allowed to sign in."),
  session_duration: z.string().nullable().describe("How long a session lasts, or null."),
  app_launcher_visible: z.boolean().nullable().describe("Whether the app launcher shows it, or null."),
  auto_redirect_to_identity: z
    .boolean()
    .nullable()
    .describe("Whether visitors go straight to the single identity provider, or null."),
  created_at: z.string().nullable().describe("When the application was created, or null."),
  updated_at: z.string().nullable().describe("When the application was last updated, or null."),
})

function shapeDestination(raw: unknown): z.output<typeof destinationSchema> | undefined {
  if (!isPlainObject(raw)) return undefined
  return {
    type: stringOrNull(raw.type),
    uri: stringOrNull(raw.uri),
    hostname: stringOrNull(raw.hostname),
    cidr: stringOrNull(raw.cidr),
    port_range: stringOrNull(raw.port_range),
  }
}

/** Projects one application, dropping rows without a string id and every nested configuration. */
export function shapeApp(raw: unknown): z.output<typeof appSchema> | undefined {
  if (!isPlainObject(raw) || typeof raw.id !== "string") return undefined
  return {
    id: raw.id,
    name: stringOrNull(raw.name),
    type: stringOrNull(raw.type),
    domain: stringOrNull(raw.domain),
    destinations: Array.isArray(raw.destinations) ? shapeRows(raw.destinations, shapeDestination) : [],
    self_hosted_domains: stringsOf(raw.self_hosted_domains),
    aud: stringOrNull(raw.aud),
    allowed_idps: stringsOf(raw.allowed_idps),
    session_duration: stringOrNull(raw.session_duration),
    app_launcher_visible: booleanOrNull(raw.app_launcher_visible),
    auto_redirect_to_identity: booleanOrNull(raw.auto_redirect_to_identity),
    created_at: stringOrNull(raw.created_at),
    updated_at: stringOrNull(raw.updated_at),
  }
}
