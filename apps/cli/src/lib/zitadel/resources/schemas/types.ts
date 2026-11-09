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
 * The longest provider slug a schema can name.
 */
export const MAX_SLUG_LENGTH = 64;

/**
 * The shape of a provider slug a schema can name.
 */
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

/**
 * A method `x-auth-methods` holds an entry for that an edit writes: one
 * switched by a flag alone, or SSO, which a provider edit switches.
 */
export type EditedMethod = ToggleableMethod | "sso";

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
