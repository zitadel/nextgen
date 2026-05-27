/**
 * Public surface for the flow domain. Every caller outside this module
 * imports from here (not from individual files) so the package boundary
 * stays observable. Internal helpers in `fields.ts`, `method.ts`, and
 * the per-method builders are intentionally not re-exported.
 *
 * **Dependency rule.** This module has no upward dependencies (it never
 * imports from `commands/`, `sync/`, `platform/`, etc.). It is permitted
 * to depend sideways on shared utilities under `apps/cli/src/lib/`
 * — today `lib/errors` (`ZitadelError`) and `lib/json` (`stableStringify`).
 * Future domain modules (`lib/user-schema/`, ...) follow the same rule:
 * sideways onto `lib/<utility>/` is fine; upward into app code is not.
 */
export type { FlowDefinition } from "./schema";
export { flowDefinitionSchema } from "./schema";
export type { AuthMethod } from "./types";
export type { FlowFragment } from "./method";
export { collectTextKeys } from "./text-keys";
export { AUTH_METHODS, buildFlowAndLocale } from "./registry";
export { FLOWS_DIR, readLocalFlows, validateFlows, writeLocalFlow } from "./io";
