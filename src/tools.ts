import { cloudflareAccountRead } from "./core/account/read"
import { cloudflareDnsRecordAdd } from "./core/dns/add"
import { cloudflareDnsRecordDelete } from "./core/dns/delete"
import { cloudflareDnsRecordEdit } from "./core/dns/edit"
import { cloudflareDnsRead } from "./core/dns/read"
import { cloudflarePagesRead } from "./core/pages/read"
import { cloudflarePagesRollback } from "./core/pages/rollback"
import { cloudflareWorkersRead } from "./core/workers/read"
import { cloudflareWorkersRollback } from "./core/workers/rollback"
import { cloudflareZoneCachePurge } from "./core/zone/cache-purge"
import { cloudflareZoneCachePurgeAll } from "./core/zone/cache-purge-all"
import { cloudflareZoneDnssecDisable, cloudflareZoneDnssecEnable } from "./core/zone/dnssec"
import { cloudflareZoneRead } from "./core/zone/read"
import { cloudflareZoneSettingEdit, cloudflareZoneSettingWeaken } from "./core/zone/setting-edit"
import type { ToolSpec } from "./core"

/** Every tool spec of the package; entry points register their tools from this list. */
export const ALL_TOOLS: ToolSpec[] = [
  cloudflareAccountRead,
  cloudflareZoneRead,
  cloudflareZoneSettingEdit,
  cloudflareZoneSettingWeaken,
  cloudflareZoneCachePurge,
  cloudflareZoneCachePurgeAll,
  cloudflareZoneDnssecEnable,
  cloudflareZoneDnssecDisable,
  cloudflareDnsRead,
  cloudflareDnsRecordAdd,
  cloudflareDnsRecordEdit,
  cloudflareDnsRecordDelete,
  cloudflareWorkersRead,
  cloudflareWorkersRollback,
  cloudflarePagesRead,
  cloudflarePagesRollback,
]
