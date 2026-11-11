import { expect, test } from "bun:test"
import { ZONE_ID, rejection } from "../cloudflare/client.fixtures"
import { fail, ok } from "../cloudflare/testing"
import { invoke } from "../tool"
import {
  APP,
  APP_ID,
  APP_PATH,
  APP_POLICIES_PATH,
  APPS_PATH,
  CTX,
  errorOf,
  POLICIES_PATH,
  toolFor,
  ZONE_APP_PATH,
  ZONE_APP_POLICIES_PATH,
  ZONE_APPS_PATH,
} from "./fixtures"

const ACCOUNT_HINT = "Authentication error. The token needs Account → Access: Apps and Policies → Read."
const ZONE_HINT = "Authentication error. The token needs Zone → Access: Apps and Policies → Read."

test("forbidden account reads carry a sentence and the account permission hint", async () => {
  const forbidden = fail(403, [{ code: 10000, message: "Authentication error" }])
  for (const [args, routes] of [
    [{ method: "apps" }, [{ method: "GET", path: APPS_PATH, reply: forbidden }]],
    [{ method: "policies" }, [{ method: "GET", path: POLICIES_PATH, reply: forbidden }]],
    [{ method: "app", app: "Wiki" }, [{ method: "GET", path: APPS_PATH, reply: forbidden }]],
    [
      { method: "app", app: APP_ID },
      [
        { method: "GET", path: APP_PATH, reply: forbidden },
        { method: "GET", path: APP_POLICIES_PATH, reply: forbidden },
      ],
    ],
    [
      { method: "app", app: APP_ID },
      [
        { method: "GET", path: APP_PATH, reply: ok(APP) },
        { method: "GET", path: APP_POLICIES_PATH, reply: forbidden },
      ],
    ],
  ] as const) {
    const { tool } = toolFor(...routes)
    const error = errorOf(await rejection(invoke(tool, args, CTX)))
    expect(error.code).toBe("forbidden")
    expect(error.message).toContain(ACCOUNT_HINT)
  }
})

test("forbidden zone reads carry the zone permission hint", async () => {
  const forbidden = fail(403, [{ code: 10000, message: "Authentication error" }])
  for (const [args, routes] of [
    [{ method: "apps", zone: ZONE_ID }, [{ method: "GET", path: ZONE_APPS_PATH, reply: forbidden }]],
    [{ method: "app", app: "Wiki", zone: ZONE_ID }, [{ method: "GET", path: ZONE_APPS_PATH, reply: forbidden }]],
    [
      { method: "app", app: APP_ID, zone: ZONE_ID },
      [
        { method: "GET", path: ZONE_APP_PATH, reply: forbidden },
        { method: "GET", path: ZONE_APP_POLICIES_PATH, reply: forbidden },
      ],
    ],
  ] as const) {
    const { tool } = toolFor(...routes)
    const error = errorOf(await rejection(invoke(tool, args, CTX)))
    expect(error.code).toBe("forbidden")
    expect(error.message).toContain(ZONE_HINT)
    expect(error.message).not.toContain("Account →")
  }
})

test("unexpected list shapes are upstream errors", async () => {
  for (const raw of [null, {}, "bad", 1]) {
    for (const [args, path, what] of [
      [{ method: "apps" }, APPS_PATH, "applications"],
      [{ method: "app", app: "Wiki" }, APPS_PATH, "applications"],
      [{ method: "apps", zone: ZONE_ID }, ZONE_APPS_PATH, "applications"],
      [{ method: "policies" }, POLICIES_PATH, "policies"],
    ] as const) {
      const { tool } = toolFor({ method: "GET", path, reply: ok(raw) })
      const error = errorOf(await rejection(invoke(tool, args, CTX)))
      expect(error.code).toBe("upstream_error")
      expect(error.message).toBe(`Cloudflare returned an unexpected ${what} response.`)
    }
  }
})

test("unexpected application and application policy shapes are upstream errors", async () => {
  for (const raw of [null, [], "bad", {}, { name: "no id" }, { id: 1 }]) {
    const { tool } = toolFor(
      { method: "GET", path: APP_PATH, reply: ok(raw) },
      { method: "GET", path: APP_POLICIES_PATH, reply: ok([]) },
    )
    const error = errorOf(await rejection(invoke(tool, { method: "app", app: APP_ID }, CTX)))
    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe("Cloudflare returned an unexpected application response.")
  }
  for (const raw of [null, {}, "bad", 1]) {
    const { tool } = toolFor(
      { method: "GET", path: APP_PATH, reply: ok(APP) },
      { method: "GET", path: APP_POLICIES_PATH, reply: ok(raw) },
    )
    const error = errorOf(await rejection(invoke(tool, { method: "app", app: APP_ID }, CTX)))
    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe("Cloudflare returned an unexpected policies response.")
  }
})
