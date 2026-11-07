export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE"

/** One allowed Cloudflare call: a method and a path template under the base URL, e.g. "/accounts/{account_id}/logs/audit". */
export type Route = { readonly method: Method; readonly path: string }

const ID_PATTERN = /^[0-9a-f]{32}$/

/** The patterns a path parameter must match; a template may use only names listed here. `account_id` is always filled from the credential, never from a caller. */
export const PATH_PARAMS: Readonly<Record<string, RegExp>> = Object.freeze({
  account_id: ID_PATTERN,
  zone_id: ID_PATTERN,
  dns_record_id: ID_PATTERN,
  setting_id: /^[a-z0-9_]{1,64}$/,
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
} satisfies Record<string, Route>)

/** Whether a route is one of `ROUTES`, compared by method and path. */
export function isAllowed(route: Route): boolean {
  return Object.values(ROUTES).some((allowed) => allowed.method === route.method && allowed.path === route.path)
}
