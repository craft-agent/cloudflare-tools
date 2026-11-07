import { ZONE_ID } from "../cloudflare/client.fixtures"
import { ok, type FakeReply, type FakeRequest, type FakeRoute } from "../cloudflare/testing"
import { ZONE_NAME } from "../zone/fixtures"

export const RECORDS_PATH = `/zones/${ZONE_ID}/dns_records`
export const EXPORT_PATH = `${RECORDS_PATH}/export`
export const BATCH_PATH = `${RECORDS_PATH}/batch`

/** The path of the record `id`. */
export function recordPath(id: string): string {
  return `${RECORDS_PATH}/${id}`
}

/** The single-record endpoint answering with `record`. */
export function recordRoute(record: { id: string }): FakeRoute {
  return { method: "GET", path: recordPath(record.id), reply: ok(record) }
}

/** The batch endpoint answering `reply`, by default with an empty result. */
export function batchRoute(reply: FakeReply | ((request: FakeRequest) => FakeReply) = ok({})): FakeRoute {
  return { method: "POST", path: BATCH_PATH, reply }
}

/** The requests that are batch posts. */
export function batchRequests(requests: FakeRequest[]): FakeRequest[] {
  return requests.filter((request) => request.path === BATCH_PATH)
}

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

/** An A record that is not proxied and has a ttl of 300, so it cannot be proxied without an automatic ttl. */
export const PLAIN_A_RECORD = {
  ...A_RECORD,
  id: "1".repeat(32),
  name: `api.${ZONE_NAME}`,
  content: "192.0.2.7",
  proxied: false,
  ttl: 300,
  comment: null,
}

export const CNAME_RECORD = {
  ...PLAIN_A_RECORD,
  id: "2".repeat(32),
  type: "CNAME",
  name: `blog.${ZONE_NAME}`,
  content: "Hosting.example.net.",
  proxied: false,
  proxiable: true,
  ttl: 1,
}

export const SRV_RECORD = {
  ...CAA_RECORD,
  id: "3".repeat(32),
  type: "SRV",
  name: `_sip._tcp.${ZONE_NAME}`,
  content: "10 5 5060 sip.example.org",
  data: {
    priority: 10,
    weight: 5,
    port: 5060,
    target: "Sip.Example.org.",
    name: `_sip._tcp.${ZONE_NAME}`,
    proto: "_tcp",
    service: "_sip",
  },
}

export const HTTPS_RECORD = { ...A_RECORD, id: "4".repeat(32), type: "HTTPS", content: '1 . alpn="h2"' }

export const WORKER_RECORD = {
  ...A_RECORD,
  id: "5".repeat(32),
  name: `app.${ZONE_NAME}`,
  meta: { read_only: true, origin_worker_id: "worker-id" },
}

export const PRODUCT_RECORD = { ...A_RECORD, id: "6".repeat(32), name: `x.${ZONE_NAME}`, meta: { read_only: true } }

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
