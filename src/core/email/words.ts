import type { Translations } from "../words"

/** The English headline templates, fact labels, value templates and text labels the Email Routing describers use. */
export const EMAIL_WORDS = {
  ruleAdd: "About to add the routing rule for {address}",
  ruleEdit: "About to change the routing rule for {address}",
  emailRouting: "Email Routing",
  routingOff: "off: no mail is routed until it is turned on in the dashboard",
  action: "Action",
  name: "Name",
  state: "State",
  off: "off",
  changes: "Changes",
} as const

/** The translations of the Email Routing tools' words: their titles, intents, headline templates, fact labels, value templates and text labels. */
export const EMAIL_TRANSLATIONS: Translations = {
  ja: {
    "Add an Email Routing rule": "Email Routing のルールを追加する",
    "Change an Email Routing rule": "Email Routing のルールを変更する",
    "About to add a routing rule": "ルーティングルールを追加しようとしています",
    "About to change a routing rule": "ルーティングルールを変更しようとしています",
    [EMAIL_WORDS.ruleAdd]: "{address} のルーティングルールを追加しようとしています",
    [EMAIL_WORDS.ruleEdit]: "{address} のルーティングルールを変更しようとしています",
    [EMAIL_WORDS.emailRouting]: "Email Routing",
    [EMAIL_WORDS.routingOff]: "オフ（ダッシュボードでオンにするまでメールは配送されません）",
    [EMAIL_WORDS.action]: "アクション",
    [EMAIL_WORDS.name]: "名前",
    [EMAIL_WORDS.state]: "状態",
    [EMAIL_WORDS.off]: "オフ",
    [EMAIL_WORDS.changes]: "変更内容",
  },
}
