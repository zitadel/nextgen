import { fieldPreset } from "./presets";
import { DEFAULT_USER_SCHEMA_ID, type UserSchema } from "./schema";

/**
 * Build the default human-user schema for the chosen auth method and
 * fields. Pure: returns a freshly-allocated object in authored key
 * order; callers that persist it canonicalize at the write boundary via
 * `stableStringify`, exactly as flow files do. The single entry point
 * that constructs the resource, paralleling `lib/flows`' `buildFlow` —
 * same `(method, fields)` argument order.
 *
 * The resulting `x-auth-methods` map carries exactly one entry, the
 * method the CLI prompt selected. Each field resolves through
 * {@link fieldPreset}.
 *
 * @param method - The auth method to enable (e.g. `"passkey"`). Becomes
 *   the sole key of `x-auth-methods`.
 * @param fields - Property names to include, in display order.
 */
export function buildUserSchema(
  method: string,
  fields: ReadonlyArray<string>,
): UserSchema {
  const properties: Record<string, Record<string, unknown>> = {};
  for (const field of fields) {
    properties[field] = fieldPreset(field);
  }

  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: DEFAULT_USER_SCHEMA_ID,
    kind: "user-schema",
    type: "object",
    title: "Human User",
    "x-auth-methods": { [method]: { enabled: true, position: 0 } },
    required: [...fields].sort(),
    properties,
  } satisfies UserSchema;
}
