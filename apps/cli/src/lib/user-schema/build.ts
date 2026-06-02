import type { CreateSchemaBody } from "@zitadel/api-client/generated/model";

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
 * Build the default human-user schema. The CLI scaffolds a single
 * password-only schema today: `x-auth-methods.password` is enabled, the
 * `password` property carries `x-credential: "password"` so the flow
 * engine knows how to verify it, and the caller-supplied fields are
 * collected on the register-profile step.
 *
 * Pure: returns a freshly-allocated object in authored key order;
 * callers that persist it canonicalize at the write boundary via
 * `stableStringify`, exactly as flow files do.
 *
 * @param fields - Property names to include, in display order. The
 *   `password` property is appended automatically.
 */
export function buildUserSchema(fields: ReadonlyArray<string>): UserSchemaBody {
  const allFields = [...fields, "password"];

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
    "x-auth-methods": { password: { enabled: true, position: 0 } },
    required: [...allFields].sort(),
    properties,
  } as UserSchemaBody;
}
