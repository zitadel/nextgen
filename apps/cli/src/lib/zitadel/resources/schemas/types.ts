/**
 * The sign-in methods a user schema enables, an edit to one schema, and what
 * an edit that may leave it with no way to sign in is told.
 */

import type { ZitadelConfig } from "@/lib/zitadel/config";
import type { UserSchema } from "@/lib/zitadel/resources/schemas/schema";

/**
 * The ways a user can sign in that a flow can offer, in the order a schema
 * lists them.
 *
 * @remarks
 * The meta-schema accepts other methods, but nothing in a flow can use them
 * yet.
 */
export const SIGN_IN_METHODS = ["passkey", "password", "sso"] as const;

/**
 * A way a user can sign in that a flow can offer.
 */
export type SignInMethod = (typeof SIGN_IN_METHODS)[number];

/**
 * The methods switched on and off by a flag alone.
 *
 * @remarks
 * SSO is not one of them: a provider needs credentials, a connection file and
 * flow edits.
 */
export const TOGGLEABLE_METHODS = ["password", "passkey"] as const satisfies readonly SignInMethod[];

/**
 * A method switched on and off by a flag alone.
 */
export type ToggleableMethod = (typeof TOGGLEABLE_METHODS)[number];

/**
 * The authentication methods a user schema enables, besides SSO: whether each
 * toggleable method is on.
 */
export type EnabledMethods = { readonly [M in ToggleableMethod]: boolean };

/**
 * An edit to one user schema, and the configuration before and after it.
 */
export type SchemaEdit = {
  /**
   * The configuration the edit was made on.
   */
  readonly before: ZitadelConfig;

  /**
   * The configuration as the edit leaves it.
   */
  readonly after: ZitadelConfig;

  /**
   * The schema as it was.
   */
  readonly original: UserSchema;

  /**
   * The schema as the edit leaves it.
   */
  readonly edited: UserSchema;
};

/**
 * What an edit that may leave a schema with no way to sign in is told.
 */
export type ForceOptions = {
  /**
   * Make the edit even when it leaves no way to sign in.
   */
  readonly force?: boolean | undefined;
};

/**
 * Whether a method named in a file is one a flow can offer.
 *
 * @param method - The method as written.
 * @returns Whether it is password, passkey or SSO.
 */
export function isSignInMethod(method: string): method is SignInMethod {
  return SIGN_IN_METHODS.some((known) => {
    return known === method;
  });
}

/**
 * Whether a method named in a file is one a flag alone switches.
 *
 * @param method - The method as written.
 * @returns Whether it is password or passkey.
 */
export function isToggleableMethod(method: string): method is ToggleableMethod {
  return TOGGLEABLE_METHODS.some((known) => {
    return known === method;
  });
}
