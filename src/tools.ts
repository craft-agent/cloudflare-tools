import { cloudflareAccountRead } from "./core/account/read"
import { cloudflareZoneRead } from "./core/zone/read"
import type { ToolSpec } from "./core"

/** Every tool spec of the package; entry points register their tools from this list. */
export const ALL_TOOLS: ToolSpec[] = [cloudflareAccountRead, cloudflareZoneRead]
