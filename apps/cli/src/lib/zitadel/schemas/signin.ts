/**
 * Who can still sign in to a user schema after an edit: the refusal for an
 * edit that leaves no way in, and what to tell the person when a method is
 * enabled that no login flow offers.
 */

import type { ZitadelConfig } from "@/lib/zitadel/config";
import { NoSignInLeftError } from "@/lib/zitadel/errors";
import type { Flow } from "@/lib/zitadel/flows/flow";
import type { UserSchema } from "@/lib/zitadel/schemas/schema";
import {
  type Notice,
  type SchemaEdit,
  TOGGLEABLE_METHODS,
  type ToggleableMethod,
} from "@/lib/zitadel/types";

/**
 * The methods a schema enables that some active login flow lets an existing
 * user sign in with. Only steps reached from `purposes.login` count.
 *
 * @param config - The configuration.
 * @param schema - The schema.
 * @returns The methods.
 */
export function reachableMethods(config: ZitadelConfig, schema: UserSchema): readonly string[] {
  const offered = config.flowsFor(schema).flatMap((flow) => {
    return flow.offeredMethods(schema.signInProviders);
  });
  return schema.usableMethods.filter((method) => {
    return offered.includes(method);
  });
}

/**
 * Whether an edit takes a schema from some way to sign in to none.
 *
 * @param edit - The edit.
 * @returns Whether it does.
 */
export function removesLastWayIn(edit: SchemaEdit): boolean {
  return edit.original.usableMethods.length > 0 && edit.edited.usableMethods.length === 0;
}

/**
 * Refuse an edit that leaves a schema no way to sign in, unless the caller
 * asked for it with `force`.
 *
 * @param edit - The edit.
 * @param disabling - What it turns off: a method, or a provider.
 * @param force - Whether the caller asked for it anyway.
 * @throws {@link NoSignInLeftError} When it leaves no way in and `force` is not set.
 */
export function assertSignInLeft(edit: SchemaEdit, disabling: string, force: boolean): void {
  if (force || !removesLastWayIn(edit)) {
    return;
  }
  const schema = edit.edited;
  // The methods the schema does not enable, and password only where the
  // schema can take it: it needs an identifier.
  const alternatives = TOGGLEABLE_METHODS.filter((method) => {
    if (schema.usableMethods.includes(method)) {
      return false;
    }
    return method !== "password" || schema.hasIdentifier;
  });
  throw new NoSignInLeftError({ path: schema.path, schema: schema.name, disabling, alternatives });
}

/**
 * What to tell the person about who can sign in after an edit.
 *
 * @param edit - The edit.
 * @param enabled - The method the edit enables, if any.
 * @returns The notices.
 */
export function signInNotices(edit: SchemaEdit, enabled?: ToggleableMethod): readonly Notice[] {
  const schema = edit.edited;
  const reachable = reachableMethods(edit.after, schema);
  const notices: Notice[] = [];
  if (enabled !== undefined && !reachable.includes(enabled)) {
    // Enabling first and editing the flow second is a normal order of work.
    notices.push({
      severity: "warning",
      message: `No login flow for ${schema.name} offers ${enabled} yet. ${howToOffer(schema, enabled, edit.after.flowsFor(schema))}`,
    });
  }
  if (removesLastWayIn(edit)) {
    notices.push({
      severity: "warning",
      message: `${schema.name} is left with no way to sign in. Its users can only be managed through the API.`,
    });
  } else if (schema.usableMethods.length > 0 && reachable.length === 0) {
    // Flows are not edited for the developer (ADR 070 §2), so it is said.
    notices.push({
      severity: "warning",
      message: `No active login flow for ${schema.name} offers a method it enables, so nobody can sign in until one does.`,
    });
  }
  return notices;
}

/**
 * What to add so a login flow offers a method the schema enables, naming the
 * active login flows it could go in.
 *
 * @param schema - The schema.
 * @param method - The method no flow offers.
 * @param flows - The flows that run against the schema.
 * @returns The advice.
 */
function howToOffer(schema: UserSchema, method: ToggleableMethod, flows: readonly Flow[]): string {
  const paths = flows
    .filter((flow) => {
      return flow.servesLogin;
    })
    .map((flow) => {
      return flow.path;
    });
  const where =
    paths.length > 0
      ? paths.join(" or ")
      : `an active login flow for ${schema.name} in .zitadel/flows/`;
  const how = {
    password:
      'add "x-auth-methods#password" to the fields of a step reached from purposes.login, with a "kind": "submit" action and a transition under its name.',
    passkey:
      'add a "kind": "passkey" action to a step reached from purposes.login, plus a transition under the action\'s name. ' +
      'A "kind": "passkey_register" action does the same for sign-up.',
  }[method];
  return `In ${where}, ${how} See .zitadel/flows/README.md.`;
}
