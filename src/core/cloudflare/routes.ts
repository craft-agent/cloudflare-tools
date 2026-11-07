export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE"

/** One allowed Cloudflare call: a method and a path template under the base URL, e.g. "/accounts/{account_id}/logs/audit". */
export type Route = { readonly method: Method; readonly path: string }

const ID_PATTERN = /^[0-9a-f]{32}$/

/** A Worker's name: 1–63 lowercase letters, digits, `-` and `_`. */
export const SCRIPT_NAME_PATTERN = /^[a-z0-9_-]{1,63}$/

/** A Pages project's name: 1–58 lowercase letters, digits and `-`, starting with a letter or digit. */
export const PROJECT_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,57}$/

/** A Pages deployment's id: standard 8-4-4-4-12 lowercase hexadecimal UUID. */
export const DEPLOYMENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** A custom domain's name: a lowercase dot-separated hostname up to 253 characters. */
export const DOMAIN_NAME_PATTERN = /^(?=.{1,253}$)[a-z0-9_-]+(?:\.[a-z0-9_-]+)+$/

/** The patterns a path parameter must match; a template may use only names listed here. `account_id` is always filled from the credential, never from a caller. */
export const PATH_PARAMS: Readonly<Record<string, RegExp>> = Object.freeze({
  account_id: ID_PATTERN,
  zone_id: ID_PATTERN,
  dns_record_id: ID_PATTERN,
  setting_id: /^[a-z0-9_]{1,64}$/,
  script_name: SCRIPT_NAME_PATTERN,
  project_name: PROJECT_NAME_PATTERN,
  deployment_id: DEPLOYMENT_ID_PATTERN,
  domain_name: DOMAIN_NAME_PATTERN,
})

function defineRoute(method: Method, path: string): Route {
  return Object.freeze({ method, path })
}

/** Every call a tool may make; the client refuses any route that is not listed here. */
export const ROUTES = Object.freeze({
  verifyUserToken: defineRoute("GET", "/user/tokens/verify"),
  verifyAccountToken: defineRoute("GET", "/accounts/{account_id}/tokens/verify"),
  account: defineRoute("GET", "/accounts/{account_id}"),
  auditLogs: defineRoute("GET", "/accounts/{account_id}/logs/audit"),
  zones: defineRoute("GET", "/zones"),
  zone: defineRoute("GET", "/zones/{zone_id}"),
  zoneSetting: defineRoute("GET", "/zones/{zone_id}/settings/{setting_id}"),
  zoneSettingEdit: defineRoute("PATCH", "/zones/{zone_id}/settings/{setting_id}"),
  universalSsl: defineRoute("GET", "/zones/{zone_id}/ssl/universal/settings"),
  certificatePacks: defineRoute("GET", "/zones/{zone_id}/ssl/certificate_packs"),
  dnssec: defineRoute("GET", "/zones/{zone_id}/dnssec"),
  dnssecEdit: defineRoute("PATCH", "/zones/{zone_id}/dnssec"),
  cachePurge: defineRoute("POST", "/zones/{zone_id}/purge_cache"),
  dnsRecords: defineRoute("GET", "/zones/{zone_id}/dns_records"),
  dnsRecord: defineRoute("GET", "/zones/{zone_id}/dns_records/{dns_record_id}"),
  dnsRecordsExport: defineRoute("GET", "/zones/{zone_id}/dns_records/export"),
  dnsRecordsBatch: defineRoute("POST", "/zones/{zone_id}/dns_records/batch"),
  workersScripts: defineRoute("GET", "/accounts/{account_id}/workers/scripts"),
  workersScriptSettings: defineRoute("GET", "/accounts/{account_id}/workers/scripts/{script_name}/settings"),
  workersScriptSubdomain: defineRoute("GET", "/accounts/{account_id}/workers/scripts/{script_name}/subdomain"),
  workersDeployments: defineRoute("GET", "/accounts/{account_id}/workers/scripts/{script_name}/deployments"),
  workersDeploy: defineRoute("POST", "/accounts/{account_id}/workers/scripts/{script_name}/deployments"),
  workersVersions: defineRoute("GET", "/accounts/{account_id}/workers/scripts/{script_name}/versions"),
  workersRoutes: defineRoute("GET", "/zones/{zone_id}/workers/routes"),
  workersDomains: defineRoute("GET", "/accounts/{account_id}/workers/domains"),
  workersSchedules: defineRoute("GET", "/accounts/{account_id}/workers/scripts/{script_name}/schedules"),
  workersSecrets: defineRoute("GET", "/accounts/{account_id}/workers/scripts/{script_name}/secrets"),
  pagesProjects: defineRoute("GET", "/accounts/{account_id}/pages/projects"),
  pagesProject: defineRoute("GET", "/accounts/{account_id}/pages/projects/{project_name}"),
  pagesDeployments: defineRoute("GET", "/accounts/{account_id}/pages/projects/{project_name}/deployments"),
  pagesDeployment: defineRoute(
    "GET",
    "/accounts/{account_id}/pages/projects/{project_name}/deployments/{deployment_id}",
  ),
  pagesRollback: defineRoute(
    "POST",
    "/accounts/{account_id}/pages/projects/{project_name}/deployments/{deployment_id}/rollback",
  ),
  pagesDeploymentLogs: defineRoute(
    "GET",
    "/accounts/{account_id}/pages/projects/{project_name}/deployments/{deployment_id}/history/logs",
  ),
  pagesDomains: defineRoute("GET", "/accounts/{account_id}/pages/projects/{project_name}/domains"),
  pagesDomain: defineRoute("GET", "/accounts/{account_id}/pages/projects/{project_name}/domains/{domain_name}"),
  pagesDomainAdd: defineRoute("POST", "/accounts/{account_id}/pages/projects/{project_name}/domains"),
  pagesDomainRemove: defineRoute(
    "DELETE",
    "/accounts/{account_id}/pages/projects/{project_name}/domains/{domain_name}",
  ),
  graphql: defineRoute("POST", "/graphql"),
} satisfies Record<string, Route>)

/** Whether a route is one of `ROUTES`, compared by method and path. */
export function isAllowed(route: Route): boolean {
  return Object.values(ROUTES).some((allowed) => allowed.method === route.method && allowed.path === route.path)
}
