import type { CreateFlowDefinitionBodyFlowDefinition } from "@zitadel-nextgen/api/generated/model";

type FlowDefinition = CreateFlowDefinitionBodyFlowDefinition;

/**
 * Per-method flow builders, the flow domain's catalog. Mirrors
 * `lib/user-schema`'s `presets.ts`: a small set of named bodies the
 * `build.ts` entry point dispatches into. Each builder is pure and
 * returns a freshly-allocated {@link FlowDefinition} so callers may
 * retain references without risk of internal mutation.
 *
 * The shapes here match `api/openapi/components/flows/flow-definition.yaml`
 * exactly — no CLI-side extensions. The spec is intentionally lean:
 * steps reference user-schema properties by name (`fields: string[]`),
 * actions are just `{ primary?, text_key? }`, transitions are
 * `{ target, action? }` where `action ∈ {null, "switch", "pivot"}`.
 * Display text is resolved client-side from a locale dictionary at
 * runtime; the engine does not see it.
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
 * (identifier, credential, register-profile, complete) with a
 * `password` field on the credential step and a `forgot` action that
 * pivots into the recovery purpose.
 *
 * @param fields - User-schema property names to collect on the
 *   register step, in display order (e.g. `["email", "given_name"]`).
 */
export function buildPasswordFlow(fields: ReadonlyArray<string>): FlowDefinition {
  return {
    name: "default",
    user_schema: USER_SCHEMA_URI,
    purposes: {
      login: "identifier",
      register: "register-profile",
    },
    steps: [
      {
        name: "identifier",
        fields: ["email"],
        actions: {
          submit: { primary: true },
          register: {},
        },
        gates: {},
        transitions: {
          submit: { target: "credential" },
          register: { target: "register-profile" },
        },
      },
      {
        name: "credential",
        fields: ["password"],
        actions: {
          submit: { primary: true },
        },
        gates: {},
        // No `forgot` action: recovery is a separate flow definition,
        // and the CLI scaffolds only the login + register flow today.
        // Adding a `pivot` here would point at a non-existent flow and
        // the engine rejects that at create time.
        transitions: {
          submit: { target: "complete" },
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
 * (identifier, credential, register-profile, complete). The credential
 * step has no input fields — the WebAuthn ceremony is driven by the
 * client and the OAS spec models passkey verification via
 * `x-credential: "passkey"` on the referenced user-schema property.
 *
 * @param fields - User-schema property names to collect on the
 *   register step, in display order (e.g. `["email", "given_name"]`).
 */
export function buildPasskeyFlow(fields: ReadonlyArray<string>): FlowDefinition {
  return {
    name: "default",
    user_schema: USER_SCHEMA_URI,
    purposes: {
      login: "identifier",
      register: "register-profile",
    },
    steps: [
      {
        name: "identifier",
        fields: ["email"],
        actions: {
          submit: { primary: true },
          register: {},
        },
        gates: {},
        transitions: {
          submit: { target: "credential" },
          register: { target: "register-profile" },
        },
      },
      {
        name: "credential",
        fields: [],
        actions: {
          submit: { primary: true },
        },
        gates: {},
        transitions: {
          submit: { target: "complete" },
        },
      },
      registerProfileStep(fields),
      completeStep(),
    ],
  };
}

/**
 * The register-profile step is identical across methods: a form that
 * collects the chosen user-schema fields, creates the user on submit,
 * and offers a switch back to login. Shared so the two flows cannot
 * drift.
 */
function registerProfileStep(fields: ReadonlyArray<string>): FlowDefinition["steps"][number] {
  return {
    name: "register-profile",
    // Spec ($defs/Step.name) restricts step names to ^[a-z][a-z0-9-]*$ —
    // hyphens, not underscores. The engine matches `purposes` values
    // against this same name.
    fields: [...fields],
    actions: {
      submit: { primary: true },
      login: {},
    },
    gates: {},
    on_success: "create_user",
    transitions: {
      submit: { target: "complete" },
      login: { target: "identifier" },
    },
  };
}

/**
 * The terminal step shared by both flows. The `complete: "redirect"`
 * marker tells the frontend to navigate to the OIDC/SAML callback URI
 * (the alternative, `show`, would render a success screen instead).
 */
function completeStep(): FlowDefinition["steps"][number] {
  return {
    name: "complete",
    fields: [],
    actions: {},
    gates: {},
    complete: "redirect",
  };
}
