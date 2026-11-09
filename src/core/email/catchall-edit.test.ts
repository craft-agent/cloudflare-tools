import { describe, expect, test } from "bun:test"
import { fail, ok } from "../cloudflare/testing"
import { annotations, invoke, REQUIRES_USER_INTERACTION, toolMeta } from "../tool"
import { cloudflareEmailCatchAllEdit } from "./catchall-edit"
import {
  CATCH_ALL_PATH,
  CATCH_ALL_RULE,
  CATCH_BASE,
  CATCH_BODY,
  DISABLED_CATCH_ALL,
  SHAPED_CATCH_ALL,
  catchAllEditFor,
  catchAllRoute,
} from "./catchall.fixtures"
import { OTHER_DESTINATION } from "./rule.current.fixtures"
import {
  ADDRESSES_PATH,
  CTX,
  DESTINATION,
  ROUTING_PATH,
  ZONE_ID,
  ZONE_NAME,
  calls,
  routingRoute,
  sent,
} from "./rule.fixtures"

const NO_ADDRESSES = ["GET /zones", `GET ${CATCH_ALL_PATH}`, `GET ${ROUTING_PATH}`, `PUT ${CATCH_ALL_PATH}`]
const FORWARDING = { ...CATCH_ALL_RULE, actions: [{ type: "forward", value: [DESTINATION] }] }

describe("cloudflareEmailCatchAllEdit", () => {
  test("is an administrative tool of the email toolset that needs the person's attention", () => {
    expect(cloudflareEmailCatchAllEdit.id).toBe("cloudflare_email_catchall_edit")
    expect(cloudflareEmailCatchAllEdit.toolset).toBe("email")
    expect(annotations(cloudflareEmailCatchAllEdit)).toEqual({
      title: "Change an Email Routing catch-all",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    })
    expect(toolMeta(cloudflareEmailCatchAllEdit)).toEqual({ [REQUIRES_USER_INTERACTION]: true })
    for (const text of [
      "every address no rule matches",
      "turned off, so that such mail is rejected",
      "`replaces` names the catch-all's current state, its action or `disabled`",
      "refused as stale",
      "Wrangler",
      "not a verified destination",
      "sent back whole",
      "always asks",
      "never instructions",
      "Zone → Email Routing Rules → Edit",
      "Account → Email Routing Addresses → Read to check a new forward",
    ]) {
      expect(cloudflareEmailCatchAllEdit.description).toContain(text)
    }
  })

  test("turns the catch-all off, keeping its action and name, and reads no address", async () => {
    const { tool, requests } = catchAllEditFor()

    const result = await invoke(tool, { ...CATCH_BASE, enabled: false }, CTX)

    expect(calls(requests)).toEqual(NO_ADDRESSES)
    expect(sent(requests, "PUT")[0]!.body).toEqual({ ...CATCH_BODY, enabled: false })
    expect(result).toEqual({
      label: "default",
      zone: { id: ZONE_ID, name: ZONE_NAME },
      catch_all: { before: SHAPED_CATCH_ALL, after: { ...SHAPED_CATCH_ALL, enabled: false } },
      routing_enabled: true,
    })
    expect(result).not.toHaveProperty("note")
  })

  test("never sends a priority, a source, a tag or an id", async () => {
    const { tool, requests } = catchAllEditFor(catchAllRoute(ok({ ...CATCH_ALL_RULE, source: "api" })))

    await invoke(tool, { ...CATCH_BASE, enabled: false }, CTX)

    const body = sent(requests, "PUT")[0]!.body
    for (const key of ["priority", "source", "tag", "id"]) expect(body).not.toHaveProperty(key)
  })

  test("sends no name when the catch-all has none", async () => {
    const { tool, requests } = catchAllEditFor(catchAllRoute(ok({ ...CATCH_ALL_RULE, name: undefined })))

    await invoke(tool, { ...CATCH_BASE, enabled: false }, CTX)

    expect(sent(requests, "PUT")[0]!.body).not.toHaveProperty("name")
  })

  test("turns a catch-all on with a new forward after reading the destination addresses", async () => {
    const { tool, requests } = catchAllEditFor(catchAllRoute(ok(DISABLED_CATCH_ALL)))

    const result = await invoke(
      tool,
      { ...CATCH_BASE, replaces: "disabled", action: { type: "forward", to: OTHER_DESTINATION }, enabled: true },
      CTX,
    )

    expect(calls(requests)).toEqual([
      "GET /zones",
      `GET ${CATCH_ALL_PATH}`,
      `GET ${ADDRESSES_PATH}`,
      `GET ${ROUTING_PATH}`,
      `PUT ${CATCH_ALL_PATH}`,
    ])
    expect(sent(requests, "PUT")[0]!.body).toEqual({
      ...CATCH_BODY,
      actions: [{ type: "forward", value: [OTHER_DESTINATION] }],
    })
    expect(result.catch_all.before).toEqual({ ...SHAPED_CATCH_ALL, enabled: false })
    expect(result.catch_all.after).toMatchObject({
      enabled: true,
      action: { type: "forward", to: OTHER_DESTINATION },
    })
  })

  test("turns a catch-all on with the action it kept, and reads no address for a forward that stays", async () => {
    const { tool, requests } = catchAllEditFor(catchAllRoute(ok({ ...FORWARDING, enabled: false })))

    await invoke(tool, { ...CATCH_BASE, replaces: "disabled", enabled: true }, CTX)

    expect(calls(requests)).toEqual(NO_ADDRESSES)
    expect(sent(requests, "PUT")[0]!.body).toEqual({
      ...CATCH_BODY,
      actions: [{ type: "forward", value: [DESTINATION] }],
    })
  })

  test("changes a forward to a drop, reading no address", async () => {
    const { tool, requests } = catchAllEditFor(catchAllRoute(ok(FORWARDING)))

    const result = await invoke(
      tool,
      { ...CATCH_BASE, replaces: { type: "forward", to: DESTINATION }, action: { type: "drop" } },
      CTX,
    )

    expect(calls(requests)).toEqual(NO_ADDRESSES)
    expect(sent(requests, "PUT")[0]!.body).toEqual(CATCH_BODY)
    expect(result.catch_all.after.action).toEqual({ type: "drop" })
  })

  test("changes a drop to a forward after reading the destination addresses", async () => {
    const { tool, requests } = catchAllEditFor()

    await invoke(tool, { ...CATCH_BASE, action: { type: "forward", to: " Owner@Example.NET " } }, CTX)

    expect(calls(requests)).toContain(`GET ${ADDRESSES_PATH}`)
    expect(sent(requests, "PUT")[0]!.body).toMatchObject({ actions: [{ type: "forward", value: [DESTINATION] }] })
  })

  test("hands the mail to a Worker", async () => {
    const { tool, requests } = catchAllEditFor()

    const result = await invoke(tool, { ...CATCH_BASE, action: { type: "worker", worker: "mail-handler" } }, CTX)

    expect(calls(requests)).toEqual(NO_ADDRESSES)
    expect(sent(requests, "PUT")[0]!.body).toEqual({
      ...CATCH_BODY,
      actions: [{ type: "worker", value: ["mail-handler"] }],
    })
    expect(result.catch_all.after.action).toEqual({ type: "worker", worker: "mail-handler" })
  })

  test("turns on a zone's missing catch-all with an action, which was off with none", async () => {
    const { tool, requests } = catchAllEditFor(catchAllRoute(fail(404, [{ code: 1004, message: "Not found" }])))

    const result = await invoke(
      tool,
      { ...CATCH_BASE, replaces: "disabled", action: { type: "drop" }, enabled: true },
      CTX,
    )

    expect(sent(requests, "PUT")[0]!.body).toEqual({
      matchers: [{ type: "all" }],
      actions: [{ type: "drop" }],
      enabled: true,
    })
    expect(result.catch_all.before).toBeNull()
  })

  test("changes the action of a catch-all that is off, leaving it off", async () => {
    const { tool, requests } = catchAllEditFor(catchAllRoute(ok(DISABLED_CATCH_ALL)))

    await invoke(tool, { ...CATCH_BASE, replaces: "disabled", action: { type: "worker", worker: "w" } }, CTX)

    expect(sent(requests, "PUT")[0]!.body).toMatchObject({
      enabled: false,
      actions: [{ type: "worker", value: ["w"] }],
    })
  })
})

describe("cloudflareEmailCatchAllEdit: Email Routing off or unknown", () => {
  test("changes the catch-all and says no mail is routed yet", async () => {
    const { tool, requests } = catchAllEditFor(routingRoute(ok({ enabled: false, status: "unconfigured" })))

    const result = await invoke(tool, { ...CATCH_BASE, enabled: false }, CTX)

    expect(sent(requests, "PUT")).toHaveLength(1)
    expect(result.routing_enabled).toBe(false)
    expect(result.note).toBe(
      `Email Routing is off on ${ZONE_NAME}: no mail is routed until it is turned on in the dashboard, which adds the zone's MX, SPF and DKIM records.`,
    )
  })

  test("reports null when the settings cannot be read", async () => {
    const { tool } = catchAllEditFor(routingRoute(fail(500, [{ code: 1000, message: "Down" }])))

    const result = await invoke(tool, { ...CATCH_BASE, enabled: false }, CTX)

    expect(result.routing_enabled).toBeNull()
    expect(result).not.toHaveProperty("note")
  })
})
