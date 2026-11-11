import { expect, test } from "bun:test"
import { ok } from "../cloudflare/testing"
import { invoke } from "../tool"
import { CTX, POLICIES_PATH, POLICY, SHAPED_POLICY, toolFor } from "./fixtures"
import { shapeRules } from "./shape.rule"

async function policiesOf(raw: unknown) {
  const { tool } = toolFor({ method: "GET", path: POLICIES_PATH, reply: ok([raw]) })
  return (await invoke(tool, { method: "policies" }, CTX)).policies
}

test("policy keeps the fields and the rules as configured, email addresses included", async () => {
  const include = [
    { email: { email: "owner@example.com" } },
    { email_domain: { domain: "example.com" } },
    { ip: { ip: "192.0.2.0/24" } },
    { group: { id: "group-1" } },
    { service_token: { token_id: "token-id-1" } },
    { any_valid_service_token: {} },
    { everyone: {} },
  ]
  const policies = await policiesOf({
    ...POLICY,
    decision: "allow",
    precedence: 2,
    reusable: true,
    session_duration: "12h",
    approval_required: true,
    purpose_justification_required: false,
    isolation_required: false,
    app_count: 3,
    include,
    exclude: [{ geo: { country_code: "XX" } }],
    require: [{ login_method: { id: "idp-1" } }],
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-02-01T00:00:00Z",
    approval_groups: [{ email_addresses: ["approver@example.com"] }],
  })
  expect(policies).toEqual([
    {
      ...SHAPED_POLICY,
      decision: "allow",
      precedence: 2,
      reusable: true,
      session_duration: "12h",
      approval_required: true,
      purpose_justification_required: false,
      isolation_required: false,
      app_count: 3,
      include,
      exclude: [{ geo: { country_code: "XX" } }],
      require: [{ login_method: { id: "idp-1" } }],
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-02-01T00:00:00Z",
    },
  ])
  expect(JSON.stringify(policies)).not.toContain("approver@example.com")
})

test("policy rules drop secret-bearing keys at any depth but keep token ids", async () => {
  const policies = await policiesOf({
    ...POLICY,
    include: [
      {
        service_token: { token_id: "token-id-1", client_secret: "cs-made-up" },
        external_evaluation: {
          evaluate_url: "https://eval.example.net",
          nested: { deeper: [{ Password: "pw-made-up", token: "tk-made-up", api_key: "ak-made-up", keep: "yes" }] },
          private_key: "pk-made-up",
          bearer_header: "bh-made-up",
          passphrase: "pp-made-up",
          token_id: "token-id-2",
        },
      },
    ],
  })
  expect(policies?.[0].include).toEqual([
    {
      service_token: { token_id: "token-id-1" },
      external_evaluation: {
        evaluate_url: "https://eval.example.net",
        nested: { deeper: [{ keep: "yes" }] },
        token_id: "token-id-2",
      },
    },
  ])
  expect(JSON.stringify(policies)).not.toMatch(/made-up/)
})

test("policy rules drop non-object entries and treat missing or wrong lists as empty", async () => {
  const [bad] = (await policiesOf({
    ...POLICY,
    include: [null, "x", 1, [{ a: 1 }], { ok: true }],
    exclude: {},
    require: "x",
  }))!
  expect(bad.include).toEqual([{ ok: true }])
  expect(bad.exclude).toEqual([])
  expect(bad.require).toEqual([])
})

test("wrong policy field types become null", async () => {
  expect(
    await policiesOf({
      ...POLICY,
      name: 1,
      decision: true,
      precedence: "1",
      reusable: "yes",
      session_duration: 12,
      approval_required: 1,
      purpose_justification_required: "no",
      isolation_required: [],
      app_count: "3",
      created_at: 1,
      updated_at: {},
    }),
  ).toEqual([{ ...SHAPED_POLICY, name: null }])
})

test("shapeRules keeps scalars and copies containers", () => {
  const source = { a: { b: [1, "two", true, null, { c: false }] } }
  const [rule] = shapeRules([source])
  expect(rule).toEqual(source)
  expect(rule).not.toBe(source)
  expect(rule.a).not.toBe(source.a)
})

test("shapeRules drops containers deeper than six levels", () => {
  const deep = { l2: { l3: { l4: { l5: { l6: { keep: "x", l7: { leaf: "y" }, list: [[1]] } } } } } }
  expect(shapeRules([deep])).toEqual([{ l2: { l3: { l4: { l5: { l6: { keep: "x" } } } } } }])
  const shallow = { l2: { l3: { l4: { l5: { l6: { keep: "x" } } } } } }
  expect(shapeRules([shallow])).toEqual([shallow])
})

test("shapeRules drops values that are not plain data", () => {
  const rule = { when: new Date(0), fn: () => 1, undef: undefined, big: 10n, list: [undefined, new Map(), "ok"], ok: 1 }
  expect(shapeRules([rule])).toEqual([{ list: ["ok"], ok: 1 }])
})
