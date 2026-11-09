import type { Translations } from "../words"

/** The English headline templates, fact labels and value templates the storage describers use. */
export const STORAGE_WORDS = {
  createR2: "About to create the R2 bucket {name}",
  createKv: "About to create the KV namespace {name}",
  createD1: "About to create the D1 database {name}",
  deleteR2: "About to delete the R2 bucket {name}",
  deleteKv: "About to delete the KV namespace {name}",
  deleteD1: "About to delete the D1 database {name}",
  contents: "Contents",
  contentsEmpty: "empty, as checked just now",
  effect: "Effect",
  effectDelete: "deleting it is for good",
} as const

/** The translations of the storage tools' words: their titles, intents, headline templates, fact labels and value templates. */
export const STORAGE_TRANSLATIONS: Translations = {
  ja: {
    "Create a Cloudflare R2 bucket, KV namespace or D1 database":
      "Cloudflare の R2 バケット、KV 名前空間、D1 データベースを作成する",
    "Delete an empty Cloudflare R2 bucket, KV namespace or D1 database":
      "空の Cloudflare R2 バケット、KV 名前空間、D1 データベースを削除する",
    "About to create a store": "ストレージを作成しようとしています",
    "About to delete an empty store": "空のストレージを削除しようとしています",
    [STORAGE_WORDS.createR2]: "R2 バケット {name} を作成しようとしています",
    [STORAGE_WORDS.createKv]: "KV 名前空間 {name} を作成しようとしています",
    [STORAGE_WORDS.createD1]: "D1 データベース {name} を作成しようとしています",
    [STORAGE_WORDS.deleteR2]: "R2 バケット {name} を削除しようとしています",
    [STORAGE_WORDS.deleteKv]: "KV 名前空間 {name} を削除しようとしています",
    [STORAGE_WORDS.deleteD1]: "D1 データベース {name} を削除しようとしています",
    [STORAGE_WORDS.contents]: "中身",
    [STORAGE_WORDS.contentsEmpty]: "空（直前に確認済み）",
    [STORAGE_WORDS.effect]: "影響",
    [STORAGE_WORDS.effectDelete]: "削除は取り消せません",
  },
}
