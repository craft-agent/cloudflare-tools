import { expect, test } from "bun:test"
import { ToolError } from "../errors"
import { PATH_PARAMS, QUEUE_ID_PATTERN, ROUTES, isAllowed } from "./routes"
import { fillPath } from "./url"

const ACCOUNT_ID = "a".repeat(32)
const QUEUE_ID = "b1".repeat(16)

test("queue routes allow only account-scoped GETs, never messages", () => {
  expect(ROUTES.queues).toEqual({ method: "GET", path: "/accounts/{account_id}/queues" })
  expect(ROUTES.queue).toEqual({ method: "GET", path: "/accounts/{account_id}/queues/{queue_id}" })
  expect(PATH_PARAMS.queue_id).toBe(QUEUE_ID_PATTERN)
  for (const route of [ROUTES.queues, ROUTES.queue]) {
    expect(isAllowed(route)).toBe(true)
    for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
      expect(isAllowed({ method, path: route.path })).toBe(false)
    }
  }
  expect(isAllowed({ method: "GET", path: `${ROUTES.queue.path}/messages` })).toBe(false)
})

test("queue paths fill from the account and accept only lowercase 32-hex ids", () => {
  expect(fillPath(ROUTES.queues, ACCOUNT_ID)).toBe(`/accounts/${ACCOUNT_ID}/queues`)
  expect(fillPath(ROUTES.queue, ACCOUNT_ID, { queue_id: QUEUE_ID })).toBe(`/accounts/${ACCOUNT_ID}/queues/${QUEUE_ID}`)
  for (const queue_id of ["", "a1", QUEUE_ID.toUpperCase(), "../queues", `${QUEUE_ID}/messages`, "g".repeat(32)]) {
    expect(() => fillPath(ROUTES.queue, ACCOUNT_ID, { queue_id })).toThrow(ToolError)
  }
})
