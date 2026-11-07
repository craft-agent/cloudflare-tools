import { ACCOUNT_ID, ZONE_ID as ACCOUNT_ZONE_ID, envFor } from "../cloudflare/client.fixtures"
import { fakeCloudflare, ok, type FakeReply, type FakeRequest, type FakeRoute } from "../cloudflare/testing"
import { RECORDS_PATH } from "../dns/fixtures"
import { ZONE_NAME, ZONE_PATH, ZONE_ROUTE } from "../zone/fixtures"
import { definePagesDomainAdd } from "./domain-add"
import { definePagesDomainRemove } from "./domain-remove"
import { CTX, DOMAIN_ENTRY, DOMAINS_PATH, PROJECT, PROJECT_ENTRY, PROJECT_PATH } from "./fixtures"

export { ACCOUNT_ID, ACCOUNT_ZONE_ID, CTX, DOMAINS_PATH, PROJECT, PROJECT_PATH, RECORDS_PATH, ZONE_NAME, ZONE_PATH }

export const NAME = `shop.${ZONE_NAME}`
export const DOMAIN_PATH = `${DOMAINS_PATH}/${NAME}`
export const SUBDOMAIN = PROJECT_ENTRY.subdomain
export const ARGS = { project: PROJECT, name: NAME }
export const DOMAIN_TARGET = `${ACCOUNT_ID}/pages/projects/${PROJECT}/domains/${NAME}`

/** Cloudflare's error reply when a domain does not exist on the project. */
export const GONE_ERROR = { code: 8000021, message: "The domain you have requested does not exist" }

export const NO_SUCH_DOMAIN = `Pages project ${PROJECT} has no custom domain ${NAME}; cloudflare_pages_read domains lists them.`

/** The domain as Cloudflare reports it right after adding it, waiting for its CNAME record. */
export const NEW_DOMAIN = {
  ...DOMAIN_ENTRY,
  name: NAME,
  status: "initializing",
  validation_data: { status: "initializing", method: "http" },
  verification_data: { status: "pending" },
  certificate_authority: "google",
  zone_tag: ACCOUNT_ZONE_ID,
  created_on: "2024-03-01T00:00:00Z",
}

/** The same domain once the project holds it and it serves. */
export const ACTIVE_DOMAIN = {
  ...NEW_DOMAIN,
  status: "active",
  validation_data: { status: "active", method: "http" },
  verification_data: { status: "verified" },
}

export const PAGES_CNAME = {
  id: "7".repeat(32),
  type: "CNAME",
  name: NAME,
  content: SUBDOMAIN,
  proxied: true,
  proxiable: true,
  ttl: 1,
  comment: "kept out of the result",
  tags: ["env:prod"],
  created_on: "2024-03-02T00:00:00Z",
  modified_on: "2024-03-03T00:00:00Z",
}

/** `PAGES_CNAME` as a result keeps it: only these fields. */
export const SHAPED_PAGES_CNAME = {
  id: PAGES_CNAME.id,
  type: "CNAME",
  name: NAME,
  content: SUBDOMAIN,
  proxied: true,
  read_only: false,
}

export const EXPECTED_CNAME = { name: NAME, content: SUBDOMAIN, proxied: true }

export const EXPECTED_DNS = {
  zone: { id: ACCOUNT_ZONE_ID, name: ZONE_NAME },
  records: [SHAPED_PAGES_CNAME],
}

export const EMPTY_DNS = {
  zone: { id: ACCOUNT_ZONE_ID, name: ZONE_NAME },
  records: [],
}

export const PROJECT_ROUTE: FakeRoute = { method: "GET", path: PROJECT_PATH, reply: ok(PROJECT_ENTRY) }

/** The records list of the account's zone, answering `reply`: no record unless told otherwise. */
export function recordsRoute(reply: FakeReply | (() => FakeReply) = ok([])): FakeRoute {
  return { method: "GET", path: RECORDS_PATH, reply }
}

/** The add call, answering the new domain unless told otherwise. */
export function addRoute(reply: FakeReply | (() => FakeReply) = ok(NEW_DOMAIN)): FakeRoute {
  return { method: "POST", path: DOMAINS_PATH, reply }
}

/** One domain of the project, answering `reply`: the active one unless told otherwise. */
export function domainRoute(reply: FakeReply = ok(ACTIVE_DOMAIN)): FakeRoute {
  return { method: "GET", path: DOMAIN_PATH, reply }
}

/** The remove call, answering null as Cloudflare does unless told otherwise. */
export function removeRoute(reply: FakeReply | (() => FakeReply) = ok(null)): FakeRoute {
  return { method: "DELETE", path: DOMAIN_PATH, reply }
}

/** The add tool wired to a fake Cloudflare: the `routes` given first, then the project, the zone, no records and the add. */
export function addFor(...routes: FakeRoute[]) {
  const { fetch, requests } = fakeCloudflare([...routes, PROJECT_ROUTE, ZONE_ROUTE, recordsRoute(), addRoute()])
  return { tool: definePagesDomainAdd({ fetch, env: envFor() }), requests }
}

/** The remove tool wired to a fake Cloudflare: the `routes` given first, then the domain, the zone, no records and the removal. */
export function removeFor(...routes: FakeRoute[]) {
  const { fetch, requests } = fakeCloudflare([...routes, domainRoute(), ZONE_ROUTE, recordsRoute(), removeRoute()])
  return { tool: definePagesDomainRemove({ fetch, env: envFor() }), requests }
}

export function sent(requests: FakeRequest[], method: "GET" | "POST" | "DELETE"): FakeRequest[] {
  return requests.filter((request) => request.method === method)
}
