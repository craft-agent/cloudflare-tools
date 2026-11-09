import { mergeTranslations, type Translations } from "./core"
import { DNS_TRANSLATIONS, DNS_WORDS } from "./core/dns/words"
import { FACT_TRANSLATIONS } from "./core/facts"
import { ZONE_TRANSLATIONS, ZONE_WORDS } from "./core/zone/words"

/** The translations of every tool's words, per language, which the native plugins use in their approval prompts. */
export const ALL_TRANSLATIONS: Translations = mergeTranslations(FACT_TRANSLATIONS, DNS_TRANSLATIONS, ZONE_TRANSLATIONS)

/** The headline templates, fact labels, value templates and text labels the tools' describers use, which `ALL_TRANSLATIONS` must translate. */
export const TOOL_WORDS: readonly string[] = [...Object.values(DNS_WORDS), ...Object.values(ZONE_WORDS)]
