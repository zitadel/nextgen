/**
 * The sign-in methods a user schema enables, an edit to one schema, and what
 * an edit that may leave it with no way to sign in is told.
 */

import type { ZitadelConfig } from "@/lib/zitadel/config";
import type { UserSchema } from "@/lib/zitadel/resources/schemas/schema";

/**
 * The methods switched on and off by a flag alone.
 *
 * @remarks
 * SSO is not one of them: a provider needs credentials, a connection file and
 * flow edits.
 */
export const TOGGLEABLE_METHODS = ["password", "passkey"] as const;

/**
 * A method switched on and off by a flag alone.
 */
export type ToggleableMethod = (typeof TOGGLEABLE_METHODS)[number];

/**
 * The authentication methods a user schema enables, besides SSO.
 */
export type EnabledMethods = Readonly<{
  /**
   * Whether password sign-in is enabled.
   */
  password: boolean;

  /**
   * Whether passkey sign-in is enabled.
   */
  passkey: boolean;
}>;

/**
 * An edit to one user schema, and the configuration before and after it.
 */
export type SchemaEdit = Readonly<{
  /**
   * The configuration the edit was made on.
   */
  before: ZitadelConfig;

  /**
   * The configuration as the edit leaves it.
   */
  after: ZitadelConfig;

  /**
   * The schema as it was.
   */
  original: UserSchema;

  /**
   * The schema as the edit leaves it.
   */
  edited: UserSchema;
}>;

/**
 * What an edit that may leave a schema with no way to sign in is told.
 */
export type ForceOptions = Readonly<{
  /**
   * Make the edit even when it leaves no way to sign in.
   */
  force?: boolean | undefined;
}>;
