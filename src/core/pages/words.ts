import type { Translations } from "../words"

/** The English headline templates, fact labels, value templates and text labels the Pages describers use. */
export const PAGES_WORDS = {
  rollback: "About to roll back the Pages project {project}",
  servingNow: "Serving now",
  serveInstead: "Serve instead",
  effect: "Effect",
  effectRollback: "visitors get it at once; rolling back again undoes it",
} as const

/** The translations of the Pages tools' words: their titles, intents, headline templates, fact labels, value templates and text labels. */
export const PAGES_TRANSLATIONS: Translations = {
  ja: {
    "Roll back a Cloudflare Pages project": "Cloudflare Pages のプロジェクトをロールバックする",
    "About to roll back a Pages project": "Pages プロジェクトをロールバックしようとしています",
    [PAGES_WORDS.rollback]: "Pages プロジェクト {project} をロールバックしようとしています",
    [PAGES_WORDS.servingNow]: "配信中",
    [PAGES_WORDS.serveInstead]: "切り替え先",
    [PAGES_WORDS.effect]: "影響",
    [PAGES_WORDS.effectRollback]: "訪問者にすぐに反映されます。もう一度ロールバックすれば元に戻せます",
  },
}
