import { ACCOUNT_ID, envFor } from "../cloudflare/client.fixtures"
import { fakeCloudflare, type FakeRoute } from "../cloudflare/testing"
import { defineVectorizeRead } from "./read"

export { errorOf, refusalOf } from "../workers/fixtures"
export { CTX } from "../zone/fixtures"

export const INDEX_NAME = "app-search"
export const INDEXES_PATH = `/accounts/${ACCOUNT_ID}/vectorize/v2/indexes`
export const INDEX_PATH = `${INDEXES_PATH}/${INDEX_NAME}`
export const INFO_PATH = `${INDEX_PATH}/info`
export const METADATA_PATH = `${INDEX_PATH}/metadata_index/list`
export const INDEX = { name: INDEX_NAME }
export const EMPTY_INDEX = {
  ...INDEX,
  description: null,
  dimensions: null,
  metric: null,
  preset: null,
  created_on: null,
  modified_on: null,
}

/** The tool wired to a fake Cloudflare that answers `routes`. */
export function toolFor(...routes: FakeRoute[]) {
  const { fetch, requests } = fakeCloudflare(routes)
  return { tool: defineVectorizeRead({ fetch, env: envFor() }), requests }
}
