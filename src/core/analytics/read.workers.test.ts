import { expect, test } from "bun:test"
import { rejection } from "../cloudflare/client.fixtures"
import { invoke } from "../tool"
import {
  ACCOUNT_ID,
  CTX,
  GRAPHQL_PATH,
  ZONE_NAME,
  accountData,
  errorOf,
  graphqlFailure,
  graphqlReply,
  graphqlRoute,
  refusalOf,
  toolFor,
} from "./fixtures"
import { WORKER_QUERY, WORKERS_QUERY } from "./queries"

const DATASET = "workersInvocationsAdaptive"

const ROW = {
  sum: { requests: 120, errors: 4, subrequests: 30 },
  quantiles: { cpuTimeP50: 850, cpuTimeP99: 9100 },
  dimensions: { scriptName: "my-worker", status: "success" },
}

function workersTool(...rows: unknown[]) {
  return toolFor(graphqlRoute(graphqlReply(accountData(DATASET, rows))))
}

function sent(requests: ReturnType<typeof workersTool>["requests"]) {
  return requests.find((request) => request.path === GRAPHQL_PATH)
}

test("workers sends the account query with the account id from the credential and the time range", async () => {
  const { tool, requests } = workersTool()
  await invoke(tool, { method: "workers", since: "2026-11-01", until: "2026-11-02T06:30:00Z" }, CTX)

  expect(sent(requests)?.body).toEqual({
    query: WORKERS_QUERY,
    variables: { accountTag: ACCOUNT_ID, since: "2026-11-01T00:00:00Z", until: "2026-11-02T06:30:00Z" },
  })
  expect(requests.some((request) => request.path.startsWith("/zones"))).toBe(false)
})

test("with script it sends the Worker query with that name, trimmed", async () => {
  const { tool, requests } = workersTool()
  await invoke(tool, { method: "workers", script: " my-worker\n" }, CTX)

  expect(sent(requests)?.body).toEqual({
    query: WORKER_QUERY,
    variables: {
      accountTag: ACCOUNT_ID,
      scriptName: "my-worker",
      since: "2026-11-06T15:42:09Z",
      until: "2026-11-07T15:42:09Z",
    },
  })
})

test("the queries differ only in the script filter", () => {
  expect(WORKER_QUERY.replace(" $scriptName: string,", "").replace(", scriptName: $scriptName", "")).toBe(WORKERS_QUERY)
})

test("workers shapes rows in Cloudflare's order and has no zone", async () => {
  const { tool } = workersTool(ROW, {
    ...ROW,
    sum: { requests: 5, errors: 5, subrequests: 0 },
    dimensions: { scriptName: "my-worker", status: "scriptThrewException" },
  })

  expect(await invoke(tool, { method: "workers" }, CTX)).toEqual({
    label: "default",
    since: "2026-11-06T15:42:09Z",
    until: "2026-11-07T15:42:09Z",
    rows: [
      {
        script: "my-worker",
        status: "success",
        requests: 120,
        errors: 4,
        subrequests: 30,
        cpu_time_p50_us: 850,
        cpu_time_p99_us: 9100,
      },
      {
        script: "my-worker",
        status: "scriptThrewException",
        requests: 5,
        errors: 5,
        subrequests: 0,
        cpu_time_p50_us: 850,
        cpu_time_p99_us: 9100,
      },
    ],
  })
})

test("a number Cloudflare did not send is null and a row without a script name is dropped", async () => {
  const { tool } = workersTool(
    { dimensions: { scriptName: "bare" } },
    { sum: { requests: "many" }, quantiles: { cpuTimeP50: null }, dimensions: { scriptName: "odd", status: 3 } },
    { sum: { requests: 9 }, dimensions: { status: "success" } },
    { sum: { requests: 9 } },
  )
  const empty = {
    status: null,
    requests: null,
    errors: null,
    subrequests: null,
    cpu_time_p50_us: null,
    cpu_time_p99_us: null,
  }

  expect((await invoke(tool, { method: "workers" }, CTX)).rows).toEqual([
    { script: "bare", ...empty },
    { script: "odd", ...empty },
  ])
})

test("zone is refused for workers and script for the zone reports, before anything is sent", async () => {
  const { tool, requests } = workersTool()

  expect(await refusalOf(invoke(tool, { method: "workers", zone: ZONE_NAME }, CTX))).toContain(
    'Method "workers" takes no `zone`.',
  )
  for (const method of ["traffic", "paths", "security", "security_events"] as const) {
    expect(await refusalOf(invoke(tool, { method, zone: ZONE_NAME, script: "my-worker" }, CTX))).toContain(
      `Method "${method}" takes no \`script\`.`,
    )
  }
  expect(requests).toEqual([])
})

test("an invalid Worker name is refused before anything is sent", async () => {
  const { tool, requests } = workersTool()

  for (const script of ["My-Worker", "", "a/b", "a".repeat(64)]) {
    const error = errorOf(await rejection(invoke(tool, { method: "workers", script }, CTX)))
    expect(error.code).toBe("invalid_argument")
    expect(error.message).toContain("`script` must be")
  }
  expect(requests).toEqual([])
})

test("a range over 31 days is refused", async () => {
  const { tool } = workersTool()
  const error = errorOf(await rejection(invoke(tool, { method: "workers", since: "2026-09-01" }, CTX)))

  expect(error.message).toBe("this report reads at most 31 days at once.")
})

test("a forbidden query names the account permission, not the zone one", async () => {
  const { tool } = toolFor(graphqlRoute(graphqlFailure("Account analytics denied", "authz")))
  const error = errorOf(await rejection(invoke(tool, { method: "workers" }, CTX)))

  expect(error.code).toBe("forbidden")
  expect(error.message).toEndWith(" The token needs Account → Account Analytics → Read.")
  expect(error.message).not.toContain("Zone → Analytics")
})

test("an answer without the account or the dataset is an upstream_error", async () => {
  for (const data of [
    {},
    { viewer: null },
    { viewer: { accounts: [] } },
    { viewer: { accounts: [{}] } },
    { viewer: { accounts: [{ [DATASET]: {} }] } },
    { viewer: { zones: [{ [DATASET]: [] }] } },
  ]) {
    const { tool } = toolFor(graphqlRoute(graphqlReply(data)))
    const error = errorOf(await rejection(invoke(tool, { method: "workers" }, CTX)))

    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe("Cloudflare returned an unexpected analytics response.")
  }
})
