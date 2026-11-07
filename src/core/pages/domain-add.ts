import { z } from "zod"
import { cloudflareClient, type CloudflareClient, type CloudflareDeps } from "../cloudflare/client"
import { isPlainObject } from "../cloudflare/reply"
import { ROUTES } from "../cloudflare/routes"
import { ToolError } from "../errors"
import { confirmWrite, defineTool, stepErrorsSchema, type ToolSpec } from "../tool"
import {
  domainInput,
  domainName,
  domainOutputBase,
  domainTargets,
  dnsSchema,
  failureOfWrite,
  readDnsStep,
} from "./domains"
import { projectName, requestProject, requireObject } from "./projects"
import { domainSchema, shapeDomain } from "./shape"

const output = z.object({
  ...domainOutputBase,
  domain: domainSchema.describe("The domain as Cloudflare reports it right after adding it: pending, not yet serving."),
  cname: z
    .strictObject({
      name: z.string().describe("The record's name: the hostname."),
      content: z.string().describe("The record's target: the project's pages.dev address."),
      proxied: z.boolean().describe("Whether the record is proxied; it must be."),
    })
    .describe("The DNS record the domain waits for; adding the domain creates none."),
  dns: dnsSchema.describe(
    "The records already at that name in the account's zone, or null when the account has no such zone. When no CNAME to `cname.content` is among them, create it with cloudflare_dns_record_add; when another record holds the name, the domain stays pending until the person decides what to do with it.",
  ),
  errors: stepErrorsSchema.optional(),
})

type DomainAddSpec = ToolSpec<typeof domainInput, typeof output>

/** The project's pages.dev address, which the domain's CNAME record points at. */
async function pagesAddress(client: CloudflareClient, project: string): Promise<string> {
  const reply = await requestProject<unknown>(client, ROUTES.pagesProject, project)
  const { subdomain } = requireObject(reply.result, "project")
  if (typeof subdomain !== "string" || subdomain === "") {
    throw new ToolError("upstream_error", `Cloudflare returned Pages project ${project} without a pages.dev subdomain.`)
  }
  return subdomain
}

async function sendAdd(client: CloudflareClient, project: string, name: string): Promise<unknown> {
  try {
    const reply = await client.request<unknown>(ROUTES.pagesDomainAdd, {
      path: { project_name: project },
      body: { name },
    })
    return reply.result
  } catch (error) {
    throw failureOfWrite(error, "added")
  }
}

/** Defines the `cloudflare_pages_domain_add` tool spec with injected dependencies. */
export function definePagesDomainAdd(deps?: CloudflareDeps): DomainAddSpec {
  const spec: DomainAddSpec = defineTool({
    id: "cloudflare_pages_domain_add",
    title: "Add a custom domain to a Cloudflare Pages project",
    description: [
      "Add a custom domain, a hostname, to a Cloudflare Pages project; the tool always asks first, since visitors to the hostname get the project's site once it is live.",
      "The hostname must be in a zone Cloudflare lets the account use; one it reserves or the account cannot use is refused.",
      "Adding creates no DNS record: the domain stays pending until a proxied CNAME record from the hostname to the project's pages.dev address exists (`cname` in the result), and then goes active in a few minutes; read cloudflare_pages_read domains for its status.",
      "DNS changes stay with the cloudflare_dns_* tools.",
      "`dns` holds the records already at that name in the account's zone: when no CNAME to `cname.content` is among them, create it with cloudflare_dns_record_add; when another record holds the name, the domain stays pending until the person decides what to do with it.",
      "The result holds the domain with its status and the validation it waits for; a step after the add that fails is listed under `errors` and the domain stays added.",
      "Removing a domain is cloudflare_pages_domain_remove.",
    ].join(" "),
    toolset: "pages",
    class: "administrative",
    input: domainInput,
    output,
    targets: (args, ctx) => domainTargets(args, ctx, deps),
    async execute(args, ctx) {
      const project = projectName(args.project)
      const name = domainName(args.name)
      const client = cloudflareClient(args.account, { ...deps, signal: ctx.signal })

      const subdomain = await pagesAddress(client, project)
      await confirmWrite(
        spec,
        ctx,
        `Add ${name} to Pages project ${project} in the Cloudflare account ${client.label}. Once a CNAME record ${name} → ${subdomain} exists, visitors to ${name} get the project's site.`,
      )

      const added = await sendAdd(client, project, name)
      const reported = isPlainObject(added) ? added : { name }
      const dnsResult = await readDnsStep(client, reported.zone_tag, name)
      return {
        label: client.label,
        project,
        domain: shapeDomain(reported),
        cname: { name, content: subdomain, proxied: true },
        ...dnsResult,
      }
    },
  })
  return spec
}

export const cloudflarePagesDomainAdd = definePagesDomainAdd()
