import { expect, test } from "bun:test"
import { PHASE_PATTERN } from "../cloudflare/routes"
import { PHASES, PHASE_NAMES, WRITABLE_PHASE_NAMES, editHint, phaseInfo, readHint } from "./phases"

test("the phase names are exactly the ones the path check accepts", () => {
  expect(PHASE_NAMES).toHaveLength(11)
  expect(new Set(PHASE_NAMES).size).toBe(11)
  for (const name of PHASE_NAMES) expect(PHASE_PATTERN.test(name)).toBe(true)
  for (const other of ["http_request_firewall_managed", "ddos_l7", "http_request_transform_x", ""]) {
    expect(PHASE_PATTERN.test(other)).toBe(false)
  }
})

test("a phase that is read only has no actions, a writable one has", () => {
  for (const entry of PHASES) expect(entry.actions.length > 0).toBe(entry.writable)
  expect(PHASES.filter((entry) => !entry.writable).map((entry) => entry.phase)).toEqual([
    "http_request_firewall_custom",
    "http_ratelimit",
    "http_custom_errors",
  ])
})

test("the writable phase names are the writable rows, in table order", () => {
  expect([...WRITABLE_PHASE_NAMES]).toEqual(PHASES.filter((entry) => entry.writable).map((entry) => entry.phase))
  expect(WRITABLE_PHASE_NAMES).toHaveLength(8)
  for (const name of WRITABLE_PHASE_NAMES) expect(PHASE_NAMES).toContain(name)
  expect(WRITABLE_PHASE_NAMES).not.toContain("http_ratelimit")
})

test("the hints name the phase's permission group", () => {
  expect(phaseInfo("http_request_origin").product).toBe("Origin Rules")
  expect(readHint("http_ratelimit")).toBe("The token needs Zone → Zone WAF → Read.")
  expect(editHint("http_request_dynamic_redirect")).toBe("The token needs Zone → Dynamic URL Redirects → Edit.")
})
