import type { Translations } from "../words"

/** The English headline templates, fact labels, value templates and text labels the Pages describers use. */
export const PAGES_WORDS = {
  rollback: "About to roll back the Pages project {project}",
  domainAdd: "About to add {name} to the Pages project {project}",
  domainRemove: "About to remove {name} from the Pages project {project}",
  servingNow: "Serving now",
  serveInstead: "Serve instead",
  effect: "Effect",
  effectRollback: "visitors get it at once; rolling back again undoes it",
  dnsRecordNeeded: "DNS record needed",
  status: "Status",
  effectRemove: "visitors stop getting the site at once; its DNS records stay",
} as const

/** The translations of the Pages tools' words: their titles, intents, headline templates, fact labels, value templates and text labels. */
export const PAGES_TRANSLATIONS: Translations = {
  ja: {
    "Roll back a Cloudflare Pages project": "Cloudflare Pages のプロジェクトをロールバックする",
    "Add a custom domain to a Cloudflare Pages project": "Cloudflare Pages のプロジェクトにカスタムドメインを追加する",
    "Remove a custom domain from a Cloudflare Pages project":
      "Cloudflare Pages のプロジェクトからカスタムドメインを削除する",
    "About to roll back a Pages project": "Pages プロジェクトをロールバックしようとしています",
    "About to add a custom domain": "カスタムドメインを追加しようとしています",
    "About to remove a custom domain": "カスタムドメインを削除しようとしています",
    [PAGES_WORDS.rollback]: "Pages プロジェクト {project} をロールバックしようとしています",
    [PAGES_WORDS.domainAdd]: "Pages プロジェクト {project} に {name} を追加しようとしています",
    [PAGES_WORDS.domainRemove]: "Pages プロジェクト {project} から {name} を削除しようとしています",
    [PAGES_WORDS.servingNow]: "配信中",
    [PAGES_WORDS.serveInstead]: "切り替え先",
    [PAGES_WORDS.effect]: "影響",
    [PAGES_WORDS.effectRollback]: "訪問者にすぐに反映されます。もう一度ロールバックすれば元に戻せます",
    [PAGES_WORDS.dnsRecordNeeded]: "必要な DNS レコード",
    [PAGES_WORDS.status]: "現在の状態",
    [PAGES_WORDS.effectRemove]: "訪問者にはすぐにサイトが表示されなくなります。DNS レコードは残ります",
  },
}
