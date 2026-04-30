import { z } from "zod";

export const authMethodSchema = z.object({
  enabled: z.boolean(),
  position: z.number().int().nonnegative(),
});

export const authMethodsSchema = z.record(z.string(), authMethodSchema);

export const KNOWN_FIELD_ANNOTATIONS = [
  "x-identifier",
  "x-verify",
  "x-mfa",
  "x-sensitive",
  "x-editable",
  "x-unique",
  "x-claim",
] as const;

export const KNOWN_VERIFY_VALUES = ["email", "phone"] as const;
export const KNOWN_MFA_VALUES = ["sms", "email", "push", "totp"] as const;
export const KNOWN_UNIQUE_VALUES = ["project", "team"] as const;

export const schemaFieldAnnotationSchema = z.object({
  "x-identifier": z.boolean().optional(),
  "x-verify": z.enum(KNOWN_VERIFY_VALUES).optional(),
  "x-mfa": z.enum(KNOWN_MFA_VALUES).optional(),
  "x-sensitive": z.boolean().optional(),
  "x-editable": z.boolean().optional(),
  "x-unique": z.enum(KNOWN_UNIQUE_VALUES).optional(),
  "x-claim": z.string().optional(),
});

export type AuthMethods = z.infer<typeof authMethodsSchema>;

export type AnnotationWarning = {
  field: string;
  annotation: string;
  message: string;
};

export function validateFieldAnnotations(
  fieldName: string,
  spec: Record<string, unknown>,
): AnnotationWarning[] {
  const warnings: AnnotationWarning[] = [];
  for (const [key, value] of Object.entries(spec)) {
    if (!key.startsWith("x-")) continue;
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

export function isKnownFieldAnnotation(key: string): boolean {
  return (KNOWN_FIELD_ANNOTATIONS as readonly string[]).includes(key);
}
