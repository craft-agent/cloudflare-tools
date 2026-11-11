import { ACCOUNT_ID, ZONE_ID, envFor } from "../cloudflare/client.fixtures"
import { fakeCloudflare, type FakeRoute } from "../cloudflare/testing"
import { ZONE_ROUTE } from "../zone/fixtures"
import { defineAccessRead } from "./read"

export { errorOf, refusalOf } from "../workers/fixtures"
export { CTX, ZONE_NAME } from "../zone/fixtures"

export const APP_ID = "0b2e3c4d-1a2b-4c3d-8e9f-0a1b2c3d4e5f"
export const OTHER_APP_ID = "9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a"
export const POLICY_ID = "1c2d3e4f-5a6b-4c7d-8e9f-a0b1c2d3e4f5"
export const OTHER_POLICY_ID = "2d3e4f5a-6b7c-4d8e-9fa0-b1c2d3e4f5a6"

export const APPS_PATH = `/accounts/${ACCOUNT_ID}/access/apps`
export const APP_PATH = `${APPS_PATH}/${APP_ID}`
export const APP_POLICIES_PATH = `${APP_PATH}/policies`
export const POLICIES_PATH = `/accounts/${ACCOUNT_ID}/access/policies`
export const ZONE_APPS_PATH = `/zones/${ZONE_ID}/access/apps`
export const ZONE_APP_PATH = `${ZONE_APPS_PATH}/${APP_ID}`
export const ZONE_APP_POLICIES_PATH = `${ZONE_APP_PATH}/policies`

export const APP = { id: APP_ID, name: "Wiki" }
export const POLICY = { id: POLICY_ID, name: "Staff" }

/** `APP` as the tool shapes it: every other field empty. */
export const SHAPED_APP = {
  ...APP,
  type: null,
  domain: null,
  destinations: [],
  self_hosted_domains: [],
  aud: null,
  allowed_idps: [],
  session_duration: null,
  app_launcher_visible: null,
  auto_redirect_to_identity: null,
  created_at: null,
  updated_at: null,
}

/** `POLICY` as the tool shapes it: every other field empty. */
export const SHAPED_POLICY = {
  ...POLICY,
  decision: null,
  precedence: null,
  reusable: null,
  session_duration: null,
  approval_required: null,
  purpose_justification_required: null,
  isolation_required: null,
  app_count: null,
  include: [],
  exclude: [],
  require: [],
  created_at: null,
  updated_at: null,
}

/** The tool wired to a fake Cloudflare that answers the zone lookup and `routes`. */
export function toolFor(...routes: FakeRoute[]) {
  const { fetch, requests } = fakeCloudflare([ZONE_ROUTE, ...routes])
  return { tool: defineAccessRead({ fetch, env: envFor() }), requests }
}
