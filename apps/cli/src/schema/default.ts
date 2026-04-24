import { sortValue } from "../lib/json";
import type { AuthMethods } from "./annotations";

export type UserSchema = {
  $schema: string;
  type: "object";
  title: string;
  "x-auth-methods": AuthMethods;
  required: string[];
  properties: Record<string, Record<string, unknown>>;
};

const FIELD_PRESETS: Record<string, Record<string, unknown>> = {
  email: {
    type: "string",
    format: "email",
    title: "Email address",
    "x-identifier": true,
    "x-verify": "email",
    "x-unique": "project",
    "x-claim": "claims.email",
    "x-editable": true,
  },
  given_name: {
    type: "string",
    title: "First name",
    minLength: 1,
    maxLength: 200,
    "x-claim": "claims.given_name",
    "x-editable": true,
  },
  family_name: {
    type: "string",
    title: "Last name",
    minLength: 1,
    maxLength: 200,
    "x-claim": "claims.family_name",
    "x-editable": true,
  },
  phone: {
    type: "string",
    format: "phone",
    title: "Phone number",
    "x-mfa": "sms",
    "x-sensitive": true,
    "x-editable": true,
  },
};

export function defaultUserSchema(opts: {
  fields?: string[];
  authMethods?: string[] | AuthMethods;
} = {}): UserSchema {
  const fields = opts.fields?.length ? opts.fields : ["email", "given_name", "family_name"];
  const authMethods = normalizeAuthMethods(opts.authMethods);
  const properties: Record<string, Record<string, unknown>> = {};

  for (const field of fields) {
    properties[field] = { ...(FIELD_PRESETS[field] ?? genericField(field)) };
  }

  return sortValue({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    title: "Human User",
    "x-auth-methods": authMethods,
    required: [...fields].sort(),
    properties,
  }) as UserSchema;
}

export function normalizeAuthMethods(methods?: string[] | AuthMethods): AuthMethods {
  if (methods && !Array.isArray(methods)) {
    return methods;
  }

  const selected = methods?.length ? methods : ["passkey", "password"];
  const out: AuthMethods = {};
  selected.forEach((method, index) => {
    out[method] = { enabled: true, position: index };
  });
  return out;
}

export function fieldPreset(name: string): Record<string, unknown> {
  return { ...(FIELD_PRESETS[name] ?? genericField(name)) };
}

function genericField(name: string): Record<string, unknown> {
  return {
    type: "string",
    title: titleize(name),
    "x-editable": true,
  };
}

function titleize(value: string): string {
  return value
    .split(/[_-]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
