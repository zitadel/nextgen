import {
  BASE_LOCALE,
  DEFAULT_USER_SCHEMA_URI,
  completeStep,
  identifierStep,
  registerFieldLocale,
  registerProfileStep,
} from "./fields";
import type { FlowFragment, FlowMethod } from "./method";
import type { FlowDefinition, StepDefinition } from "./schema";
import type { BuildArgs } from "./types";

/**
 * The credential step for passkey sign-in. The WebAuthn ceremony is
 * driven by the client; the step itself carries no input fields and
 * has no recovery pivot today. The spec models passkey verification
 * via `x-credential: "passkey"` on the referenced user-schema property
 * (see `api/openapi/endpoints/schemas/flow-definition.json`); the
 * runtime hand-off lives in `FlowPendingChallenge` on the backend
 * state. No `forgot` action is emitted: passkey recovery is its own
 * future flow purpose.
 */
function credentialStep(): StepDefinition {
  return {
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
  };
}

/**
 * The passkey auth method. Builds a complete flow_definition with an
 * identifier step, a passkey credential step (no fields), a
 * register-profile step, and a terminal complete step. The locale
 * fragment carries only {@link BASE_LOCALE} plus per-field register
 * entries — passkey contributes no credential-specific labels.
 *
 * Pure: touches no filesystem or network. The returned flow and locale
 * objects are freshly allocated on every call.
 */
export const passkey: FlowMethod = {
  id: "passkey",
  build(args: Readonly<BuildArgs>): FlowFragment {
    const flow: FlowDefinition = {
      name: "default",
      user_schema: DEFAULT_USER_SCHEMA_URI,
      purposes: ["login", "register"],
      initial_steps: {
        login: "identifier",
        register: "register_profile",
      },
      steps: [
        identifierStep(),
        credentialStep(),
        registerProfileStep(args.fields),
        completeStep(),
      ],
    };
    const locale: Record<string, string> = {
      ...BASE_LOCALE,
      ...registerFieldLocale(args.fields),
    };
    return { flow, locale };
  },
};
