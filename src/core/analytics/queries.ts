/** Daily totals of a zone's HTTP traffic; the only values sent are `$zoneTag`, `$since` and `$until`. */
export const TRAFFIC_QUERY =
  "query($zoneTag: string, $since: Date, $until: Date) { viewer { zones(filter: {zoneTag: $zoneTag}) { httpRequests1dGroups(limit: 400, orderBy: [date_ASC], filter: {date_geq: $since, date_leq: $until}) { dimensions { date } sum { requests bytes cachedRequests cachedBytes threats pageViews } uniq { uniques } } } } }"

/** The request field each "top" report groups by. */
export const TOP_DIMENSIONS = {
  paths: "clientRequestPath",
  countries: "clientCountryName",
  statuses: "edgeResponseStatus",
} as const

/** Which request field a "top" report counts by. */
export type TopDimension = (typeof TOP_DIMENSIONS)[keyof typeof TOP_DIMENSIONS]

/** The 25 most frequent values of `dimension` among visitors' requests; a fixed string per dimension, never built from caller text. */
function topQuery(dimension: TopDimension): string {
  return `query($zoneTag: string, $since: Time, $until: Time) { viewer { zones(filter: {zoneTag: $zoneTag}) { httpRequestsAdaptiveGroups(limit: 25, orderBy: [count_DESC], filter: {datetime_geq: $since, datetime_lt: $until, requestSource: "eyeball"}) { count dimensions { ${dimension} } } } } }`
}

/** The most requested paths. */
export const PATHS_QUERY = topQuery(TOP_DIMENSIONS.paths)

/** The countries requests come from. */
export const COUNTRIES_QUERY = topQuery(TOP_DIMENSIONS.countries)

/** The response statuses served. */
export const STATUSES_QUERY = topQuery(TOP_DIMENSIONS.statuses)

/** What the security features did: the 25 most frequent action and source pairs; no visitor field is selected. */
export const SECURITY_QUERY =
  "query($zoneTag: string, $since: Time, $until: Time) { viewer { zones(filter: {zoneTag: $zoneTag}) { firewallEventsAdaptiveGroups(limit: 25, orderBy: [count_DESC], filter: {datetime_geq: $since, datetime_lt: $until}) { count dimensions { action source } } } } }"

/** The account's Workers invocations per Worker and status; the only values sent are `$accountTag`, `$since` and `$until`. */
export const WORKERS_QUERY =
  "query($accountTag: string, $since: Time, $until: Time) { viewer { accounts(filter: {accountTag: $accountTag}) { workersInvocationsAdaptive(limit: 100, orderBy: [sum_requests_DESC], filter: {datetime_geq: $since, datetime_lt: $until}) { sum { requests errors subrequests } quantiles { cpuTimeP50 cpuTimeP99 } dimensions { scriptName status } } } } }"

/** The same for one Worker; `$scriptName` is a validated Worker name, never free text. */
export const WORKER_QUERY =
  "query($accountTag: string, $scriptName: string, $since: Time, $until: Time) { viewer { accounts(filter: {accountTag: $accountTag}) { workersInvocationsAdaptive(limit: 100, orderBy: [sum_requests_DESC], filter: {datetime_geq: $since, datetime_lt: $until, scriptName: $scriptName}) { sum { requests errors subrequests } quantiles { cpuTimeP50 cpuTimeP99 } dimensions { scriptName status } } } } }"

/** The 25 latest security events with only time, action, source, country and path; no address, user agent or ray id. */
export const SECURITY_EVENTS_QUERY =
  "query($zoneTag: string, $since: Time, $until: Time) { viewer { zones(filter: {zoneTag: $zoneTag}) { firewallEventsAdaptive(limit: 25, orderBy: [datetime_DESC], filter: {datetime_geq: $since, datetime_lt: $until}) { datetime action source clientCountryName clientRequestPath } } } }"
