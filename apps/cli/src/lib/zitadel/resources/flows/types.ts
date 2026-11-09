/**
 * The types and constants of login flows: their steps and transitions, how a
 * step uses a method, and what the flows are asked about the providers their
 * steps offer.
 */

import { PURPOSE_FLIP_TARGETS } from "@zitadel/config/validate";

import type { Connection } from "@/lib/zitadel/resources/connections/connection";
import type { Flow } from "@/lib/zitadel/resources/flows/flow";
import type { Step } from "@/lib/zitadel/resources/flows/step";
import type { UserSchema } from "@/lib/zitadel/resources/schemas/schema";

/**
 * The field a step collects a password with.
 */
export const PASSWORD_FIELD = "x-auth-methods#password";

/**
 * The action kinds that offer or enrol a passkey.
 */
export const PASSKEY_ACTION_KINDS: ReadonlySet<string> = new Set(["passkey", "passkey_register"]);

/**
 * Outcomes the engine answers by switching from login to register without a
 * `purpose` on the transition: the identifier one, plus `sso_user_not_found`.
 */
export const LOGIN_LEAVING_OUTCOMES: ReadonlySet<string> = new Set([
  ...Object.keys(PURPOSE_FLIP_TARGETS.login ?? {}),
  "sso_user_not_found",
]);

/**
 * The outcome the engine raises when a provider's sign-in collides with an
 * existing account.
 */
export const COLLISION_OUTCOME = "user_already_exists";

/**
 * The outcomes a provider sign-in can end in, which carry the provider to the
 * next step.
 */
export const SSO_OUTCOMES: ReadonlySet<string> = new Set([
  "sso_authenticated",
  "sso_user_not_found",
  COLLISION_OUTCOME,
]);

/**
 * The step enabling a provider adds, which the engine sends a new external
 * identity to.
 */
export const REGISTER_SSO_STEP = "register-sso";

/**
 * The step enabling a provider adds, shown when the provider's email already
 * has an account.
 */
export const SSO_CONFLICT_STEP = "sso-conflict";

/**
 * One transition out of a step: what fires it, and where it goes.
 */
export type Transition = Readonly<{
  /**
   * The outcome that fires it, such as `sso_authenticated`.
   */
  outcome: string;
  /**
   * The step it goes to; empty when it names none.
   */
  target: string;
  /**
   * `switch` or `pivot` for a transition to another flow; `null` within this one.
   */
  action: string | null;
  /**
   * The purpose it re-purposes to, or `null`.
   */
  purpose: string | null;
}>;

/**
 * One action a step declares.
 */
export type StepAction = Readonly<{
  /**
   * The action's name, as the step's outcomes refer to it.
   */
  name: string;
  /**
   * What the action does, such as `passkey`.
   */
  kind: string;
}>;

/**
 * A transition of another step that leads to a step.
 */
export type IncomingTransition = Readonly<{
  /**
   * The step the transition belongs to.
   */
  step: string;
  /**
   * The outcome that fires it.
   */
  transition: string;
  /**
   * The purpose it follows, when it names only a purpose and so leads to that
   * purpose's entry step.
   */
  purpose?: string;
}>;

/**
 * How one step uses a method, and what the step would be without it.
 */
export type MethodUse = Readonly<{
  /**
   * The step.
   */
  step: string;
  /**
   * How it uses the method, as a message names it.
   */
  uses: string;
  /**
   * The fields and sign-in methods it keeps without the method.
   */
  keeps: readonly string[];
  /**
   * The purposes that start on it.
   */
  entryFor: readonly string[];
  /**
   * The transitions that lead to it.
   */
  targetedBy: readonly IncomingTransition[];
}>;

/**
 * A step reached while walking a flow, and the provider chosen on the way
 * there.
 */
export type Visit = Readonly<{
  /**
   * The step reached.
   */
  step: Step;

  /**
   * The provider chosen on the way, or an empty string when none was.
   */
  provider: string;
}>;

/**
 * A provider a flow step offers.
 */
export type Offer = Readonly<{
  /**
   * The flow the step is in.
   */
  flow: Flow;

  /**
   * The step that offers the provider.
   */
  step: Step;

  /**
   * The provider's slug, as the step lists it.
   */
  slug: string;

  /**
   * The connection the slug names, or `undefined` when no file has it.
   */
  connection: Connection | undefined;
}>;

/**
 * A way to sign up that reaches a step creating a user without ever asking
 * for a property the schema requires, from a provider that does not supply it.
 */
export type SignUpGap = Readonly<{
  /**
   * The flow the way runs through.
   */
  flow: Flow;

  /**
   * The schema the flow runs against.
   */
  schema: UserSchema;

  /**
   * The step that creates the user.
   */
  step: Step;

  /**
   * The provider the person signed up with.
   */
  connection: Connection;

  /**
   * The required property's dotted path.
   */
  path: string;
}>;
