import Ajv2020 from "ajv/dist/2020.js";

/**
 * Validate that a value is a structurally-valid JSON Schema (draft
 * 2020-12). Returns the error list rather than throwing so callers can
 * surface every problem at once.
 */
export function validateJsonSchema(
  schema: unknown,
): { valid: true } | { valid: false; errors: string[] } {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  const valid = ajv.validateSchema(schema as Parameters<typeof ajv.validateSchema>[0]);
  if (valid) {
    return { valid: true };
  }

  return {
    valid: false,
    errors: (ajv.errors ?? []).map(
      (error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`,
    ),
  };
}

/** The allowed values of the `kind` discriminator on a `.zitadel/schemas/*.json` file. */
const SCHEMA_KINDS = ["user-schema", "schema-url"] as const;

/**
 * Validate a `.zitadel/schemas/*.json` body for upload to the platform: it must
 * be a structurally-valid JSON Schema AND carry the `kind` discriminator
 * (`user-schema` or `schema-url`) required by the OpenAPI `POST /schemas`
 * contract. Without `kind`, the platform returns `400 invalid_schema`; this
 * helper lets the sync engine and `doctor` reject the file locally instead.
 */
export function validateUserSchema(
  schema: unknown,
): { valid: true } | { valid: false; errors: string[] } {
  const base = validateJsonSchema(schema);
  if (!base.valid) {
    return base;
  }
  const kind =
    schema !== null && typeof schema === "object" && "kind" in schema
      ? (schema as { kind?: unknown }).kind
      : undefined;
  if (typeof kind !== "string" || !(SCHEMA_KINDS as ReadonlyArray<string>).includes(kind)) {
    return {
      valid: false,
      errors: [
        `schema body must include kind: ${SCHEMA_KINDS.map((k) => `"${k}"`).join(" or ")} (got ${JSON.stringify(kind)})`,
      ],
    };
  }
  return { valid: true };
}
