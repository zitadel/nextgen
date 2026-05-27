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
 * The credential step for password sign-in. Collects a `password` field
 * and offers a `forgot` action that pivots into the recovery flow.
 */
function credentialStep(): StepDefinition {
  return {
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
  };
}

/**
 * The password auth method. Builds a complete flow_definition with an
 * identifier step, a password credential step, a register-profile step,
 * and a terminal complete step. The locale fragment seeds the password
 * label and the "Forgot password?" action on top of {@link BASE_LOCALE}.
 *
 * Pure: touches no filesystem or network. The returned flow and locale
 * objects are freshly allocated on every call.
 */
export const password: FlowMethod = {
  id: "password",
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
      "credential.field.password": "Password",
      "credential.action.forgot": "Forgot password?",
      ...registerFieldLocale(args.fields),
    };
    return { flow, locale };
  },
};
