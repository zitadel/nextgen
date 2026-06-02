/**
 * Public surface for the flow domain. Every caller outside this module
 * imports from here (not from individual files) so the package
 * boundary stays observable.
 *
 * **Source of truth.** The wire shape lives in
 * `@zitadel/api-client/generated/model` (orval-generated from the
 * OpenAPI spec). Callers that need the type import
 * `CreateFlowDefinitionBodyFlowDefinition` from there directly;
 * callers that need the runtime validator import
 * `CreateFlowDefinitionBody` from
 * `@zitadel/api-client/generated/endpoints/zitadelNextGen.zod`. This
 * module owns only the CLI-specific concerns: the password-flow
 * builder, env-var reference scanning, and the file-level
 * `validateFlows` helper that surfaces `E_VALIDATION` errors against
 * the generated Zod.
 *
 * **Dependency rule.** No upward imports (`commands/`, `sync/`, etc.)
 * and no filesystem I/O. It depends sideways only on shared utilities
 * under `apps/cli/src/lib/` — today `lib/errors` (`ZitadelError`).
 */
export { buildFlow } from "./build";
export { validateFlows } from "./validate";
export { flowEnvRefs } from "./env-refs";

/**
 * Relative directory (from the project root) where local flow files
 * live. Owned here so callers (`commands/*`, `sync/syncers.ts`) and
 * tests share a single source of truth for the path; the runtime
 * never depends on it directly because `lib/flows` does not touch
 * the filesystem.
 */
export const FLOWS_DIR = ".zitadel/flows";
