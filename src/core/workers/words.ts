import type { Translations } from "../words"

/** The English headline templates, fact labels, value templates and text labels the Workers describers use. */
export const WORKERS_WORDS = {
  rollback: "About to roll back the Worker {script}",
  servingNow: "Serving now",
  serveInstead: "Serve instead",
  effect: "Effect",
  effectRollback: "visitors get that code at once; the Worker's secrets stay as they are now",
  message: "Message",
} as const

/** The translations of the Workers tools' words: their titles, intents, headline templates, fact labels, value templates and text labels. */
export const WORKERS_TRANSLATIONS: Translations = {
  ja: {
    "Roll back a Cloudflare Worker": "Cloudflare Worker をロールバックする",
    "About to roll back a Worker": "Worker をロールバックしようとしています",
    [WORKERS_WORDS.rollback]: "Worker {script} をロールバックしようとしています",
    [WORKERS_WORDS.servingNow]: "配信中",
    [WORKERS_WORDS.serveInstead]: "切り替え先",
    [WORKERS_WORDS.effect]: "影響",
    [WORKERS_WORDS.effectRollback]: "訪問者にすぐにそのコードが配信されます。Worker のシークレットは今のままです",
    [WORKERS_WORDS.message]: "メッセージ",
  },
}
