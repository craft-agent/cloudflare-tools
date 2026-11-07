import { ZONE_ID } from "../cloudflare/client.fixtures"
import { ZONE_NAME } from "../zone/fixtures"

export const RECORDS_PATH = `/zones/${ZONE_ID}/dns_records`
export const EXPORT_PATH = `${RECORDS_PATH}/export`

export const A_RECORD_ID = "a".repeat(32)
export const MX_RECORD_ID = "b".repeat(32)
export const CAA_RECORD_ID = "c".repeat(32)
export const TXT_RECORD_ID = "d".repeat(32)

export const A_RECORD = {
  id: A_RECORD_ID,
  type: "A",
  name: `www.${ZONE_NAME}`,
  content: "192.0.2.1",
  proxied: true,
  proxiable: true,
  ttl: 1,
  comment: "web front",
  tags: ["env:prod"],
  created_on: "2024-01-01T00:00:00Z",
  modified_on: "2024-02-01T00:00:00Z",
}

export const MX_RECORD = {
  id: MX_RECORD_ID,
  type: "MX",
  name: ZONE_NAME,
  content: `mail.${ZONE_NAME}`,
  priority: 10,
  proxied: false,
  proxiable: false,
  ttl: 3600,
  comment: null,
  tags: [],
  modified_on: "2024-02-02T00:00:00Z",
}

export const CAA_RECORD = {
  id: CAA_RECORD_ID,
  type: "CAA",
  name: ZONE_NAME,
  content: '0 issue "letsencrypt.org"',
  data: { flags: 0, tag: "issue", value: "letsencrypt.org" },
  proxied: false,
  proxiable: false,
  ttl: 300,
  comment: null,
  tags: [],
  modified_on: null,
}

export const TXT_RECORD = {
  id: TXT_RECORD_ID,
  type: "TXT",
  name: `_dmarc.${ZONE_NAME}`,
  content: '"v=DMARC1; p=none"',
  proxied: false,
  proxiable: false,
  ttl: 1,
  comment: null,
  tags: [],
  modified_on: "2024-02-03T00:00:00Z",
}

/** `A_RECORD` as the tool shapes it: the same fields without those the list leaves out. */
export const SHAPED_A_RECORD = {
  id: A_RECORD_ID,
  type: "A",
  name: `www.${ZONE_NAME}`,
  content: "192.0.2.1",
  proxied: true,
  proxiable: true,
  ttl: 1,
  comment: "web front",
  tags: ["env:prod"],
  read_only: false,
  modified_on: "2024-02-01T00:00:00Z",
}

export const ZONE_FILE = [
  `; ${ZONE_NAME} zone file`,
  `$ORIGIN ${ZONE_NAME}.`,
  "",
  `${ZONE_NAME}\t3600\tIN\tSOA\tns1.example.net. dns.example.net. 1 10000 2400 604800 3600`,
  `${ZONE_NAME}.\t86400\tIN\tNS\tns1.example.net.`,
  `sub.${ZONE_NAME}.\t3600\tIN\tNS\tns.elsewhere.example.`,
  `www.${ZONE_NAME}.\t1\tIN\tA\t192.0.2.1`,
  `${ZONE_NAME}.\t3600\tIN\tMX\t10 mail.${ZONE_NAME}.`,
  `  ; indented comment`,
  `_dmarc.${ZONE_NAME}.\t1\tIN\tTXT\t"v=DMARC1; p=none"`,
  "",
].join("\n")
