import { ACCOUNT_ID, envFor } from "../cloudflare/client.fixtures"
import { fakeCloudflare, type FakeRoute } from "../cloudflare/testing"
import { defineTunnelRead } from "./read"

export { errorOf, refusalOf } from "../workers/fixtures"
export { CTX } from "../zone/fixtures"

export const TUNNEL_ID = "11111111-2222-3333-4444-555555555555"
export const TUNNEL_ID_LOCAL = "66666666-7777-8888-9999-aaaaaaaaaaaa"

export const TUNNELS_PATH = `/accounts/${ACCOUNT_ID}/cfd_tunnel`
export const TUNNEL_PATH = `/accounts/${ACCOUNT_ID}/cfd_tunnel/${TUNNEL_ID}`
export const TUNNEL_CONNECTIONS_PATH = `${TUNNEL_PATH}/connections`
export const TUNNEL_CONFIG_PATH = `${TUNNEL_PATH}/configurations`

export const TUNNEL_LOCAL_PATH = `/accounts/${ACCOUNT_ID}/cfd_tunnel/${TUNNEL_ID_LOCAL}`
export const TUNNEL_LOCAL_CONNECTIONS_PATH = `${TUNNEL_LOCAL_PATH}/connections`

/** The tool wired to a fake Cloudflare that answers `routes`. */
export function toolFor(...routes: FakeRoute[]) {
  const { fetch, requests } = fakeCloudflare(routes)
  return { tool: defineTunnelRead({ fetch, env: envFor() }), requests }
}
