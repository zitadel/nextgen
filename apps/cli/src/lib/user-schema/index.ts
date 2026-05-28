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
 * **Dependency rule.** No upward imports into `commands/`, `sync/`,
 * `platform/`. Depends sideways only on `lib/json` (`sortValue`) and on
 * `ajv` for JSON-Schema validation.
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
