import { mergeTranslations, type Translations } from "./core"
import { DNS_TRANSLATIONS, DNS_WORDS } from "./core/dns/words"
import { EMAIL_TRANSLATIONS, EMAIL_WORDS } from "./core/email/words"
import { FACT_TRANSLATIONS } from "./core/facts"
import { PAGES_TRANSLATIONS, PAGES_WORDS } from "./core/pages/words"
import { STORAGE_TRANSLATIONS, STORAGE_WORDS } from "./core/storage/words"
import { TUNNEL_TRANSLATIONS, TUNNEL_WORDS } from "./core/tunnel/words"
import { WORKERS_TRANSLATIONS, WORKERS_WORDS } from "./core/workers/words"
import { ZONE_TRANSLATIONS, ZONE_WORDS } from "./core/zone/words"

/** The translations of every tool's words, per language, which the native plugins use in their approval prompts. */
export const ALL_TRANSLATIONS: Translations = mergeTranslations(
  FACT_TRANSLATIONS,
  DNS_TRANSLATIONS,
  ZONE_TRANSLATIONS,
  EMAIL_TRANSLATIONS,
  PAGES_TRANSLATIONS,
  WORKERS_TRANSLATIONS,
  STORAGE_TRANSLATIONS,
  TUNNEL_TRANSLATIONS,
)

/** The headline templates, fact labels, value templates and text labels the tools' describers use, which `ALL_TRANSLATIONS` must translate. */
export const TOOL_WORDS: readonly string[] = [
  ...Object.values(DNS_WORDS),
  ...Object.values(ZONE_WORDS),
  ...Object.values(EMAIL_WORDS),
  ...Object.values(PAGES_WORDS),
  ...Object.values(WORKERS_WORDS),
  ...Object.values(STORAGE_WORDS),
  ...Object.values(TUNNEL_WORDS),
]
