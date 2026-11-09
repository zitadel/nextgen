/**
 * What a login flow edit reports back, and what the flows are asked about the
 * providers their steps offer.
 */

import type { Connection } from "@/lib/zitadel/resources/connections/connection";
import type { Flow } from "@/lib/zitadel/resources/flows/flow";
import type { Step } from "@/lib/zitadel/resources/flows/step";
import type { UserSchema } from "@/lib/zitadel/resources/schemas/schema";

/**
 * A region an edit left alone because it was changed by hand.
 */
export type SkippedRegion = Readonly<{
  /**
   * The step that was left alone, such as `sso-conflict`.
   */
  step: string;

  /**
   * Where in the file, such as `steps.sso-conflict`.
   */
  region: string;

  /**
   * Why it was left alone.
   */
  reason: "hand-edited";
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
