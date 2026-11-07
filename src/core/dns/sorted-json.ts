/** `value` as JSON with the keys of every object in order, so equal values give equal text whatever the key order. */
export function sortedJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(sortedJson).join(",")}]`
  if (typeof value !== "object" || value === null) return JSON.stringify(value)
  const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${sortedJson(item)}`).join(",")}}`
}
