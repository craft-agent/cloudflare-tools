import { describe, expect, test } from "bun:test"
import { templatePlaceholders } from "./core/describe"
import { DNS_TRANSLATIONS } from "./core/dns/words"
import { FACT_TRANSLATIONS } from "./core/facts"
import { ALL_TOOLS } from "./tools"
import { ALL_TRANSLATIONS, TOOL_WORDS } from "./words"

const WRITE_TOOLS = ALL_TOOLS.filter((spec) => spec.class !== "read")
const TOOL_PHRASES = ALL_TOOLS.flatMap((spec) => [spec.title, ...(spec.intent !== undefined ? [spec.intent] : [])])
const KNOWN_WORDS = new Set([...TOOL_PHRASES, ...Object.keys(FACT_TRANSLATIONS.ja!), ...TOOL_WORDS])

const LANGUAGES = Object.entries(ALL_TRANSLATIONS)

/** The placeholder names of a word, sorted; fails the test when a brace is not part of a placeholder. */
function placeholdersOf(word: string): string[] {
  const names = templatePlaceholders(word)
  expect(names).toBeDefined()
  return [...names!].sort()
}

describe("ALL_TRANSLATIONS", () => {
  test("holds every table it gathers", () => {
    for (const table of [FACT_TRANSLATIONS, DNS_TRANSLATIONS]) {
      for (const [language, words] of Object.entries(table)) {
        expect(ALL_TRANSLATIONS[language]).toMatchObject(words)
      }
    }
    expect(ALL_TRANSLATIONS.ja!.Size).toBe("サイズ")
  })

  test("translates only words a tool uses", () => {
    for (const [language, words] of LANGUAGES) {
      for (const english of Object.keys(words)) {
        expect([language, english, KNOWN_WORDS.has(english)]).toEqual([language, english, true])
      }
    }
  })

  test("keeps the placeholders of each English word and is never blank", () => {
    for (const [language, words] of LANGUAGES) {
      for (const [english, translation] of Object.entries(words)) {
        expect([language, english, placeholdersOf(translation)]).toEqual([language, english, placeholdersOf(english)])
        expect([language, english, translation.trim() !== ""]).toEqual([language, english, true])
      }
    }
  })
})

describe("the tools' words", () => {
  test("every write tool with an intent has its title and intent in Japanese", () => {
    const stating = WRITE_TOOLS.filter((spec) => spec.intent !== undefined)
    expect(stating.length).toBeGreaterThan(0)
    for (const spec of stating) {
      expect([spec.id, ALL_TRANSLATIONS.ja![spec.title] !== undefined]).toEqual([spec.id, true])
      expect([spec.id, ALL_TRANSLATIONS.ja![spec.intent!] !== undefined]).toEqual([spec.id, true])
    }
  })

  test("every word of the describers has a Japanese translation", () => {
    expect(TOOL_WORDS.length).toBeGreaterThan(0)
    for (const word of TOOL_WORDS) {
      expect([word, ALL_TRANSLATIONS.ja![word] !== undefined]).toEqual([word, true])
    }
  })
})
