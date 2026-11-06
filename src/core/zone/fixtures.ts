import { ACCOUNT_ID, ZONE_ID } from "../cloudflare/client.fixtures"
import { ok, type FakeRoute } from "../cloudflare/testing"

export const CTX = { cwd: process.cwd() }
export const OTHER_ACCOUNT_ID = "1".repeat(32)
export const ZONE_NAME = "example.com"
export const ZONE_PATH = `/zones/${ZONE_ID}`

export const SAMPLE_ZONE = {
  id: ZONE_ID,
  name: ZONE_NAME,
  account: { id: ACCOUNT_ID },
}

export const ZONE_ROUTE: FakeRoute = {
  method: "GET",
  path: ZONE_PATH,
  reply: ok(SAMPLE_ZONE),
}
