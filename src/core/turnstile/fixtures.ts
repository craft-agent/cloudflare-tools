import { ACCOUNT_ID, envFor } from "../cloudflare/client.fixtures"
import { fakeCloudflare, type FakeRoute } from "../cloudflare/testing"
import { defineTurnstileRead } from "./read"

export { errorOf, refusalOf } from "../workers/fixtures"
export { CTX } from "../zone/fixtures"

export const SITEKEY = "0x4AAAAAAA_test-1"
export const WIDGETS_PATH = `/accounts/${ACCOUNT_ID}/challenges/widgets`
export const WIDGET_PATH = `${WIDGETS_PATH}/${SITEKEY}`
export const WIDGET = { sitekey: SITEKEY, name: "app" }
export const EMPTY_WIDGET = {
  sitekey: SITEKEY,
  name: null,
  domains: [],
  mode: null,
  clearance_level: null,
  region: null,
  bot_fight_mode: null,
  ephemeral_id: null,
  offlabel: null,
  created_on: null,
  modified_on: null,
}

/** The tool wired to a fake Cloudflare that answers `routes`. */
export function toolFor(...routes: FakeRoute[]) {
  const { fetch, requests } = fakeCloudflare(routes)
  return { tool: defineTurnstileRead({ fetch, env: envFor() }), requests }
}
