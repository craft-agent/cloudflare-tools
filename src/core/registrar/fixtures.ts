import { ACCOUNT_ID, envFor } from "../cloudflare/client.fixtures"
import { fakeCloudflare, type FakeRoute } from "../cloudflare/testing"
import { defineRegistrarRead } from "./read"

export { errorOf, refusalOf } from "../workers/fixtures"
export { CTX } from "../zone/fixtures"

export const DOMAIN_NAME = "example.net"
export const REGISTRATIONS_PATH = `/accounts/${ACCOUNT_ID}/registrar/registrations`
export const REGISTRATION_PATH = `${REGISTRATIONS_PATH}/${DOMAIN_NAME}`
export const REGISTRATION = { domain_name: DOMAIN_NAME, status: "active" }
export const EMPTY_DOMAIN = {
  name: DOMAIN_NAME,
  status: null,
  expires_at: null,
  auto_renew: null,
  locked: null,
  privacy_mode: null,
  created_at: null,
}
export const CONTACTS = {
  registrant_contact: { email: "made-up@example.org", phone: "+1-202-555-0123" },
  contacts: { admin: { email: "made-up@example.org", phone: "+1-202-555-0123" } },
}

/** The tool wired to a fake Cloudflare that answers `routes`. */
export function toolFor(...routes: FakeRoute[]) {
  const { fetch, requests } = fakeCloudflare(routes)
  return { tool: defineRegistrarRead({ fetch, env: envFor() }), requests }
}
