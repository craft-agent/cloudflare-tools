import { z } from "zod"
import { cloudflareClient, type CloudflareClient, type CloudflareDeps } from "../cloudflare/client"
import { ROUTES } from "../cloudflare/routes"
import { ToolError, isToolError } from "../errors"
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

/** Cloudflare's code for a hostname that is not one of the project's domains; it answers HTTP 400 with it. */
const NO_SUCH_DOMAIN_CODE = "8000021"

const output = z.object({
  ...domainOutputBase,
  removed: domainSchema.describe("The domain as it was before it was removed."),
  dns: dnsSchema.describe(
    "The records left at that name in the account's zone, or null when the account has no such zone. A CNAME to the project's pages.dev address now answers with an error page: offer to delete it with cloudflare_dns_record_delete, asking the person first, since the record may be wanted for something else.",
  ),
  errors: stepErrorsSchema.optional(),
})

type DomainRemoveSpec = ToolSpec<typeof domainInput, typeof output>

/** The domain the project holds under `name`; Cloudflare's 400 for a hostname it does not hold is `not_found` like a 404. */
async function readDomain(client: CloudflareClient, project: string, name: string): Promise<Record<string, unknown>> {
  const notFoundMessage = `Pages project ${project} has no custom domain ${name}; cloudflare_pages_read domains lists them.`
  try {
    const reply = await requestProject<unknown>(client, ROUTES.pagesDomain, project, {
      path: { domain_name: name },
      notFoundMessage,
    })
    return requireObject(reply.result, "domain")
  } catch (error) {
    if (!isToolError(error) || error.code !== "invalid_argument" || !error.message.includes(NO_SUCH_DOMAIN_CODE)) {
      throw error
    }
    throw new ToolError("not_found", notFoundMessage, { cause: error })
  }
}

async function sendRemove(client: CloudflareClient, project: string, name: string): Promise<void> {
  try {
    await client.request<unknown>(ROUTES.pagesDomainRemove, { path: { project_name: project, domain_name: name } })
  } catch (error) {
    throw failureOfWrite(error, "removed")
  }
}

/** Defines the `cloudflare_pages_domain_remove` tool spec with injected dependencies. */
export function definePagesDomainRemove(deps?: CloudflareDeps): DomainRemoveSpec {
  const spec: DomainRemoveSpec = defineTool({
    id: "cloudflare_pages_domain_remove",
    title: "Remove a custom domain from a Cloudflare Pages project",
    description: [
      "Remove a custom domain, a hostname, from a Cloudflare Pages project; the tool always asks first, since visitors to the hostname stop getting the site at once.",
      "The hostname must be one of the project's domains, as cloudflare_pages_read domains lists them; the result returns it as it was.",
      "Removing deletes no DNS record, and DNS changes stay with the cloudflare_dns_* tools.",
      "`dns` holds the records left at that name in the account's zone: a CNAME to the project's pages.dev address now answers with an error page, so offer to delete it with cloudflare_dns_record_delete, asking the person first, since the record may be wanted for something else.",
      "A step after the removal that fails is listed under `errors` and the domain stays removed.",
      "Adding a domain is cloudflare_pages_domain_add.",
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

      const domain = await readDomain(client, project, name)
      await confirmWrite(
        spec,
        ctx,
        `Remove ${name} from Pages project ${project} in the Cloudflare account ${client.label}. Visitors to ${name} stop getting the site at once; its DNS records stay as they are.`,
      )

      await sendRemove(client, project, name)
      const dnsResult = await readDnsStep(client, domain.zone_tag, name)
      return {
        label: client.label,
        project,
        removed: shapeDomain(domain),
        ...dnsResult,
      }
    },
  })
  return spec
}

export const cloudflarePagesDomainRemove = definePagesDomainRemove()
