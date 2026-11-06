import { cloudflareAccountRead } from "./core/account/read"
import { cloudflareZoneCachePurge } from "./core/zone/cache-purge"
import { cloudflareZoneCachePurgeAll } from "./core/zone/cache-purge-all"
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
]
