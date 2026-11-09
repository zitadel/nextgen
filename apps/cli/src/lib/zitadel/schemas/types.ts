/** The sign-in methods a user schema enables, and an edit to one schema. */

import type { ZitadelConfig } from "@/lib/zitadel/config";
import type { UserSchema } from "@/lib/zitadel/schemas/schema";

/**
 * The methods switched on and off by a flag alone. SSO is not one of them: a
 * provider needs credentials, a connection file and flow edits.
 */
export const TOGGLEABLE_METHODS = ["password", "passkey"] as const;

/** A method switched on and off by a flag alone. */
export type ToggleableMethod = (typeof TOGGLEABLE_METHODS)[number];

/** The authentication methods a user schema enables, besides SSO. */
export type EnabledMethods = Readonly<{
  password: boolean;
  passkey: boolean;
}>;

/** An edit to one user schema, and the configuration before and after it. */
export type SchemaEdit = Readonly<{
  before: ZitadelConfig;
  after: ZitadelConfig;
  /** The schema as it was. */
  original: UserSchema;
  /** The schema as the edit leaves it. */
  edited: UserSchema;
}>;
