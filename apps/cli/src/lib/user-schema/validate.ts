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
