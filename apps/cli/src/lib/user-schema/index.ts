/**
 * Public surface for the user-schema domain. Every caller outside this
 * module imports from here (not from individual files), the same
 * discipline as `lib/flows/`.
 *
 * **Layout mirrors `lib/flows/` file-for-file:** `schema.ts` is the
 * shape + vocabulary, `build.ts` is the builder (`buildUserSchema`,
 * paralleling `buildFlow`, same `(method, fields)` signature),
 * `validate.ts` holds validation, and `presets.ts` is the per-field
 * catalog the builder dispatches into — the counterpart of `flows`'
 * `methods.ts`. `presets.ts` is internal; only `build.ts` consumes it.
 *
 * **Dependency rule.** This module has no upward dependencies (it never
 * imports from `commands/`, `sync/`, `platform/`, etc.) and no
 * filesystem code. Its only external dependency is `ajv` for
 * JSON-Schema validation. Reading and writing local files is the
 * caller's responsibility, served by `apps/cli/src/lib/json-dir.ts` plus
 * this module's {@link SCHEMAS_DIR} constant. The peer `lib/sync/`
 * orchestration module consumes {@link SCHEMAS_DIR} the same way it
 * consumes `lib/flows`' `FLOWS_DIR`.
 */
export type { UserSchema } from "./schema";
export {
  KNOWN_FIELD_ANNOTATIONS,
  KNOWN_MFA_VALUES,
  KNOWN_UNIQUE_VALUES,
  KNOWN_VERIFY_VALUES,
} from "./schema";
export { buildUserSchema } from "./build";
export { validateJsonSchema } from "./validate";

/**
 * Relative directory (from the project root) where local user-schema
 * files live. Owned here so callers (`commands/*`, `sync/syncers.ts`)
 * and tests share a single source of truth for the path; the runtime
 * never depends on it directly because `lib/user-schema` does not touch
 * the filesystem. The counterpart of `lib/flows`' `FLOWS_DIR`.
 */
export const SCHEMAS_DIR = ".zitadel/schemas";
