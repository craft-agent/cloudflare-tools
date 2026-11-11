import { ACCOUNT_ID, envFor } from "../cloudflare/client.fixtures"
import { fakeCloudflare, type FakeRoute } from "../cloudflare/testing"
import { defineQueuesRead } from "./read"

export { errorOf, refusalOf } from "../workers/fixtures"
export { CTX } from "../zone/fixtures"

export const QUEUE_ID = "a1".repeat(16)
export const QUEUES_PATH = `/accounts/${ACCOUNT_ID}/queues`
export const QUEUE_PATH = `${QUEUES_PATH}/${QUEUE_ID}`
export const QUEUE = { queue_id: QUEUE_ID, queue_name: "mail-jobs" }
export const EMPTY_SETTINGS = { delivery_delay: null, delivery_paused: null, message_retention_period: null }

/** The tool wired to a fake Cloudflare that answers `routes`. */
export function toolFor(...routes: FakeRoute[]) {
  const { fetch, requests } = fakeCloudflare(routes)
  return { tool: defineQueuesRead({ fetch, env: envFor() }), requests }
}
