import type { Translations } from "../words"

/** The English headline templates, fact labels, value templates and text labels the DNS describers use. */
export const DNS_WORDS = {
  addOne: "About to add the DNS record {name}",
  addMany: "About to add DNS records to {zone}",
  changeOne: "About to change the DNS record {name}",
  changeMany: "About to change DNS records in {zone}",
  deleteOne: "About to delete the DNS record {name}",
  deleteMany: "About to delete DNS records in {zone}",
  replaceMany: "About to replace DNS records in {zone}",
  records: "Records",
  deletions: "Deletions",
  additions: "Additions",
  recordCount: "{count} record",
  recordsCount: "{count} records",
  changes: "Changes",
} as const

/** The translations of the DNS tools' words: their titles, intents, headline templates, fact labels, value templates and text labels. */
export const DNS_TRANSLATIONS: Translations = {
  ja: {
    "Add Cloudflare DNS records": "Cloudflare の DNS レコードを追加する",
    "Change Cloudflare DNS records": "Cloudflare の DNS レコードを変更する",
    "Delete Cloudflare DNS records": "Cloudflare の DNS レコードを削除する",
    "About to add DNS records": "DNS レコードを追加しようとしています",
    "About to change DNS records": "DNS レコードを変更しようとしています",
    "About to delete DNS records": "DNS レコードを削除しようとしています",
    [DNS_WORDS.addOne]: "DNS レコード {name} を追加しようとしています",
    [DNS_WORDS.addMany]: "{zone} に DNS レコードを追加しようとしています",
    [DNS_WORDS.changeOne]: "DNS レコード {name} を変更しようとしています",
    [DNS_WORDS.changeMany]: "{zone} の DNS レコードを変更しようとしています",
    [DNS_WORDS.deleteOne]: "DNS レコード {name} を削除しようとしています",
    [DNS_WORDS.deleteMany]: "{zone} の DNS レコードを削除しようとしています",
    [DNS_WORDS.replaceMany]: "{zone} の DNS レコードを置き換えようとしています",
    [DNS_WORDS.records]: "レコード",
    [DNS_WORDS.deletions]: "削除",
    [DNS_WORDS.additions]: "追加",
    [DNS_WORDS.recordCount]: "{count} 件",
    [DNS_WORDS.recordsCount]: "{count} 件",
    [DNS_WORDS.changes]: "変更内容",
  },
}
