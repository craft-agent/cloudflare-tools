import type { Translations } from "../words"

/** The English headline templates, fact labels, value templates and text labels the zone describers use. */
export const ZONE_WORDS = {
  purgeUrls: "About to purge the cache of {zone} by URL",
  purgeHosts: "About to purge the cache of {zone} by host",
  purgePrefixes: "About to purge the cache of {zone} by prefix",
  purgeTags: "About to purge the cache of {zone} by tag",
  purgeAll: "About to purge the whole cache of {zone}",
  count: "Count",
  effect: "Effect",
  effectOrigin: "every next request goes to the origin",
  urls: "URLs",
  hosts: "Hosts",
  prefixes: "Prefixes",
  tags: "Tags",
} as const

/** The translations of the zone tools' words: their titles, intents, headline templates, fact labels, value templates and text labels. */
export const ZONE_TRANSLATIONS: Translations = {
  ja: {
    "Purge Cloudflare zone cache": "Cloudflare のゾーンのキャッシュをパージする",
    "Purge entire Cloudflare zone cache": "Cloudflare のゾーンのキャッシュをすべてパージする",
    "About to purge cached content": "キャッシュをパージしようとしています",
    "About to purge a zone's whole cache": "ゾーンのキャッシュをすべてパージしようとしています",
    [ZONE_WORDS.purgeUrls]: "{zone} のキャッシュを URL 単位でパージしようとしています",
    [ZONE_WORDS.purgeHosts]: "{zone} のキャッシュをホスト単位でパージしようとしています",
    [ZONE_WORDS.purgePrefixes]: "{zone} のキャッシュをプレフィックス単位でパージしようとしています",
    [ZONE_WORDS.purgeTags]: "{zone} のキャッシュをタグ単位でパージしようとしています",
    [ZONE_WORDS.purgeAll]: "{zone} のキャッシュをすべてパージしようとしています",
    [ZONE_WORDS.count]: "件数",
    [ZONE_WORDS.effect]: "影響",
    [ZONE_WORDS.effectOrigin]: "次のリクエストはすべてオリジンに届きます",
    [ZONE_WORDS.urls]: "URL",
    [ZONE_WORDS.hosts]: "ホスト",
    [ZONE_WORDS.prefixes]: "プレフィックス",
    [ZONE_WORDS.tags]: "タグ",
  },
}
