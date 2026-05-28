import Ajv2020 from "ajv/dist/2020.js";

import {
  KNOWN_FIELD_ANNOTATIONS,
  KNOWN_MFA_VALUES,
  KNOWN_UNIQUE_VALUES,
  KNOWN_VERIFY_VALUES,
} from "./schema";

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

/**
 * One non-fatal annotation problem found on a user-schema property:
 * an unknown `x-*` key, or a known key with an out-of-vocabulary value.
 */
export type AnnotationWarning = {
  field: string;
  annotation: string;
  message: string;
};

/**
 * Check a property's `x-*` annotations against the known vocabulary
 * (see `schema.ts`). Returns warnings (never throws) so `schema add`
 * can surface typos without blocking. Validates `x-verify`, `x-mfa`,
 * and `x-unique` values against their allowed sets.
 */
export function validateFieldAnnotations(
  fieldName: string,
  spec: Record<string, unknown>,
): AnnotationWarning[] {
  const warnings: AnnotationWarning[] = [];
  for (const [key, value] of Object.entries(spec)) {
    if (!key.startsWith("x-")) {
      continue;
    }
    if (!(KNOWN_FIELD_ANNOTATIONS as readonly string[]).includes(key)) {
      warnings.push({
        field: fieldName,
        annotation: key,
        message: `Unknown annotation "${key}". Known: ${KNOWN_FIELD_ANNOTATIONS.join(", ")}`,
      });
      continue;
    }
    if (
      key === "x-verify" &&
      typeof value === "string" &&
      !(KNOWN_VERIFY_VALUES as readonly string[]).includes(value)
    ) {
      warnings.push({
        field: fieldName,
        annotation: key,
        message: `Unknown "${key}" value "${value}". Known: ${KNOWN_VERIFY_VALUES.join(", ")}`,
      });
    }
    if (
      key === "x-mfa" &&
      typeof value === "string" &&
      !(KNOWN_MFA_VALUES as readonly string[]).includes(value)
    ) {
      warnings.push({
        field: fieldName,
        annotation: key,
        message: `Unknown "${key}" value "${value}". Known: ${KNOWN_MFA_VALUES.join(", ")}`,
      });
    }
    if (
      key === "x-unique" &&
      typeof value === "string" &&
      !(KNOWN_UNIQUE_VALUES as readonly string[]).includes(value)
    ) {
      warnings.push({
        field: fieldName,
        annotation: key,
        message: `Unknown "${key}" value "${value}". Known: ${KNOWN_UNIQUE_VALUES.join(", ")}`,
      });
    }
  }
  return warnings;
}
