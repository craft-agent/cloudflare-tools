export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE"

/** One allowed Cloudflare call: a method and a path template under the base URL, e.g. "/accounts/{account_id}/logs/audit". */
export type Route = {
  readonly method: Method
  readonly path: string
  readonly body?: Readonly<Record<string, unknown>>
}

const ID_PATTERN = /^[0-9a-f]{32}$/

/** A KV namespace's id: 32 lowercase hexadecimal digits. */
export const NAMESPACE_ID_PATTERN = ID_PATTERN

/** A Worker's name: 1–63 lowercase letters, digits, `-` and `_`. */
export const SCRIPT_NAME_PATTERN = /^[a-z0-9_-]{1,63}$/

/** A Pages project's name: 1–58 lowercase letters, digits and `-`, starting with a letter or digit. */
export const PROJECT_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,57}$/

/** A Pages deployment's id: standard 8-4-4-4-12 lowercase hexadecimal UUID. */
export const DEPLOYMENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** A D1 database's id: a lowercase hexadecimal UUID. */
export const DATABASE_ID_PATTERN = DEPLOYMENT_ID_PATTERN

/** A Cloudflare Tunnel's id: a lowercase hexadecimal UUID. */
export const TUNNEL_ID_PATTERN = DEPLOYMENT_ID_PATTERN

/** An Email Routing rule's id: 1–64 letters and digits; it holds no `_`, so the path segment `catch_all` is never a rule id. */
export const RULE_ID_PATTERN = /^[A-Za-z0-9]{1,64}$/

/** An Email Routing destination address's id; the same shape as a rule's id. */
export const ADDRESS_ID_PATTERN = RULE_ID_PATTERN

/** A Ruleset Engine phase the rules tools reach: exactly these eleven zone phases, nothing else. */
export const PHASE_PATTERN =
  /^(?:http_request_dynamic_redirect|http_request_cache_settings|http_config_settings|http_request_transform|http_request_late_transform|http_response_headers_transform|http_request_origin|http_response_compression|http_request_firewall_custom|http_ratelimit|http_custom_errors)$/

/** The only SQL the schema route sends; excludes internal tables and never reads rows. */
export const D1_SCHEMA_SQL =
  "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE type IN ('table', 'index', 'view', 'trigger') AND substr(name, 1, 7) != 'sqlite_' AND substr(name, 1, 4) != '_cf_' ORDER BY type, name"

/** A custom domain's name: a lowercase dot-separated hostname up to 253 characters. */
export const DOMAIN_NAME_PATTERN = /^(?=.{1,253}$)[a-z0-9_-]+(?:\.[a-z0-9_-]+)+$/

/** An R2 bucket's name: 3–63 lowercase letters, digits and `-`, starting and ending with a letter or digit. */
export const BUCKET_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/

/** A D1 database's name: 1–63 lowercase letters, digits, `-` and `_`, starting with a letter or digit. */
export const D1_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,62}$/

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
  bucket_name: BUCKET_NAME_PATTERN,
  namespace_id: NAMESPACE_ID_PATTERN,
  database_id: DATABASE_ID_PATTERN,
  tunnel_id: TUNNEL_ID_PATTERN,
  rule_id: RULE_ID_PATTERN,
  address_id: ADDRESS_ID_PATTERN,
  phase: PHASE_PATTERN,
})

function defineRoute(method: Method, path: string, body?: Route["body"]): Route {
  return Object.freeze({ method, path, ...(body === undefined ? {} : { body: Object.freeze(body) }) })
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
  r2Buckets: defineRoute("GET", "/accounts/{account_id}/r2/buckets"),
  r2Bucket: defineRoute("GET", "/accounts/{account_id}/r2/buckets/{bucket_name}"),
  r2BucketManagedDomain: defineRoute("GET", "/accounts/{account_id}/r2/buckets/{bucket_name}/domains/managed"),
  r2BucketCustomDomains: defineRoute("GET", "/accounts/{account_id}/r2/buckets/{bucket_name}/domains/custom"),
  r2BucketCors: defineRoute("GET", "/accounts/{account_id}/r2/buckets/{bucket_name}/cors"),
  r2BucketLifecycle: defineRoute("GET", "/accounts/{account_id}/r2/buckets/{bucket_name}/lifecycle"),
  r2BucketObjects: defineRoute("GET", "/accounts/{account_id}/r2/buckets/{bucket_name}/objects"),
  r2BucketCreate: defineRoute("POST", "/accounts/{account_id}/r2/buckets"),
  r2BucketDelete: defineRoute("DELETE", "/accounts/{account_id}/r2/buckets/{bucket_name}"),
  graphql: defineRoute("POST", "/graphql"),
  kvNamespaces: defineRoute("GET", "/accounts/{account_id}/storage/kv/namespaces"),
  kvNamespace: defineRoute("GET", "/accounts/{account_id}/storage/kv/namespaces/{namespace_id}"),
  kvNamespaceKeys: defineRoute("GET", "/accounts/{account_id}/storage/kv/namespaces/{namespace_id}/keys"),
  kvNamespaceCreate: defineRoute("POST", "/accounts/{account_id}/storage/kv/namespaces"),
  kvNamespaceDelete: defineRoute("DELETE", "/accounts/{account_id}/storage/kv/namespaces/{namespace_id}"),
  d1Databases: defineRoute("GET", "/accounts/{account_id}/d1/database"),
  d1Database: defineRoute("GET", "/accounts/{account_id}/d1/database/{database_id}"),
  d1DatabaseCreate: defineRoute("POST", "/accounts/{account_id}/d1/database"),
  d1DatabaseDelete: defineRoute("DELETE", "/accounts/{account_id}/d1/database/{database_id}"),
  d1Schema: defineRoute("POST", "/accounts/{account_id}/d1/database/{database_id}/query", { sql: D1_SCHEMA_SQL }),
  cfdTunnels: defineRoute("GET", "/accounts/{account_id}/cfd_tunnel"),
  cfdTunnel: defineRoute("GET", "/accounts/{account_id}/cfd_tunnel/{tunnel_id}"),
  cfdTunnelConnections: defineRoute("GET", "/accounts/{account_id}/cfd_tunnel/{tunnel_id}/connections"),
  cfdTunnelConfiguration: defineRoute("GET", "/accounts/{account_id}/cfd_tunnel/{tunnel_id}/configurations"),
  cfdTunnelConfigurationEdit: defineRoute("PUT", "/accounts/{account_id}/cfd_tunnel/{tunnel_id}/configurations"),
  accessApps: defineRoute("GET", "/accounts/{account_id}/access/apps"),
  emailRouting: defineRoute("GET", "/zones/{zone_id}/email/routing"),
  emailRoutingRules: defineRoute("GET", "/zones/{zone_id}/email/routing/rules"),
  emailRoutingCatchAll: defineRoute("GET", "/zones/{zone_id}/email/routing/rules/catch_all"),
  emailRoutingAddresses: defineRoute("GET", "/accounts/{account_id}/email/routing/addresses"),
  emailRoutingRuleCreate: defineRoute("POST", "/zones/{zone_id}/email/routing/rules"),
  emailRoutingRule: defineRoute("GET", "/zones/{zone_id}/email/routing/rules/{rule_id}"),
  emailRoutingRuleEdit: defineRoute("PUT", "/zones/{zone_id}/email/routing/rules/{rule_id}"),
  emailRoutingRuleDelete: defineRoute("DELETE", "/zones/{zone_id}/email/routing/rules/{rule_id}"),
  emailRoutingCatchAllEdit: defineRoute("PUT", "/zones/{zone_id}/email/routing/rules/catch_all"),
  emailRoutingAddressCreate: defineRoute("POST", "/accounts/{account_id}/email/routing/addresses"),
  emailRoutingAddressDelete: defineRoute("DELETE", "/accounts/{account_id}/email/routing/addresses/{address_id}"),
  rulesetEntrypoint: defineRoute("GET", "/zones/{zone_id}/rulesets/phases/{phase}/entrypoint"),
} satisfies Record<string, Route>)

/** Whether a route is one of `ROUTES`, including its fixed body when present. */
export function isAllowed(route: Route): boolean {
  return Object.values(ROUTES).some(
    (allowed) => allowed.method === route.method && allowed.path === route.path && allowed.body === route.body,
  )
}
