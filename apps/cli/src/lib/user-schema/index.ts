/**
 * Public surface for the user-schema domain. Every caller outside this
 * module imports from here (not from individual files), the same
 * discipline as `lib/flows/`.
 *
 * **Layout mirrors `lib/flows/`:** `schema.ts` is the shape + vocabulary,
 * `build.ts` is the builder (`buildUserSchema`, paralleling `buildFlow`),
 * `validate.ts` holds validation. Two files have no flows counterpart
 * because they back features flows don't have: `presets.ts` (the
 * `zitadel schema add --preset` catalog) and `merge.ts` (incremental
 * field add/remove for `zitadel schema add`).
 *
 * **Dependency rule.** No upward imports into `commands/`, `sync/`,
 * `platform/`. Depends sideways only on `lib/json` (`sortValue`) and on
 * `ajv` for JSON-Schema validation.
 */
export type { UserSchema, AuthMethods } from "./schema";
export {
  DEFAULT_USER_SCHEMA_ID,
  KNOWN_FIELD_ANNOTATIONS,
  KNOWN_MFA_VALUES,
  KNOWN_UNIQUE_VALUES,
  KNOWN_VERIFY_VALUES,
} from "./schema";
export { buildUserSchema } from "./build";
export { listNamedPresets, resolveNamedPreset } from "./presets";
export type { NamedPreset } from "./presets";
export { addFields, addFieldFromJson, parseAddFieldSpec, removeFields } from "./merge";
export type { AddFieldSpec } from "./merge";
export { validateFieldAnnotations, validateJsonSchema } from "./validate";
export type { AnnotationWarning } from "./validate";
