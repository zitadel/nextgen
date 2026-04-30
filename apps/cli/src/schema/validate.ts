import Ajv2020 from "ajv/dist/2020.js";

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
