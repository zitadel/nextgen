import { z } from "zod";

/**
 * One entry in a user schema's `x-auth-methods` map: whether the method
 * is enabled and its display order.
 */
const authMethodSchema = z.object({
  enabled: z.boolean(),
  position: z.number().int().nonnegative(),
});

/** The `x-auth-methods` map — method name → {@link authMethodSchema}. */
const authMethodsSchema = z.record(z.string(), authMethodSchema);

/** Parsed `x-auth-methods` value. */
export type AuthMethods = z.infer<typeof authMethodsSchema>;

/**
 * Canonical `$id` for the default human-user schema the CLI emits. The
 * platform stores schemas keyed by this URI; a stable repo-rooted URL
 * means projects pointing at the same default share one record instead
 * of each minting its own.
 */
export const DEFAULT_USER_SCHEMA_ID =
  "https://raw.githubusercontent.com/zitadel/nextgen/refs/heads/main/api/openapi/endpoints/schemas/human-user.yaml";

/**
 * On-disk shape per `api/openapi/endpoints/schemas/user-schema.yaml`.
 * Required keys: `$schema, $id, kind, title, x-auth-methods`. `kind` is
 * the discriminator the platform reads (`POST /schemas` is
 * `oneOf [user-schema, schema-url]` keyed on `kind`).
 */
export type UserSchema = {
  $schema: string;
  $id: string;
  kind: "user-schema";
  type: "object";
  title: string;
  "x-auth-methods": AuthMethods;
  required: string[];
  properties: Record<string, Record<string, unknown>>;
};
