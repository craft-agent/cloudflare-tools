/** Placeholder string used to replace credentials. */
export const MASK = "[masked]"

const PREFIXED_TOKEN_PATTERN = /\bcf(?:ut|at|k|oat)_[A-Za-z0-9_-]{8,}/g
const BEARER_PATTERN = /(Bearer\s+)[^\s"',;]+/gi
const X_AUTH_KEY_PATTERN = /((?:X-Auth-Key\s*:\s*|["']X-Auth-Key["']\s*:\s*["']))([^"',;\s}]+)(["']?)/gi

/** Replaces anything shaped like a Cloudflare credential in `text`, and every value in `known`, with `[masked]`. */
export function maskCredentials(text: string, known?: readonly string[]): string {
  let result = text

  if (known && known.length > 0) {
    const sorted = [...known].filter((v) => v.length > 0).sort((a, b) => b.length - a.length)
    for (const val of sorted) {
      result = result.replaceAll(val, MASK)
    }
  }

  result = result.replace(PREFIXED_TOKEN_PATTERN, MASK)
  result = result.replace(BEARER_PATTERN, `$1${MASK}`)
  result = result.replace(X_AUTH_KEY_PATTERN, (_match, prefix, _val, suffix) => `${prefix}${MASK}${suffix}`)

  return result
}
