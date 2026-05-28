import { sortValue } from "../json";
import type { AuthMethods } from "./annotations";

/**
 * Shape per `api/openapi/endpoints/schemas/user-schema.yaml`. Required:
 * $schema, $id, kind, title, x-auth-methods. `kind` is the discriminator
 * the platform reads (`POST /schemas` is `oneOf [user-schema, schema-url]`
 * keyed on `kind`).
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

/**
 * Canonical $id for the default human-user schema the CLI emits. The
 * platform stores schemas keyed by this URI; using a stable repo-rooted
 * URL means multiple projects pointing at the same default share one
 * record instead of every project minting its own.
 */
export const DEFAULT_USER_SCHEMA_ID =
  "https://raw.githubusercontent.com/zitadel/nextgen/refs/heads/main/api/openapi/endpoints/schemas/human-user.yaml";

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

export function defaultUserSchema(
  opts: {
    fields?: string[];
    authMethods?: string | string[] | AuthMethods;
  } = {},
): UserSchema {
  const fields = opts.fields?.length ? opts.fields : ["email", "given_name", "family_name"];
  const authMethods = normalizeAuthMethods(opts.authMethods);
  const properties: Record<string, Record<string, unknown>> = {};

  for (const field of fields) {
    properties[field] = { ...(FIELD_PRESETS[field] ?? genericField(field)) };
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

export function normalizeAuthMethods(methods?: string | string[] | AuthMethods): AuthMethods {
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

  const sanitized = methods
    ?.map((method) => method.trim())
    .filter((method) => method.length > 0);
  const selected = sanitized?.length ? sanitized : ["passkey"];
  const out: AuthMethods = {};
  selected.forEach((method, index) => {
    out[method] = { enabled: true, position: index };
  });
  return out;
}

export function fieldPreset(name: string): Record<string, unknown> {
  return { ...(FIELD_PRESETS[name] ?? genericField(name)) };
}

export type NamedPreset = {
  name: string;
  schema: Record<string, unknown>;
  required: boolean;
};

const NAMED_PRESETS: Record<string, NamedPreset[]> = {
  email: [{ name: "email", schema: { ...FIELD_PRESETS.email }, required: true }],
  "phone-mfa-sms": [
    {
      name: "phone",
      schema: {
        ...FIELD_PRESETS.phone,
        "x-mfa": "sms",
      },
      required: false,
    },
  ],
  "phone-mfa-required": [
    {
      name: "phone",
      schema: {
        ...FIELD_PRESETS.phone,
        "x-mfa": "sms",
      },
      required: true,
    },
  ],
  "full-name": [
    { name: "given_name", schema: { ...FIELD_PRESETS.given_name }, required: true },
    { name: "family_name", schema: { ...FIELD_PRESETS.family_name }, required: true },
  ],
  "date-of-birth": [
    {
      name: "date_of_birth",
      schema: {
        type: "string",
        format: "date",
        title: "Date of birth",
        "x-sensitive": true,
        "x-editable": true,
      },
      required: false,
    },
  ],
};

export function listNamedPresets(): string[] {
  return Object.keys(NAMED_PRESETS).sort();
}

export function resolveNamedPreset(name: string): NamedPreset[] | undefined {
  const preset = NAMED_PRESETS[name];
  return preset ? preset.map((entry) => ({ ...entry, schema: { ...entry.schema } })) : undefined;
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
