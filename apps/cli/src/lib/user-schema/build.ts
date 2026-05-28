import { sortValue } from "../json";
import { fieldPreset } from "./presets";
import { type AuthMethods, DEFAULT_USER_SCHEMA_ID, type UserSchema } from "./schema";

/**
 * Build the default human-user schema for the given fields and auth
 * methods. Pure: returns a freshly-allocated, key-sorted object.
 * Mirrors `lib/flows`' `buildFlow` — the single entry point that
 * constructs the resource.
 *
 * @param opts.fields - Property names to include (defaults to
 *   email/given_name/family_name). Each resolves through
 *   {@link fieldPreset}.
 * @param opts.authMethods - A single method name, a list, or an
 *   already-built `x-auth-methods` map. Normalized internally.
 */
export function buildUserSchema(
  opts: {
    fields?: string[];
    authMethods?: string | string[] | AuthMethods;
  } = {},
): UserSchema {
  const fields = opts.fields?.length ? opts.fields : ["email", "given_name", "family_name"];
  const authMethods = normalizeAuthMethods(opts.authMethods);
  const properties: Record<string, Record<string, unknown>> = {};

  for (const field of fields) {
    properties[field] = fieldPreset(field);
  }

  return sortValue({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: DEFAULT_USER_SCHEMA_ID,
    kind: "user-schema",
    type: "object",
    title: "Human User",
    "x-auth-methods": authMethods,
    required: [...fields].sort(),
    properties,
  }) as UserSchema;
}

/**
 * Coerce the caller's auth-method input into a validated
 * `x-auth-methods` map. Accepts a single method name, an array of
 * names (positions assigned by order), or an already-built map (passed
 * through). Trims input and rejects blanks; empty array falls back to
 * `passkey`.
 */
function normalizeAuthMethods(methods?: string | string[] | AuthMethods): AuthMethods {
  if (typeof methods === "string") {
    const trimmed = methods.trim();
    if (!trimmed) {
      throw new Error("auth method must not be blank");
    }
    return { [trimmed]: { enabled: true, position: 0 } };
  }
  if (methods && !Array.isArray(methods)) {
    return methods;
  }

  const sanitized = methods?.map((method) => method.trim()).filter((method) => method.length > 0);
  const selected = sanitized?.length ? sanitized : ["passkey"];
  const out: AuthMethods = {};
  selected.forEach((method, index) => {
    out[method] = { enabled: true, position: index };
  });
  return out;
}
