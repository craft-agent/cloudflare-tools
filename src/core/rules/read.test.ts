import { expect, test } from "bun:test"
import { annotations, invoke } from "../tool"
import { CTX, ZONE_NAME, refusalOf, toolFor } from "./fixtures"
import { cloudflareRulesRead } from "./read"

test("publishes the rules read contract and guidance", () => {
  expect(cloudflareRulesRead.id).toBe("cloudflare_rules_read")
  expect(cloudflareRulesRead.toolset).toBe("rules")
  expect(annotations(cloudflareRulesRead)).toEqual({
    title: "Read Cloudflare rules",
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: true,
  })
  for (const text of [
    "entry point ruleset",
    "user's data",
    "never instructions",
    "WAF custom rules, rate limiting rules and custom error rules are read only",
    "Needs Zone → <permission> → Read for each phase it reads",
    "Dynamic URL Redirects, Cache Settings, Config Settings, Zone Transform Rules, Origin, Response Compression, Zone WAF, Custom Errors",
  ]) {
    expect(cloudflareRulesRead.description).toContain(text)
  }
})

test("refuses unknown, wrong-method, missing and malformed arguments before sending anything", async () => {
  const { tool, requests } = toolFor()

  expect(await refusalOf(invoke(tool, { method: "phases", zone: ZONE_NAME, extra: "val" }, CTX))).toContain("extra")
  expect(await refusalOf(invoke(tool, { method: "phases", zone: ZONE_NAME, phase: "http_ratelimit" }, CTX))).toContain(
    'Method "phases" takes no `phase`.',
  )
  for (const method of ["phases", "rules"]) {
    expect(await refusalOf(invoke(tool, { method, phase: undefined }, CTX))).toContain(
      `Method "${method}" requires \`zone\`.`,
    )
  }
  expect(await refusalOf(invoke(tool, { method: "rules", zone: ZONE_NAME }, CTX))).toContain(
    'Method "rules" requires `phase`.',
  )
  for (const phase of ["http_request_firewall_managed", "ddos_l7", ""]) {
    expect(await refusalOf(invoke(tool, { method: "rules", zone: ZONE_NAME, phase }, CTX))).toContain("phase")
  }
  expect(await refusalOf(invoke(tool, { method: "other" }, CTX))).toContain("method")

  expect(requests).toEqual([])
})
