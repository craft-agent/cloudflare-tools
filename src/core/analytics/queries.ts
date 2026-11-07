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
