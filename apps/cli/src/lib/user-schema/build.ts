import type { CreateSchemaBody } from "@zitadel-nextgen/api/generated/model";

import { fieldPreset } from "./presets";

/** The `user-schema` branch of the spec's `CreateSchemaBody` discriminator. */
type UserSchemaBody = Extract<CreateSchemaBody, { kind: "user-schema" }>;

/**
 * Canonical `$id` for the default human-user schema the CLI emits. The
 * platform stores schemas keyed by this URI; a stable repo-rooted URL
 * means projects pointing at the same default share one record instead
 * of each minting its own.
 */
export const DEFAULT_USER_SCHEMA_ID =
  "https://raw.githubusercontent.com/zitadel/nextgen/refs/heads/main/api/openapi/endpoints/schemas/human-user.yaml";

/**
 * Canonical `metaSchema` URI for the default human-user schema. The
 * platform's `POST /schemas` requires this field
 * (`api/openapi/endpoints/schemas/user-schema.yaml` → `required:
 * [metaSchema, kind, x-auth-methods, $id]`). It identifies the
 * user-schema meta-schema version this body conforms to and lines up
 * with the server's default `schema.builtin_public_base`.
 */
export const DEFAULT_USER_META_SCHEMA =
  "https://nextgen.com/api/schemas/user-schema.json";

/**
 * Build the default human-user schema for the chosen auth method and
 * fields. Pure: returns a freshly-allocated object in authored key
 * order; callers that persist it canonicalize at the write boundary via
 * `stableStringify`, exactly as flow files do.
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
): UserSchemaBody {
  /*
   * The password credential is a property on the user schema, not a
   * flow concept. The engine resolves credential verification by
   * walking the user schema for `x-credential: "password"`, so the
   * `credential` step's `fields: ["password"]` only works if this
   * property is present here. `passkey` flows use `x-credential:
   * "passkey"` on a non-secret property and need no extra entry.
   */
  const allFields = method === "password" ? [...fields, "password"] : [...fields];

  const properties: Record<string, Record<string, unknown>> = {};
  for (const field of allFields) {
    properties[field] = fieldPreset(field);
  }

  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: DEFAULT_USER_SCHEMA_ID,
    kind: "user-schema",
    metaSchema: DEFAULT_USER_META_SCHEMA,
    type: "object",
    title: "Human User",
    "x-auth-methods": { [method]: { enabled: true, position: 0 } },
    required: [...allFields].sort(),
    properties,
  } as UserSchemaBody;
}
