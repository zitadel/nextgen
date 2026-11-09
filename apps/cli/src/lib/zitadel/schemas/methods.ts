/**
 * Turning a user schema's own sign-in methods, password and passkey, on and
 * off. Login flows are never edited: a flow that would stop validating refuses
 * the edit instead.
 */

import { Change } from "@/lib/zitadel/change";
import type { ZitadelConfig } from "@/lib/zitadel/config";
import { assertFlowsIntact, assertMethodUnused } from "@/lib/zitadel/flows/checks";
import type { UserSchema } from "@/lib/zitadel/schemas/schema";
import { assertSignInLeft, signInNotices } from "@/lib/zitadel/schemas/signin";
import type { ToggleableMethod } from "@/lib/zitadel/types";

/** What an edit that may leave a schema with no way to sign in is told. */
export type ForceOptions = Readonly<{
  /** Make the edit even when it leaves no way to sign in. */
  force?: boolean | undefined;
}>;

/**
 * Turn a method on for a user schema.
 *
 * @param config - The configuration.
 * @param schema - The schema.
 * @param method - The method.
 * @returns The change.
 * @throws {@link RefusedEditError} When the schema's methods are not the shape
 *   the edit writes, or password is enabled without an identifier.
 * @throws {@link BrokenFlowsError} When a flow would stop validating.
 */
export function enableMethod(
  config: ZitadelConfig,
  schema: UserSchema,
  method: ToggleableMethod,
): Change {
  const edited = schema.withMethod(method, true);
  const edit = { before: config, after: config.with(edited), original: schema, edited };
  assertFlowsIntact(edit);
  return new Change({ before: config, after: edit.after, notices: signInNotices(edit, method) });
}

/**
 * Turn a method off for a user schema.
 *
 * @param config - The configuration.
 * @param schema - The schema.
 * @param method - The method.
 * @param options - Whether to leave the schema with no way to sign in.
 * @returns The change.
 * @throws {@link RefusedEditError} When the schema's methods are not the shape
 *   the edit writes.
 * @throws {@link BrokenFlowsError} When a flow still uses the method.
 * @throws {@link NoSignInLeftError} When it is the last way to sign in and
 *   `force` is not set.
 */
export function disableMethod(
  config: ZitadelConfig,
  schema: UserSchema,
  method: ToggleableMethod,
  options: ForceOptions = {},
): Change {
  const edited = schema.withMethod(method, false);
  const edit = { before: config, after: config.with(edited), original: schema, edited };
  assertMethodUnused(edit, method);
  assertSignInLeft(edit, method, options.force === true);
  return new Change({ before: config, after: edit.after, notices: signInNotices(edit) });
}
