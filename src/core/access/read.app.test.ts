import { expect, test } from "bun:test"
import { ZONE_ID, rejection } from "../cloudflare/client.fixtures"
import { ok } from "../cloudflare/testing"
import { invoke } from "../tool"
import {
  APP,
  APP_ID,
  APP_PATH,
  APP_POLICIES_PATH,
  APPS_PATH,
  CTX,
  errorOf,
  OTHER_APP_ID,
  OTHER_POLICY_ID,
  POLICY,
  SHAPED_APP,
  SHAPED_POLICY,
  toolFor,
  ZONE_APP_PATH,
  ZONE_APP_POLICIES_PATH,
  ZONE_APPS_PATH,
  ZONE_NAME,
} from "./fixtures"

const FULL_PAGE = Array.from({ length: 100 }, () => ({ ...APP, name: "WIKI" }))

test("app by trimmed id reads the application and its policies without listing", async () => {
  const { tool, requests } = toolFor(
    { method: "GET", path: APP_PATH, reply: ok(APP) },
    { method: "GET", path: APP_POLICIES_PATH, reply: ok([POLICY, null, { id: 1 }], { page: 1, total_pages: 1 }) },
  )
  const result = await invoke(tool, { method: "app", app: ` ${APP_ID} ` }, CTX)
  expect(result).toEqual({ label: "default", app: { ...SHAPED_APP, policies: [SHAPED_POLICY] } })
  expect(requests.map(({ path }) => path).sort()).toEqual([APP_PATH, APP_POLICIES_PATH].sort())
  const policiesRequest = requests.find(({ path }) => path === APP_POLICIES_PATH)!
  expect(Object.fromEntries(policiesRequest.query)).toEqual({ page: "1", per_page: "100" })
})

test("app drops secret-bearing configuration of the application", async () => {
  const { tool } = toolFor(
    {
      method: "GET",
      path: APP_PATH,
      reply: ok({
        ...APP,
        saas_app: { client_secret: "cs-made-up" },
        scim_config: { authentication: { password: "pw-made-up" } },
        client_secret: "cs-made-up-2",
      }),
    },
    { method: "GET", path: APP_POLICIES_PATH, reply: ok([]) },
  )
  const result = await invoke(tool, { method: "app", app: APP_ID }, CTX)
  expect(result.app).toEqual({ ...SHAPED_APP, policies: [] })
  expect(JSON.stringify(result)).not.toMatch(/made-up|saas_app|scim_config|client_secret/)
})

test("app by name finds an exact match on page two then reads its id", async () => {
  const { tool, requests } = toolFor(
    {
      method: "GET",
      path: APPS_PATH,
      reply: (request) => (request.query.get("page") === "1" ? ok(FULL_PAGE) : ok([APP])),
    },
    { method: "GET", path: APP_PATH, reply: ok(APP) },
    { method: "GET", path: APP_POLICIES_PATH, reply: ok([]) },
  )
  const result = await invoke(tool, { method: "app", app: " Wiki " }, CTX)
  expect(result.app?.id).toBe(APP_ID)
  const lists = requests.filter(({ path }) => path === APPS_PATH)
  expect(lists.map(({ query }) => Object.fromEntries(query))).toEqual([
    { page: "1", per_page: "100" },
    { page: "2", per_page: "100" },
  ])
  expect(requests.map(({ path }) => path)).toContain(APP_PATH)
})

test("app in a zone uses the zone's routes and names the zone", async () => {
  const { tool, requests } = toolFor(
    { method: "GET", path: ZONE_APPS_PATH, reply: ok([APP]) },
    { method: "GET", path: ZONE_APP_PATH, reply: ok(APP) },
    { method: "GET", path: ZONE_APP_POLICIES_PATH, reply: ok([POLICY]) },
  )
  for (const app of [APP_ID, "Wiki"]) {
    const result = await invoke(tool, { method: "app", app, zone: ZONE_ID }, CTX)
    expect(result).toEqual({
      label: "default",
      zone: { id: ZONE_ID, name: ZONE_NAME },
      app: { ...SHAPED_APP, policies: [SHAPED_POLICY] },
    })
  }
  expect(requests.map(({ path }) => path)).not.toContain(APP_PATH)
  expect(requests.map(({ path }) => path)).toContain(ZONE_APPS_PATH)
})

test("app name lookup stops on a short page or the reported last page", async () => {
  for (const [path, args, where] of [
    [APPS_PATH, { method: "app", app: "absent" }, "the account"],
    [ZONE_APPS_PATH, { method: "app", app: "absent", zone: ZONE_ID }, "the zone"],
  ] as const) {
    for (const reply of [ok([]), ok(FULL_PAGE, { total_pages: 1 })]) {
      const { tool, requests } = toolFor({ method: "GET", path, reply })
      const error = errorOf(await rejection(invoke(tool, args, CTX)))
      expect(error.code).toBe("not_found")
      expect(error.message).toBe(`No Access application named "absent" in ${where}.`)
      expect(requests.filter((request) => request.path === path)).toHaveLength(1)
    }
  }
})

test("app name lookup stops at ten full pages and suggests the id", async () => {
  for (const [path, args, where] of [
    [APPS_PATH, { method: "app", app: "absent" }, "the account"],
    [ZONE_APPS_PATH, { method: "app", app: "absent", zone: ZONE_ID }, "the zone"],
  ] as const) {
    const { tool, requests } = toolFor({ method: "GET", path, reply: ok(FULL_PAGE) })
    const error = errorOf(await rejection(invoke(tool, args, CTX)))
    expect(error.code).toBe("not_found")
    expect(error.message).toBe(
      `No Access application named "absent" among the first 1000 applications of ${where}; pass its id.`,
    )
    expect(requests.filter((request) => request.path === path)).toHaveLength(10)
  }
})

test("app reads its policies across pages", async () => {
  const { tool, requests } = toolFor(
    { method: "GET", path: APP_PATH, reply: ok(APP) },
    {
      method: "GET",
      path: APP_POLICIES_PATH,
      reply: (request) =>
        request.query.get("page") === "1"
          ? ok([POLICY], { page: 1, total_pages: 2 })
          : ok([{ ...POLICY, id: OTHER_POLICY_ID }], { page: 2, total_pages: 2 }),
    },
  )
  const result = await invoke(tool, { method: "app", app: APP_ID }, CTX)
  expect(result.app?.policies.map(({ id }) => id)).toEqual([POLICY.id, OTHER_POLICY_ID])
  expect(
    requests.filter(({ path }) => path === APP_POLICIES_PATH).map(({ query }) => Object.fromEntries(query)),
  ).toEqual([
    { page: "1", per_page: "100" },
    { page: "2", per_page: "100" },
  ])
})

test("app reads exactly ten pages of policies", async () => {
  const { tool, requests } = toolFor(
    { method: "GET", path: APP_PATH, reply: ok(APP) },
    { method: "GET", path: APP_POLICIES_PATH, reply: ok([POLICY], { total_pages: 10 }) },
  )
  const result = await invoke(tool, { method: "app", app: APP_ID }, CTX)
  expect(result.app?.policies).toHaveLength(10)
  expect(requests.filter(({ path }) => path === APP_POLICIES_PATH)).toHaveLength(10)
})

test("app fails rather than return a partial list when policies pass ten pages", async () => {
  const { tool, requests } = toolFor(
    { method: "GET", path: APP_PATH, reply: ok(APP) },
    { method: "GET", path: APP_POLICIES_PATH, reply: ok([POLICY], { total_pages: 11 }) },
  )
  const error = errorOf(await rejection(invoke(tool, { method: "app", app: APP_ID }, CTX)))
  expect(error.code).toBe("upstream_error")
  expect(error.message).toBe("The application has more policies than this tool reads.")
  expect(requests.filter(({ path }) => path === APP_POLICIES_PATH)).toHaveLength(10)
})

test("app name shared by several applications is refused with their ids, without reading one", async () => {
  for (const [path, args, where] of [
    [APPS_PATH, { method: "app", app: "Wiki" }, "the account"],
    [ZONE_APPS_PATH, { method: "app", app: "Wiki", zone: ZONE_ID }, "the zone"],
  ] as const) {
    const { tool, requests } = toolFor({
      method: "GET",
      path,
      reply: (request) =>
        request.query.get("page") === "1"
          ? ok(
              FULL_PAGE.map((row, index) => (index === 7 ? { ...APP } : row)),
              { total_pages: 2 },
            )
          : ok([{ ...APP, id: OTHER_APP_ID }], { total_pages: 2 }),
    })
    const error = errorOf(await rejection(invoke(tool, args, CTX)))
    expect(error.code).toBe("invalid_argument")
    expect(error.message).toBe(
      `Several Access applications are named "Wiki" in ${where}; pass one of their ids: ${APP_ID}, ${OTHER_APP_ID}.`,
    )
    expect(requests.filter((request) => request.path === path)).toHaveLength(2)
    expect(requests.map(({ path }) => path)).not.toContain(APP_PATH)
    expect(requests.map(({ path }) => path)).not.toContain(ZONE_APP_PATH)
  }
})

test("app name with one match among ten full pages is used", async () => {
  const { tool, requests } = toolFor(
    {
      method: "GET",
      path: APPS_PATH,
      reply: (request) => ok(request.query.get("page") === "4" ? [APP, ...FULL_PAGE.slice(1)] : FULL_PAGE),
    },
    { method: "GET", path: APP_PATH, reply: ok(APP) },
    { method: "GET", path: APP_POLICIES_PATH, reply: ok([]) },
  )
  const result = await invoke(tool, { method: "app", app: "Wiki" }, CTX)
  expect(result.app?.id).toBe(APP_ID)
  expect(requests.filter(({ path }) => path === APPS_PATH)).toHaveLength(10)
})
