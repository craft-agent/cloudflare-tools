import { describe, expect, test } from "bun:test"
import { MASK, maskCredentials } from "./mask"

const KNOWN_SECRET_A = "super_secret_token_alpha"
const KNOWN_SECRET_B = "super_secret_token_alpha_longer"
const COMMIT_HASH_40_HEX = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"
const ACCOUNT_ID_32_HEX = "0123456789abcdef0123456789abcdef"

describe("maskCredentials", () => {
  test("masks known values literally and longest first without regex injection", () => {
    const known = [KNOWN_SECRET_A, KNOWN_SECRET_B, "secret.with[special]+chars?"]
    const text = `Tokens: ${KNOWN_SECRET_B} and ${KNOWN_SECRET_A} and secret.with[special]+chars?`
    const masked = maskCredentials(text, known)
    expect(masked).toBe(`Tokens: ${MASK} and ${MASK} and ${MASK}`)
  })

  test("masks prefixed token shapes", () => {
    const userToken = "cfut_" + "x".repeat(40)
    const accountToken = "cfat_" + "y".repeat(40)
    const keyToken = "cfk_" + "z".repeat(30)
    const oauthToken = "cfoat_" + "w".repeat(30)

    const text = `Got tokens: ${userToken}, ${accountToken}, ${keyToken}, and ${oauthToken}.`
    const masked = maskCredentials(text)
    expect(masked).toBe(`Got tokens: ${MASK}, ${MASK}, ${MASK}, and ${MASK}.`)
  })

  test("masks Bearer auth values while keeping Bearer prefix", () => {
    const text = "Authorization: Bearer someSecretToken12345; Bearer anotherSecret,"
    const masked = maskCredentials(text)
    expect(masked).toBe(`Authorization: Bearer ${MASK}; Bearer ${MASK},`)
  })

  test("masks X-Auth-Key header values in text and JSON shapes", () => {
    const plainHeader = "X-Auth-Key: secretKey999\r\nx-auth-key: anotherKey888"
    const jsonHeader = '{"X-Auth-Key":"jsonKey777","x-auth-key":"jsonKey666"}'

    expect(maskCredentials(plainHeader)).toBe(`X-Auth-Key: ${MASK}\r\nx-auth-key: ${MASK}`)
    expect(maskCredentials(jsonHeader)).toBe(`{"X-Auth-Key":"${MASK}","x-auth-key":"${MASK}"}`)
  })

  test("leaves bare 40-hex commit hash and 32-hex account id alone unless in known", () => {
    const text = `commit ${COMMIT_HASH_40_HEX} for account ${ACCOUNT_ID_32_HEX}`
    expect(maskCredentials(text)).toBe(text)

    expect(maskCredentials(text, [ACCOUNT_ID_32_HEX])).toBe(`commit ${COMMIT_HASH_40_HEX} for account ${MASK}`)
  })
})
