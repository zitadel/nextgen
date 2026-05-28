/**
 * Built-in field and named presets for `zitadel schema add`. This is a
 * user-schema-only concern (flows have no preset catalog). `build.ts`
 * and `merge.ts` both resolve individual fields through
 * {@link fieldPreset}.
 */

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

/**
 * One field a named preset contributes: its property name, JSON-Schema
 * body, and whether it lands in the schema's `required` list.
 */
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

/**
 * Resolve a single field's JSON-Schema body: a built-in preset if one
 * exists for `name`, otherwise a generic editable string property.
 * Returns a fresh object so callers may mutate it safely.
 */
export function fieldPreset(name: string): Record<string, unknown> {
  return { ...(FIELD_PRESETS[name] ?? genericField(name)) };
}

/** Names of the available multi-field presets, sorted. */
export function listNamedPresets(): string[] {
  return Object.keys(NAMED_PRESETS).sort();
}

/**
 * Resolve a named preset to its field list, or `undefined` if unknown.
 * Entries (and their schema bodies) are deep-copied so callers can't
 * mutate the catalog.
 */
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
