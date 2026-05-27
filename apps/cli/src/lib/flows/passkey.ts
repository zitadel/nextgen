import type { FlowDefinition } from "./schema";

/**
 * Canonical URI for the human-user JSON Schema the default flow
 * references. The local `.zitadel/schemas/user.json` body is derived
 * from this same shape; the URI is the spec-required pointer the
 * platform stores against each flow.
 */
const USER_SCHEMA_URI =
  "https://raw.githubusercontent.com/zitadel/nextgen/refs/heads/main/api/openapi/endpoints/schemas/human-user.yaml";

/**
 * Build the passkey-authentication flow and its English locale seed.
 *
 * The flow scaffolds the four canonical steps a login + register
 * journey needs (identifier, credential, register_profile, complete).
 * The credential step has no input fields — the WebAuthn ceremony is
 * driven by the client and the OAS spec models passkey verification
 * via `x-credential: "passkey"` on the referenced user-schema
 * property (see `api/openapi/endpoints/schemas/flow-definition.json`).
 * The locale fragment contributes the shared step labels plus
 * per-field register entries; there is no credential-specific
 * label because the step carries no input.
 *
 * Pure: touches no filesystem or network. The returned flow and
 * locale objects are newly allocated on every call so callers may
 * retain references without risk of internal mutation.
 *
 * @param fields - User-schema property names to collect on the
 *   register step, in display order (e.g. `["email", "given_name"]`).
 */
export function buildPasskeyFlow(
  fields: ReadonlyArray<string>,
): { flow: FlowDefinition; locale: Record<string, string> } {
  const flow: FlowDefinition = {
    name: "default",
    user_schema: USER_SCHEMA_URI,
    purposes: ["login", "register"],
    initial_steps: {
      login: "identifier",
      register: "register_profile",
    },
    steps: [
      {
        name: "identifier",
        type: "identifier",
        texts: { title_key: "identifier.title" },
        fields: {
          email: {
            type: "email",
            text_key: "identifier.field.email",
            required: true,
          },
        },
        actions: {
          submit: { text_key: "identifier.action.submit", primary: true },
          register: { text_key: "identifier.action.register", primary: false },
        },
        gates: {},
        transitions: {
          submit: "credential",
          register: { pivot: "register" },
        },
      },
      {
        name: "credential",
        type: "credential",
        texts: { title_key: "credential.title" },
        fields: {},
        actions: {
          submit: { text_key: "credential.action.submit", primary: true },
        },
        gates: {},
        transitions: {
          submit: "complete",
        },
      },
      {
        name: "register_profile",
        type: "form",
        texts: { title_key: "register_profile.title" },
        fields: Object.fromEntries(
          fields.map((field) => [
            field,
            {
              type: fieldType(field),
              text_key: `register_profile.field.${field}`,
              required: true,
            },
          ]),
        ),
        actions: {
          submit: { text_key: "register_profile.action.submit", primary: true },
          login: { text_key: "register_profile.action.login", primary: false },
        },
        gates: {},
        transitions: {
          submit: "complete",
          login: { pivot: "login" },
        },
      },
      {
        name: "complete",
        type: "complete",
        texts: { title_key: "complete.title" },
        fields: {},
        actions: {},
        gates: {},
      },
    ],
  };

  const locale: Record<string, string> = {
    "identifier.title": "Sign in",
    "identifier.field.email": "Email address",
    "identifier.action.submit": "Continue",
    "identifier.action.register": "Create account",
    "credential.title": "Enter your credential",
    "credential.action.submit": "Sign in",
    "register_profile.title": "Create your account",
    "register_profile.action.submit": "Create account",
    "register_profile.action.login": "Already have an account? Sign in",
    "complete.title": "You're signed in",
    ...Object.fromEntries(
      fields.map((field) => [`register_profile.field.${field}`, fieldLabel(field)]),
    ),
  };

  return { flow, locale };
}

/**
 * Map a user-schema property name to the renderer input `type` for
 * the register step. Unknown names fall back to `text`.
 */
function fieldType(field: string): "text" | "email" | "password" | "tel" | "date" {
  if (field === "email") {
    return "email";
  }
  if (field === "phone") {
    return "tel";
  }
  if (field === "password") {
    return "password";
  }
  if (field === "date_of_birth" || field === "birthdate") {
    return "date";
  }
  return "text";
}

/**
 * English locale label for a known user-schema property. Returns
 * empty string for unknown names so callers can decide whether to
 * synthesize a label or leave the entry blank for translators.
 */
function fieldLabel(field: string): string {
  switch (field) {
    case "email": {
      return "Email address";
    }
    case "given_name": {
      return "First name";
    }
    case "family_name": {
      return "Last name";
    }
    case "phone": {
      return "Phone number";
    }
    case "date_of_birth":
    case "birthdate": {
      return "Date of birth";
    }
    default: {
      return "";
    }
  }
}
