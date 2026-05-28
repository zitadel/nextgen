import type { FlowDefinition } from "./schema";

/**
 * Per-method flow builders, the flow domain's catalog. Mirrors
 * `lib/user-schema`'s `presets.ts`: a small set of named bodies the
 * `build.ts` entry point dispatches into. Each builder is pure and
 * returns a freshly-allocated {@link FlowDefinition} so callers may
 * retain references without risk of internal mutation.
 */

/**
 * Canonical URI for the human-user JSON Schema the default flows
 * reference. The local `.zitadel/schemas/user.json` body is derived
 * from this same shape; the URI is the spec-required pointer the
 * platform stores against each flow.
 */
const USER_SCHEMA_URI =
  "https://raw.githubusercontent.com/zitadel/nextgen/refs/heads/main/api/openapi/endpoints/schemas/human-user.yaml";

/**
 * Build the password-authentication flow.
 *
 * Scaffolds the four canonical steps a login + register journey needs
 * (identifier, credential, register_profile, complete) with a
 * `password` field on the credential step and a `forgot` action that
 * pivots into the recovery purpose. Display text is resolved
 * client-side from the rendering layer; the flow only carries
 * `text_key` references.
 *
 * @param fields - User-schema property names to collect on the
 *   register step, in display order (e.g. `["email", "given_name"]`).
 */
export function buildPasswordFlow(fields: ReadonlyArray<string>): FlowDefinition {
  return {
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
        fields: {
          password: {
            type: "password",
            text_key: "credential.field.password",
            required: true,
          },
        },
        actions: {
          submit: { text_key: "credential.action.submit", primary: true },
          forgot: { text_key: "credential.action.forgot", primary: false },
        },
        gates: {},
        transitions: {
          submit: "complete",
          forgot: { pivot: "recovery" },
        },
      },
      registerProfileStep(fields),
      completeStep(),
    ],
  };
}

/**
 * Build the passkey-authentication flow.
 *
 * Scaffolds the four canonical steps a login + register journey needs
 * (identifier, credential, register_profile, complete). The credential
 * step has no input fields — the WebAuthn ceremony is driven by the
 * client and the OAS spec models passkey verification via
 * `x-credential: "passkey"` on the referenced user-schema property (see
 * `api/openapi/endpoints/schemas/flow-definition.json`). Display text is
 * resolved client-side from the rendering layer; the flow only carries
 * `text_key` references.
 *
 * @param fields - User-schema property names to collect on the
 *   register step, in display order (e.g. `["email", "given_name"]`).
 */
export function buildPasskeyFlow(fields: ReadonlyArray<string>): FlowDefinition {
  return {
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
      registerProfileStep(fields),
      completeStep(),
    ],
  };
}

/**
 * The register-profile step is identical across methods: a form that
 * collects the chosen user-schema fields and offers a pivot back to
 * login. Shared so the two flows cannot drift.
 */
function registerProfileStep(fields: ReadonlyArray<string>): FlowDefinition["steps"][number] {
  return {
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
  };
}

/** The terminal step shared by both flows. */
function completeStep(): FlowDefinition["steps"][number] {
  return {
    name: "complete",
    type: "complete",
    texts: { title_key: "complete.title" },
    fields: {},
    actions: {},
    gates: {},
  };
}

/**
 * Map a user-schema property name to the renderer input `type` for the
 * register step. Unknown names fall back to `text`.
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
