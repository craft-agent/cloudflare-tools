/** Daily totals of a zone's HTTP traffic; the only values sent are `$zoneTag`, `$since` and `$until`. */
export const TRAFFIC_QUERY =
  "query($zoneTag: string, $since: Date, $until: Date) { viewer { zones(filter: {zoneTag: $zoneTag}) { httpRequests1dGroups(limit: 400, orderBy: [date_ASC], filter: {date_geq: $since, date_leq: $until}) { dimensions { date } sum { requests bytes cachedRequests cachedBytes threats pageViews } uniq { uniques } } } } }"
