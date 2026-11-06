import { envFor, ZONE_ID } from "../cloudflare/client.fixtures"
import { fakeCloudflare, ok, type FakeReply, type FakeRequest, type FakeRoute } from "../cloudflare/testing"
import { CTX, ZONE_PATH, ZONE_ROUTE } from "./fixtures"
import type { ZoneSetting } from "./settings"
import { defineZoneSettingEdit, defineZoneSettingWeaken } from "./setting-edit"

export { CTX, ZONE_PATH, ZONE_ROUTE }
export const MODIFIED_ON = "2024-02-01T00:00:00Z"

export function settingPath(setting: ZoneSetting): string {
  return `${ZONE_PATH}/settings/${setting}`
}

/** The read of a setting that currently holds `value`. */
export function currentRoute(setting: ZoneSetting, value: unknown, editable = true): FakeRoute {
  return {
    method: "GET",
    path: settingPath(setting),
    reply: ok({ id: setting, value, editable, modified_on: "2024-01-01T00:00:00Z" }),
  }
}

/** The PATCH of a setting; by default it answers with the value it was sent. */
export function patchRoute(setting: ZoneSetting, reply?: FakeReply | ((request: FakeRequest) => FakeReply)): FakeRoute {
  return {
    method: "PATCH",
    path: settingPath(setting),
    reply:
      reply ??
      ((request) => ok({ id: setting, value: (request.body as { value: unknown }).value, modified_on: MODIFIED_ON })),
  }
}

/** Both tools wired to a fake Cloudflare that answers `routes`, with the requests it received. */
export function setup(routes: FakeRoute[]) {
  const { fetch, requests } = fakeCloudflare(routes)
  const deps = { fetch, env: envFor() }
  return { edit: defineZoneSettingEdit(deps), weaken: defineZoneSettingWeaken(deps), requests }
}

/** The settings the PATCH requests wrote, in order. */
export function patches(requests: FakeRequest[]): string[] {
  return requests.filter((request) => request.method === "PATCH").map((request) => request.path.split("/").at(-1)!)
}
