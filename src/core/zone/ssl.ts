import { z } from "zod"
import { cloudflareClient, type CloudflareDeps } from "../cloudflare/client"
import { isPlainObject, pagingFields } from "../cloudflare/reply"
import { ROUTES } from "../cloudflare/routes"
import type { ToolContext } from "../tool"
import { resolveZone } from "./lookup"

export const certificateItemSchema = z.object({
  id: z.string().describe("The certificate id."),
  hosts: z.array(z.string()).describe("Hostnames covered by the certificate."),
  status: z.string().nullable().describe("Certificate status (e.g. active, expired)."),
  expires_on: z.string().nullable().describe("When the certificate expires, or null."),
})

export type CertificateItem = z.infer<typeof certificateItemSchema>

export const certificatePackSchema = z.object({
  id: z.string().describe("The certificate pack id."),
  type: z.string().nullable().describe("Certificate pack type (e.g. universal, advanced)."),
  hosts: z.array(z.string()).describe("Hostnames covered by the certificate pack."),
  status: z.string().nullable().describe("Pack status (e.g. active, pending_validation)."),
  certificate_authority: z.string().nullable().describe("Certificate authority (e.g. lets_encrypt, google)."),
  validation_method: z.string().nullable().describe("Validation method (e.g. txt, http, email)."),
  certificates: z.array(certificateItemSchema).describe("Certificates within the pack."),
})

export type CertificatePack = z.infer<typeof certificatePackSchema>

export const dnssecSchema = z.object({
  status: z.string().nullable().describe("DNSSEC status (e.g. active, disabled)."),
  ds: z.string().nullable().describe("DS record string."),
  digest: z.string().nullable().describe("Digest value."),
  digest_type: z.string().nullable().describe("Digest type."),
  algorithm: z.string().nullable().describe("Algorithm used."),
  key_tag: z.number().nullable().describe("Key tag."),
  flags: z.number().nullable().describe("Flags."),
  public_key: z.string().nullable().describe("Public key."),
  modified_on: z.string().nullable().describe("When DNSSEC was last modified."),
})

export type Dnssec = z.infer<typeof dnssecSchema>

export type SslArgs = {
  account?: string
  zone: string
  page?: number
}

export type SslOutput = {
  label: string
  zone: { id: string; name: string }
  universal_ssl: { enabled: boolean | null }
  certificate_packs: CertificatePack[]
  page: number | null
  total_count: number | null
  total_pages: number | null
}

export type DnssecArgs = {
  account?: string
  zone: string
}

export type DnssecOutput = {
  label: string
  zone: { id: string; name: string }
  dnssec: Dnssec
}

/** Reads Universal SSL settings and certificate packs for a zone. */
export async function readSsl(args: SslArgs, ctx: ToolContext, deps?: CloudflareDeps): Promise<SslOutput> {
  const client = cloudflareClient(args.account, { ...deps, signal: ctx.signal })
  const zone = await resolveZone(client, args.zone)

  const [sslReply, certsReply] = await Promise.all([
    client.request<unknown>(ROUTES.universalSsl, { path: { zone_id: zone.id } }),
    client.request<unknown>(ROUTES.certificatePacks, {
      path: { zone_id: zone.id },
      query: { status: "all", per_page: 50, ...(args.page !== undefined ? { page: args.page } : {}) },
    }),
  ])

  const sslRaw = isPlainObject(sslReply.result) ? sslReply.result : {}
  const universalSsl = {
    enabled: typeof sslRaw.enabled === "boolean" ? sslRaw.enabled : null,
  }

  const rawPacks = Array.isArray(certsReply.result) ? certsReply.result : []
  const certificatePacks: CertificatePack[] = rawPacks.map((pack) => {
    const p = isPlainObject(pack) ? pack : {}
    const rawCerts = Array.isArray(p.certificates) ? p.certificates : []
    const certificates: CertificateItem[] = rawCerts.map((cert) => {
      const c = isPlainObject(cert) ? cert : {}
      return {
        id: typeof c.id === "string" ? c.id : "",
        hosts: Array.isArray(c.hosts) ? c.hosts.filter((h): h is string => typeof h === "string") : [],
        status: typeof c.status === "string" ? c.status : null,
        expires_on: typeof c.expires_on === "string" ? c.expires_on : null,
      }
    })

    return {
      id: typeof p.id === "string" ? p.id : "",
      type: typeof p.type === "string" ? p.type : null,
      hosts: Array.isArray(p.hosts) ? p.hosts.filter((h): h is string => typeof h === "string") : [],
      status: typeof p.status === "string" ? p.status : null,
      certificate_authority: typeof p.certificate_authority === "string" ? p.certificate_authority : null,
      validation_method: typeof p.validation_method === "string" ? p.validation_method : null,
      certificates,
    }
  })

  const { page, total_count, total_pages } = pagingFields(certsReply.resultInfo)

  return {
    label: client.label,
    zone: { id: zone.id, name: zone.name },
    universal_ssl: universalSsl,
    certificate_packs: certificatePacks,
    page,
    total_count,
    total_pages,
  }
}

/** Shapes Cloudflare DNSSEC response object into Dnssec. */
export function shapeDnssec(raw: unknown): Dnssec {
  const r = isPlainObject(raw) ? raw : {}
  return {
    status: typeof r.status === "string" ? r.status : null,
    ds: typeof r.ds === "string" ? r.ds : null,
    digest: typeof r.digest === "string" ? r.digest : null,
    digest_type: typeof r.digest_type === "string" ? r.digest_type : null,
    algorithm: typeof r.algorithm === "string" ? r.algorithm : null,
    key_tag: typeof r.key_tag === "number" ? r.key_tag : null,
    flags: typeof r.flags === "number" ? r.flags : null,
    public_key: typeof r.public_key === "string" ? r.public_key : null,
    modified_on: typeof r.modified_on === "string" ? r.modified_on : null,
  }
}

/** Reads DNSSEC configuration for a zone. */
export async function readDnssec(args: DnssecArgs, ctx: ToolContext, deps?: CloudflareDeps): Promise<DnssecOutput> {
  const client = cloudflareClient(args.account, { ...deps, signal: ctx.signal })
  const zone = await resolveZone(client, args.zone)

  const reply = await client.request<unknown>(ROUTES.dnssec, { path: { zone_id: zone.id } })

  return {
    label: client.label,
    zone: { id: zone.id, name: zone.name },
    dnssec: shapeDnssec(reply.result),
  }
}
