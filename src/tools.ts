import { cloudflareAccountRead } from "./core/account/read"
import { cloudflareAnalyticsRead } from "./core/analytics/read"
import { cloudflareDnsRecordAdd } from "./core/dns/add"
import { cloudflareDnsRecordDelete } from "./core/dns/delete"
import { cloudflareDnsRecordEdit } from "./core/dns/edit"
import { cloudflareDnsRead } from "./core/dns/read"
import { cloudflareEmailAddressAdd } from "./core/email/address-add"
import { cloudflareEmailAddressDelete } from "./core/email/address-delete"
import { cloudflareEmailCatchAllEdit } from "./core/email/catchall-edit"
import { cloudflareEmailRead } from "./core/email/read"
import { cloudflareEmailRuleAdd } from "./core/email/rule-add"
import { cloudflareEmailRuleDelete } from "./core/email/rule-delete"
import { cloudflareEmailRuleEdit } from "./core/email/rule-edit"
import { cloudflarePagesDomainAdd } from "./core/pages/domain-add"
import { cloudflarePagesDomainRemove } from "./core/pages/domain-remove"
import { cloudflarePagesRead } from "./core/pages/read"
import { cloudflarePagesRollback } from "./core/pages/rollback"
import { cloudflareRulesAdd } from "./core/rules/add"
import { cloudflareRulesDelete } from "./core/rules/delete"
import { cloudflareRulesEdit } from "./core/rules/edit"
import { cloudflareRulesRead } from "./core/rules/read"
import { cloudflareStorageCreate } from "./core/storage/create"
import { cloudflareStorageDelete } from "./core/storage/delete"
import { cloudflareStorageRead } from "./core/storage/read"
import { cloudflareTunnelRead } from "./core/tunnel/read"
import { cloudflareTunnelRouteAdd } from "./core/tunnel/route-add"
import { cloudflareTunnelRouteEdit } from "./core/tunnel/route-edit"
import { cloudflareTunnelRouteRemove } from "./core/tunnel/route-remove"
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
  cloudflareRulesRead,
  cloudflareRulesAdd,
  cloudflareRulesEdit,
  cloudflareRulesDelete,
  cloudflareAnalyticsRead,
  cloudflareWorkersRead,
  cloudflareWorkersRollback,
  cloudflarePagesRead,
  cloudflarePagesRollback,
  cloudflarePagesDomainAdd,
  cloudflarePagesDomainRemove,
  cloudflareStorageRead,
  cloudflareStorageCreate,
  cloudflareStorageDelete,
  cloudflareTunnelRead,
  cloudflareTunnelRouteAdd,
  cloudflareTunnelRouteEdit,
  cloudflareTunnelRouteRemove,
  cloudflareEmailRead,
  cloudflareEmailRuleAdd,
  cloudflareEmailRuleEdit,
  cloudflareEmailRuleDelete,
  cloudflareEmailCatchAllEdit,
  cloudflareEmailAddressAdd,
  cloudflareEmailAddressDelete,
]
