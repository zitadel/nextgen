/**
 * The types and constants of login flows: their steps and transitions, how a
 * step uses a method, and what the flows are asked about the providers their
 * steps offer.
 */

import type { flowConfigSchema } from "@zitadel/config/schemas";
import { PURPOSE_FLIP_TARGETS } from "@zitadel/config/validate";

import { type PropertyPath, type StepName, stepName } from "@/lib/zitadel/names";
import type { Connection } from "@/lib/zitadel/resources/connections/connection";
import type { Flow } from "@/lib/zitadel/resources/flows/flow";
import type { ContractValue } from "@/lib/zitadel/resources/document";
import type { Step } from "@/lib/zitadel/resources/flows/step";
import type { UserSchema } from "@/lib/zitadel/resources/schemas/schema";

/**
 * What a login flow holds once the flow contract took its body.
 */
export type FlowValue = ContractValue<typeof flowConfigSchema>;

/**
 * One step of a login flow, as the flow contract took it.
 */
export type StepValue = FlowValue["steps"][number];

/**
 * Where one outcome of a step goes, as the flow contract took it.
 */
export type RouteValue = NonNullable<StepValue["transitions"]>[string];

/**
 * The field a step collects a password with.
 */
export const PASSWORD_FIELD = "x-auth-methods#password";

/**
 * The action kinds that offer or enrol a passkey.
 */
export const PASSKEY_ACTION_KINDS = ["passkey", "passkey_register"] as const;

/**
 * An action kind that offers or enrols a passkey.
 */
export type PasskeyActionKind = (typeof PASSKEY_ACTION_KINDS)[number];

/**
 * Outcomes the engine answers by switching from login to register without a
 * `purpose` on the transition: the identifier one, plus `sso_user_not_found`.
 */
export const LOGIN_LEAVING_OUTCOMES: ReadonlySet<string> = new Set([
  ...Object.keys(PURPOSE_FLIP_TARGETS.login ?? {}),
  "sso_user_not_found",
]);

/**
 * The outcomes a provider sign-in can end in, which carry the provider to the
 * next step.
 */
export const PROVIDER_OUTCOMES = [
  "sso_authenticated",
  "sso_user_not_found",
  "user_already_exists",
] as const;

/**
 * An outcome a provider sign-in can end in.
 */
export type ProviderOutcome = (typeof PROVIDER_OUTCOMES)[number];

/**
 * The outcome the engine raises when a provider's sign-in collides with an
 * existing account.
 */
export const COLLISION_OUTCOME = "user_already_exists" satisfies ProviderOutcome;

/**
 * The step enabling a provider adds, which the engine sends a new external
 * identity to.
 */
export const REGISTER_SSO_STEP: StepName = stepName("register-sso");

/**
 * The step enabling a provider adds, shown when the provider's email already
 * has an account.
 */
export const SSO_CONFLICT_STEP: StepName = stepName("sso-conflict");

/**
 * The step that asks the identified user for a password.
 */
export const PASSWORD_STEP: StepName = stepName("password");

/**
 * The step that registers someone with a password, which shares the
 * `user_already_exists` outcome with the generated steps.
 */
export const REGISTER_PASSWORD_STEP: StepName = stepName("register-password");

/**
 * Outcome keys the previous CLI wrote, and the outcome each is now raised as.
 */
export const LEGACY_OUTCOMES = {
  callback: "sso_authenticated",
  identity_unknown: "sso_user_not_found",
} as const satisfies Record<string, ProviderOutcome>;

/**
 * One transition out of a step: what fires it, and where it goes.
 *
 * @remarks
 * Told apart by what the engine does with it: a transition with an `action`
 * leaves for another flow, whatever else it names; one with a target goes to
 * that step of this flow, re-purposing the attempt when it names a purpose;
 * one that names only a purpose goes to that purpose's entry step; and one
 * that names none of them goes nowhere.
 */
export type Transition =
  | {
      readonly kind: "step";

      /**
       * The outcome that fires it, such as `sso_authenticated`.
       */
      readonly outcome: string;

      /**
       * The step it goes to.
       */
      readonly target: StepName;

      /**
       * The purpose it re-purposes to, or `undefined` when it keeps the attempt's.
       */
      readonly purpose: string | undefined;
    }
  | {
      readonly kind: "purpose";
      readonly outcome: string;

      /**
       * The purpose whose entry step it goes to.
       */
      readonly purpose: string;
    }
  | {
      readonly kind: "cross-flow";
      readonly outcome: string;

      /**
       * `switch` or `pivot`, as written.
       */
      readonly action: string;

      /**
       * The step it names in the other flow, or `undefined` when it names none.
       */
      readonly target: StepName | undefined;
    }
  | {
      readonly kind: "nowhere";
      readonly outcome: string;
    };

/**
 * One action a step declares, as the flow contract took it: its name, which
 * the step's outcomes refer to it by, and what it does, such as `passkey`.
 */
export type StepAction = StepValue["actions"][number];

/**
 * A transition of another step that leads to a step.
 *
 * @remarks
 * Told apart by `purpose`, which `--json` reports as written: a transition
 * that names only a purpose leads to that purpose's entry step.
 */
export type IncomingTransition =
  | {
      /**
       * The step the transition belongs to.
       */
      readonly step: StepName;

      /**
       * The outcome that fires it.
       */
      readonly transition: string;

      /**
       * Absent: the transition names its target.
       */
      readonly purpose?: undefined;
    }
  | {
      readonly step: StepName;
      readonly transition: string;

      /**
       * The purpose it follows to that purpose's entry step.
       */
      readonly purpose: string;
    };

/**
 * How a step uses a method, as a message names it.
 */
export type MethodUsage = "collects password" | `offers passkey (${string})`;

/**
 * How one step uses a method, and what the step would be without it.
 */
export type MethodUse = {
  /**
   * The step.
   */
  readonly step: StepName;

  /**
   * How it uses the method.
   */
  readonly uses: MethodUsage;

  /**
   * The fields and sign-in methods it keeps without the method.
   */
  readonly keeps: readonly string[];

  /**
   * The purposes that start on it.
   */
  readonly entryFor: readonly string[];

  /**
   * The transitions that lead to it.
   */
  readonly targetedBy: readonly IncomingTransition[];
};

/**
 * A step reached while walking a flow, and the provider chosen on the way
 * there.
 */
export type Visit = {
  /**
   * The step reached.
   */
  readonly step: Step;

  /**
   * The provider chosen on the way, or `undefined` when none was.
   */
  readonly provider: string | undefined;
};

/**
 * A provider a flow step offers.
 */
export type Offer = {
  /**
   * The flow the step is in.
   */
  readonly flow: Flow;

  /**
   * The step that offers the provider.
   */
  readonly step: Step;

  /**
   * The provider's slug, as the step lists it.
   */
  readonly slug: string;

  /**
   * The connection the slug names, or `undefined` when no file has it.
   */
  readonly connection: Connection | undefined;
};

/**
 * A provider a flow step offers, on a flow whose schema is a local file.
 */
export type PinnedOffer = Offer & {
  /**
   * The local schema the offer's flow runs against.
   */
  readonly schema: UserSchema;
};

/**
 * A way to sign up that reaches a step creating a user without ever asking
 * for a property the schema requires, from a provider that does not supply it.
 */
export type SignUpGap = {
  /**
   * The flow the way runs through.
   */
  readonly flow: Flow;

  /**
   * The schema the flow runs against.
   */
  readonly schema: UserSchema;

  /**
   * The step that creates the user.
   */
  readonly step: Step;

  /**
   * The provider the person signed up with.
   */
  readonly connection: Connection;

  /**
   * The required property's dotted path.
   */
  readonly path: PropertyPath;
};
