import { Change, type Notice } from "@/lib/zitadel/change";
import { Collection } from "@/lib/zitadel/resources/collection";
import { NoSignInLeftError } from "@/lib/zitadel/errors";
import { assertFlowsIntact, assertMethodUnused } from "@/lib/zitadel/resources/flows/checks";
import type { UserSchema } from "@/lib/zitadel/resources/schemas/schema";
import {
  type ForceOptions,
  type SchemaEdit,
  TOGGLEABLE_METHODS,
  type ToggleableMethod,
} from "@/lib/zitadel/resources/schemas/types";

/**
 * The user schemas under `.zitadel/schemas/`, turning their own sign-in
 * methods, password and passkey, on and off, and who can still sign in after
 * an edit.
 *
 * @remarks
 * Login flows are never edited by a method toggle: a flow that would stop
 * validating refuses the edit instead. The sign-in checks are public because
 * every edit to a schema is held to them, including the provider edits the
 * connections make.
 */
export class Schemas extends Collection<UserSchema> {
  /**
   * Turn a method on for a user schema.
   *
   * @param schema - The schema.
   * @param method - The method.
   * @returns The change.
   * @throws {@link RefusedEditError} When the schema's methods are not the
   *   shape the edit writes, or password is enabled without an identifier.
   * @throws {@link BrokenFlowsError} When a flow would stop validating.
   */
  enable(schema: UserSchema, method: ToggleableMethod): Change {
    const edited = schema.withMethod(method);
    const edit = { before: this.config, after: this.config.with(edited), original: schema, edited };
    assertFlowsIntact(edit);
    return new Change({
      before: this.config,
      after: edit.after,
      notices: this.signInNotices(edit, method),
    });
  }

  /**
   * Turn a method off for a user schema.
   *
   * @param schema - The schema.
   * @param method - The method.
   * @param options - Whether to leave the schema with no way to sign in.
   * @returns The change.
   * @throws {@link RefusedEditError} When the schema's methods are not the
   *   shape the edit writes.
   * @throws {@link BrokenFlowsError} When a flow still uses the method.
   * @throws {@link NoSignInLeftError} When it is the last way to sign in and
   *   `force` is not set.
   */
  disable(schema: UserSchema, method: ToggleableMethod, options: ForceOptions = {}): Change {
    const edited = schema.withoutMethod(method);
    const edit = { before: this.config, after: this.config.with(edited), original: schema, edited };
    assertMethodUnused(edit, method);
    this.assertSignInLeft(edit, method, options.force === true);
    return new Change({
      before: this.config,
      after: edit.after,
      notices: this.signInNotices(edit),
    });
  }

  /**
   * The methods a schema enables that some active login flow lets an
   * existing user sign in with.
   *
   * @remarks
   * Only steps reached from `purposes.login` count: a passkey a register step
   * only enrols is offered to nobody signing in.
   *
   * @param schema - The schema.
   * @returns The methods.
   */
  reachableMethods(schema: UserSchema): readonly string[] {
    const offered = this.config.flows.for(schema).flatMap((flow) => {
      return flow.offeredMethods(schema.signInProviders);
    });
    return schema.usableMethods.filter((method) => {
      return offered.includes(method);
    });
  }

  /**
   * The schemas that list a provider in `sso.providers`.
   *
   * @param slug - The provider.
   * @returns The schemas.
   */
  listing(slug: string): readonly UserSchema[] {
    return this.all.filter((schema) => {
      return schema.lists(slug);
    });
  }

  /**
   * Refuse an edit that leaves a schema no way to sign in, unless the caller
   * asked for it with `force`.
   *
   * @remarks
   * The refusal names the methods the schema could take instead: those it
   * did not enable before, which leaves out the one being turned off, and
   * password only where the schema has an identifier to take it.
   *
   * @param edit - The edit, made on this collection's configuration.
   * @param disabling - What it turns off: a method, or a provider.
   * @param force - Whether the caller asked for it anyway.
   * @throws {@link NoSignInLeftError} When it leaves no way in and `force` is
   *   not set.
   */
  assertSignInLeft(edit: SchemaEdit, disabling: string, force: boolean): void {
    if (force || !this.removesLastWayIn(edit)) {
      return;
    }
    const schema = edit.original;
    const alternatives = TOGGLEABLE_METHODS.filter((method) => {
      if (schema.usableMethods.includes(method)) {
        return false;
      }
      return method !== "password" || schema.hasIdentifier;
    });
    throw new NoSignInLeftError({
      path: schema.path,
      schema: schema.name,
      disabling,
      usable: schema.usableMethods,
      alternatives,
    });
  }

  /**
   * What to tell the person about who can sign in after an edit.
   *
   * @remarks
   * A method enabled that no flow offers is said with where and how to offer
   * it, naming the active login flows it could go in, since flows are not
   * edited for the developer (ADR 070 §2).
   *
   * @param edit - The edit, made on this collection's configuration.
   * @param enabled - The method the edit enables, if any.
   * @returns The notices.
   */
  signInNotices(edit: SchemaEdit, enabled?: ToggleableMethod): readonly Notice[] {
    const schema = edit.edited;
    const reachable = edit.after.schemas.reachableMethods(schema);
    const notices: Notice[] = [];
    if (enabled !== undefined && !reachable.includes(enabled)) {
      // Enabling first and editing the flow second is a normal order of work,
      // so this warns and does not refuse.
      const paths = edit.after.flows
        .for(schema)
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
      }[enabled];
      notices.push({
        severity: "warning",
        message: `No login flow for ${schema.name} offers ${enabled} yet. In ${where}, ${how} See .zitadel/flows/README.md.`,
      });
    }
    if (this.removesLastWayIn(edit)) {
      notices.push({
        severity: "warning",
        message: `${schema.name} is left with no way to sign in. Its users can only be managed through the API.`,
      });
    } else if (schema.usableMethods.length > 0 && reachable.length === 0) {
      notices.push({
        severity: "warning",
        message: `No active login flow for ${schema.name} offers a method it enables, so nobody can sign in until one does.`,
      });
    }
    return notices;
  }

  /**
   * Whether an edit takes a schema from some way to sign in to none.
   *
   * @param edit - The edit.
   * @returns Whether it does.
   */
  private removesLastWayIn(edit: SchemaEdit): boolean {
    return edit.original.usableMethods.length > 0 && edit.edited.usableMethods.length === 0;
  }
}
