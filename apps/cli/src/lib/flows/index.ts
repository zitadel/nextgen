/**
 * Public surface for the flow domain. Every caller outside this module
 * imports from here (not from individual files) so the package
 * boundary stays observable.
 *
 * **Layout mirrors `lib/user-schema/` file-for-file:** `schema.ts` is
 * the shape + vocabulary, `build.ts` is the builder (`buildFlow`,
 * paralleling `buildUserSchema`, same `(method, fields)` signature),
 * `validate.ts` holds validation, and `methods.ts` is the per-method
 * catalog the builder dispatches into — the counterpart of
 * `user-schema`'s `presets.ts`. `methods.ts` is internal; only
 * `build.ts` consumes it.
 *
 * **Dependency rule.** This module has no upward dependencies (it
 * never imports from `commands/`, `sync/`, `api/`, etc.) and no
 * filesystem code. It depends sideways only on shared utilities under
 * `apps/cli/src/lib/` — today `lib/errors` (`ZitadelError`). Reading
 * and writing local files is the caller's responsibility, served by
 * `apps/cli/src/lib/json-dir.ts` plus this module's {@link FLOWS_DIR}
 * constant and {@link validateFlows} parser. The peer `lib/sync/`
 * orchestration module consumes {@link FLOWS_DIR} the same way.
 * Future domain modules (`lib/user-schema/`, ...) follow the same
 * rule: sideways onto `lib/<utility>/` is fine; upward into app code
 * is not.
 */
export type { AuthMethod, FlowDefinition } from "./schema";
export { flowDefinitionSchema } from "./schema";
export { AUTH_METHODS, buildFlow, isAuthMethod } from "./build";
export { validateFlows } from "./validate";

/**
 * Relative directory (from the project root) where local flow files
 * live. Owned here so callers (`commands/*`, `sync/syncers.ts`) and
 * tests share a single source of truth for the path; the runtime
 * never depends on it directly because `lib/flows` does not touch
 * the filesystem.
 */
export const FLOWS_DIR = ".zitadel/flows";
