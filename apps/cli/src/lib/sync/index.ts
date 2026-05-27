/**
 * Public surface for the resource sync engine. Every caller outside
 * this module imports from here; deep imports into individual files
 * are reserved for the module's own tests.
 *
 * **Dependency rule.** Unlike `lib/flows/` which is a pure data
 * domain, this module is the orchestration layer that talks to the
 * Zitadel API. It depends sideways on shared utilities under
 * `apps/cli/src/lib/` (today `lib/flows` for the `FLOWS_DIR` path
 * constant) and on `apps/cli/src/platform/` for the typed HTTP
 * client. The platform dependency is intentional and documented:
 * the sync engine cannot do its job without it. It does NOT import
 * domain shapes (e.g. `FlowDefinition`) — payloads are opaque
 * `object` until they reach the platform client.
 */
export type { ResourceSyncer } from "./syncers";
export { makeSyncers } from "./syncers";
export type { SyncAction } from "./loop";
export { buildSyncPlan, runSyncLoop } from "./loop";
export { renderPlan } from "./plan-renderer";
