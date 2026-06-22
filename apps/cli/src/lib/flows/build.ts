import type { CreateFlowDefinitionBodyFlowDefinition } from "@zitadel/api/generated/model";

/**
 * Canonical URI for the human-user JSON Schema the default flow
 * references. The local `.zitadel/schemas/user.json` body is derived
 * from this same shape; the URI is the spec-required pointer the
 * platform stores against each flow.
 */
const USER_SCHEMA_URI =
  "https://raw.githubusercontent.com/zitadel/nextgen/refs/heads/main/api/openapi/endpoints/schemas/human-user.yaml";

/**
 * Build the default username-and-password flow.
 *
 * Scaffolds the four canonical steps a login + register journey needs:
 *
 * - `identifier`     collects email; on `user_not_found` (the
 *                    engine-emitted outcome from `x-unique` on email)
 *                    transitions to `register-profile`.
 * - `credential`     collects the `password` property (carries
 *                    `x-credential: "password"` on the user schema, so
 *                    the engine handles verification).
 * - `register-profile` collects the user-schema fields and runs
 *                    `on_success: "create_user"` to materialize the user.
 * - `complete`       terminal step; `complete: "redirect"` tells the
 *                    frontend to navigate to the OIDC/SAML callback.
 *
 * The shape matches `api/openapi/components/flows/flow-definition.yaml`
 * exactly — no CLI-side extensions. Display text is resolved
 * client-side from a locale dictionary at runtime; the engine does not
 * see it.
 *
 * Pure: touches no filesystem or network. The returned object is newly
 * allocated; callers may retain references without risk of internal
 * mutation.
 *
 * @param fields - User-schema property names to collect on the register
 *   step, in display order (e.g. `["email", "given_name"]`).
 */
export function buildFlow(
  fields: ReadonlyArray<string>,
): CreateFlowDefinitionBodyFlowDefinition {
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
        actions: [
          { name: "submit", kind: "submit", primary: true },
          { name: "register", kind: "navigate" },
        ],
        gates: {},
        transitions: {
          submit: { target: "credential" },
          register: { target: "register-profile" },
          // Engine-emitted outcome when `x-unique` on email finds no
          // matching user: route to register instead of failing.
          user_not_found: { target: "register-profile" },
        },
      },
      {
        name: "credential",
        fields: ["password"],
        actions: [{ name: "submit", kind: "submit", primary: true }],
        gates: {},
        transitions: { submit: { target: "complete" } },
      },
      {
        name: "register-profile",
        // The Go `create_user` handler requires both an identifier field
        // and a password field on the same step (see
        // `internal/domain/flow_on_success_create_user.go`): it inserts
        // the user row and the password row in one transaction.
        fields: [...fields, "password"],
        actions: [
          { name: "submit", kind: "submit", primary: true },
          { name: "login", kind: "navigate" },
        ],
        gates: {},
        on_success: "create_user",
        transitions: {
          submit: { target: "complete" },
          login: { target: "identifier" },
        },
      },
      {
        name: "complete",
        fields: [],
        actions: [],
        gates: {},
        complete: "redirect",
      },
    ],
  };
}
