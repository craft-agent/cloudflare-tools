import type { Translations } from "../words"

/** The English headline templates, fact labels, value templates and text labels the tunnel describers use. */
export const TUNNEL_WORDS = {
  publish: "About to publish {hostname} through the tunnel {tunnel}",
  change: "About to change where the tunnel {tunnel} sends {hostname}",
  access: "Access",
  accessCovered: "covered: an Access application covers every path",
  accessPartial: "partial: an Access application covers some paths",
  accessNone: "none: anyone on the internet can reach it unless something else stops them",
  accessUnknown: "unknown: the Access applications could not be read",
  service: "Service",
  path: "Path",
  dns: "DNS",
  dnsCreate: "adds a proxied CNAME to the tunnel",
  dnsKeep: "keeps the CNAME to the tunnel already there",
  dnsMissing: "the hostname does not reach the tunnel",
  changes: "Changes",
} as const

/** The translations of the tunnel tools' words: their titles, intents, headline templates, fact labels, value templates and text labels. */
export const TUNNEL_TRANSLATIONS: Translations = {
  ja: {
    "Publish a hostname through a Cloudflare Tunnel": "Cloudflare Tunnel でホスト名を公開する",
    "Change where a tunnel sends a hostname": "トンネルがホスト名を送る先を変更する",
    "About to publish a hostname through a tunnel": "トンネルでホスト名を公開しようとしています",
    "About to change where a tunnel sends a hostname": "トンネルがホスト名を送る先を変更しようとしています",
    [TUNNEL_WORDS.publish]: "トンネル {tunnel} で {hostname} を公開しようとしています",
    [TUNNEL_WORDS.change]: "トンネル {tunnel} が {hostname} を送る先を変更しようとしています",
    [TUNNEL_WORDS.access]: "Access",
    [TUNNEL_WORDS.accessCovered]: "保護あり（Access アプリケーションがすべてのパスを保護）",
    [TUNNEL_WORDS.accessPartial]: "一部のみ（Access アプリケーションが一部のパスを保護）",
    [TUNNEL_WORDS.accessNone]: "なし（ほかに止めるものがなければ、インターネットの誰でもアクセスできます）",
    [TUNNEL_WORDS.accessUnknown]: "不明（Access アプリケーションを読み取れませんでした）",
    [TUNNEL_WORDS.service]: "サービス",
    [TUNNEL_WORDS.path]: "パス",
    [TUNNEL_WORDS.dns]: "DNS",
    [TUNNEL_WORDS.dnsCreate]: "トンネルへのプロキシ CNAME を追加します",
    [TUNNEL_WORDS.dnsKeep]: "既存のトンネルへの CNAME をそのまま使います",
    [TUNNEL_WORDS.dnsMissing]: "このホスト名はトンネルに届きません",
    [TUNNEL_WORDS.changes]: "変更内容",
  },
}
