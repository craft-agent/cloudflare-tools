import type { Translations } from "../words"

/** The English headline templates, fact labels, value templates and text labels the rules describers use. */
export const RULES_WORDS = {
  ruleAdd: "About to add a rule to {product} of {zone}",
  action: "Action",
  parameters: "Parameters",
  position: "Position",
  beforeRule: "before rule {rule}",
  afterRule: "after rule {rule}",
  atPosition: "position {index}",
  description: "Description",
  state: "State",
  off: "off",
  expression: "Expression",
} as const

/** The translations of the rules tools' words: their titles, intents, headline templates, fact labels, value templates and text labels. */
export const RULES_TRANSLATIONS: Translations = {
  ja: {
    "Add a Cloudflare rule": "Cloudflare のルールを追加する",
    "About to add a rule": "ルールを追加しようとしています",
    [RULES_WORDS.ruleAdd]: "{zone} の {product} にルールを追加しようとしています",
    [RULES_WORDS.action]: "アクション",
    [RULES_WORDS.parameters]: "パラメーター",
    [RULES_WORDS.position]: "位置",
    [RULES_WORDS.beforeRule]: "ルール {rule} の前",
    [RULES_WORDS.afterRule]: "ルール {rule} の後",
    [RULES_WORDS.atPosition]: "{index} 番目",
    [RULES_WORDS.description]: "説明",
    [RULES_WORDS.state]: "状態",
    [RULES_WORDS.off]: "オフ",
    [RULES_WORDS.expression]: "式",
  },
}
