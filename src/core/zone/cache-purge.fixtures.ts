import { envFor, ZONE_ID } from "../cloudflare/client.fixtures"
import { fakeCloudflare, ok, type FakeReply, type FakeRequest, type FakeRoute } from "../cloudflare/testing"
import { defineZoneCachePurge } from "./cache-purge"
import { defineZoneCachePurgeAll } from "./cache-purge-all"
import { CTX, ZONE_PATH, ZONE_ROUTE } from "./fixtures"

export { CTX, ZONE_PATH, ZONE_ROUTE }
export const PURGE_PATH = `/zones/${ZONE_ID}/purge_cache`
export const PURGE_ID = "purge1234567890abcdef"

export function purgeRoute(reply?: FakeReply | ((request: FakeRequest) => FakeReply)): FakeRoute {
  return {
    method: "POST",
    path: PURGE_PATH,
    reply: reply ?? ok({ id: PURGE_ID }),
  }
}

/** Both cache purge tools wired to a fake Cloudflare that answers `routes`. */
export function setup(routes: FakeRoute[]) {
  const { fetch, requests } = fakeCloudflare(routes)
  const deps = { fetch, env: envFor() }
  return {
    purge: defineZoneCachePurge(deps),
    purgeAll: defineZoneCachePurgeAll(deps),
    requests,
  }
}
