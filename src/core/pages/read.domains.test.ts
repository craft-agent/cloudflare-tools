import { expect, test } from "bun:test"
import { rejection } from "../cloudflare/client.fixtures"
import { ok } from "../cloudflare/testing"
import { invoke } from "../tool"
import { CTX, DOMAIN_ENTRY, DOMAINS_PATH, PAGING, PROJECT, ZONE_ID, errorOf, refusalOf, toolFor } from "./fixtures"
import { domainSchema, shapeDomain } from "./shape"

test("domains sends project and paging query and returns shaped custom domains", async () => {
  const { tool, requests } = toolFor({
    method: "GET",
    path: DOMAINS_PATH,
    reply: ok([DOMAIN_ENTRY], PAGING),
  })
  const result = await invoke(tool, { method: "domains", project: ` ${PROJECT} `, page: 2, per_page: 25 }, CTX)
  expect(result).toEqual({
    label: "default",
    project: PROJECT,
    domains: [shapeDomain(DOMAIN_ENTRY)],
    ...PAGING,
  })
  expect(requests[0].path).toBe(DOMAINS_PATH)
  expect(Object.fromEntries(requests[0].query)).toEqual({ page: "2", per_page: "25" })

  await invoke(tool, { method: "domains", project: PROJECT }, CTX)
  expect(Object.fromEntries(requests[1].query)).toEqual({ per_page: "10" })
})

test("shapes txt and http validation, and handles missing validation and verification as null", () => {
  const txtDomain = shapeDomain({
    name: "txt.example.com",
    status: "pending",
    validation_data: {
      method: "txt",
      status: "pending",
      txt_name: "_cf-custom-hostname.txt.example.com",
      txt_value: "txt-validation-token",
      error_message: "Validation pending",
    },
    verification_data: {
      status: "pending",
      error_message: "Verification pending",
    },
    certificate_authority: "lets_encrypt",
    zone_tag: ZONE_ID,
    created_on: "2024-01-01T00:00:00Z",
  })
  expect(txtDomain.validation).toEqual({
    method: "txt",
    status: "pending",
    txt_name: "_cf-custom-hostname.txt.example.com",
    txt_value: "txt-validation-token",
    error: "Validation pending",
  })
  expect(txtDomain.verification).toEqual({
    status: "pending",
    error: "Verification pending",
  })
  expect(txtDomain.zone_id).toBe(ZONE_ID)

  const httpDomain = shapeDomain({
    name: "http.example.com",
    status: "active",
    validation_data: {
      method: "http",
      status: "active",
      txt_name: null,
      txt_value: null,
      error_message: null,
    },
    verification_data: null,
  })
  expect(httpDomain.validation).toEqual({
    method: "http",
    status: "active",
    txt_name: null,
    txt_value: null,
    error: null,
  })
  expect(httpDomain.verification).toBeNull()

  const minimalDomain = shapeDomain({ name: "minimal.example.com" })
  expect(minimalDomain.validation).toBeNull()
  expect(minimalDomain.verification).toBeNull()
  expect(minimalDomain.certificate_authority).toBeNull()
  expect(minimalDomain.zone_id).toBeNull()
  expect(minimalDomain.created_on).toBeNull()
})

test("never copies id, domain_id or unexpected fields into shaped domains", async () => {
  const rawWithIds = {
    ...DOMAIN_ENTRY,
    id: "do-not-copy-id",
    domain_id: "do-not-copy-domain-id",
    extra_field: "do-not-copy-extra",
  }
  const shaped = shapeDomain(rawWithIds)
  expect("id" in shaped).toBe(false)
  expect("domain_id" in shaped).toBe(false)
  expect("extra_field" in shaped).toBe(false)
  expect(JSON.stringify(shaped)).not.toContain("do-not-copy")
  expect(domainSchema.safeParse(shaped).success).toBe(true)
})

test("requires project on domains", async () => {
  const { tool } = toolFor()
  expect(await refusalOf(invoke(tool, { method: "domains" }, CTX))).toContain('Method "domains" requires `project`.')
})

test("refuses lines on domains", async () => {
  const { tool } = toolFor()
  expect(await refusalOf(invoke(tool, { method: "domains", project: PROJECT, lines: 50 }, CTX))).toContain("lines")
})

test("refuses non-array domains response as upstream_error", async () => {
  for (const result of [null, "bad", {}, { domains: [] }]) {
    const { tool } = toolFor({
      method: "GET",
      path: DOMAINS_PATH,
      reply: ok(result),
    })
    const error = errorOf(await rejection(invoke(tool, { method: "domains", project: PROJECT }, CTX)))
    expect(error.code).toBe("upstream_error")
  }
})
