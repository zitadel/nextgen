/**
 * Public surface for the user-schema domain. Every caller outside this
 * module imports from here (not from individual files) so the package
 * boundary stays observable — the same discipline as `lib/flows/`.
 *
 * **Dependency rule.** No upward imports into `commands/`, `sync/`,
 * `platform/`. Depends sideways only on shared `lib/` utilities
 * (`lib/json` for `sortValue`/`stableStringify`) and on `ajv` for
 * JSON-Schema validation. The user-schema body shape is hand-authored
 * here (not generated) because it carries CLI-only `x-*` annotations
 * the platform schema does not model 1:1.
 */
export { defaultUserSchema, listNamedPresets, resolveNamedPreset } from "./default";
export type { UserSchema, NamedPreset } from "./default";
export {
  validateFieldAnnotations,
  KNOWN_FIELD_ANNOTATIONS,
  KNOWN_MFA_VALUES,
  KNOWN_UNIQUE_VALUES,
  KNOWN_VERIFY_VALUES,
} from "./annotations";
export type { AuthMethods } from "./annotations";
export { addFields, addFieldFromJson, parseAddFieldSpec, removeFields } from "./merge";
export type { AddFieldSpec } from "./merge";
export { validateJsonSchema } from "./validate";
