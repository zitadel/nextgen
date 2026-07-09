/**
 * Built-in JSON-Schema bodies for the user-schema fields `buildUserSchema`
 * knows about. {@link fieldPreset} resolves a field name to its body
 * (or a generic string property for unknown names).
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
    // The meta-schema types x-mfa as boolean (user-property.json); the
    // delivery channel is implied by the property, not encoded here.
    "x-mfa": true,
    "x-sensitive": true,
    "x-editable": true,
  },
  password: {
    type: "string",
    title: "Password",
    "x-sensitive": true,
    "x-editable": true,
    minLength: 1,
  },
};

/**
 * Resolve a single field's JSON-Schema body: a built-in preset if one
 * exists for `name`, otherwise a generic editable string property.
 * Returns a fresh object so callers may mutate it safely.
 */
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
