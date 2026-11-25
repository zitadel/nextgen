import { basename } from "node:path";

import { Change, type Notice } from "@/lib/zitadel/change";
import { PinnedCollection } from "@/lib/zitadel/resources/collection";
import { AmbiguousSchemaError, NoSignInLeftError, SchemaNotFoundError } from "@/lib/zitadel/errors";
import { assertFlowsIntact, assertMethodUnused } from "@/lib/zitadel/rules/flows";
import type { UserSchema } from "@/lib/zitadel/resources/schemas/schema";
import {
  type ForceOptions,
  type SchemaEdit,
  type SignInMethod,
  TOGGLEABLE_METHODS,
  type ToggleableMethod,
} from "@/lib/zitadel/resources/schemas/types";
import { CONFIG_DIRECTORIES } from "@/lib/zitadel/types";

/**
 * What a name ends with to name a schema by its file alone.
 */
const FILE_SUFFIX = ".json";

/**
 * How to offer each toggleable method in a login flow, as a notice words it.
 */
const HOW_TO_OFFER = {
  password:
    'add "x-auth-methods#password" to the fields of a step reached from purposes.login, with a "kind": "submit" action and a transition under its name.',
  passkey:
    'add a "kind": "passkey" action to a step reached from purposes.login, plus a transition under the action\'s name. ' +
    'A "kind": "passkey_register" action does the same for sign-up.',
} as const satisfies Record<ToggleableMethod, string>;

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
export class Schemas extends PinnedCollection<UserSchema> {
  /**
   * The kind of file the collection owns.
   */
  readonly kinds = ["schema"] as const;

  /**
   * Where a document goes when no file holds its handle.
   */
  protected readonly directory = CONFIG_DIRECTORIES.schemas;

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
    const edited = schema.withMethod(method).document;
    const edit = { before: this.config, after: this.config.with(edited), original: schema, edited };
    assertFlowsIntact(edit);
    return new Change({
      before: this.config,
      after: edit.after,
      notices: this.describeSignIn(edit, method),
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
    const edited = schema.withoutMethod(method).document;
    const edit = { before: this.config, after: this.config.with(edited), original: schema, edited };
    assertMethodUnused(edit, method);
    this.assertSignInLeft(edit, method, options.force === true);
    return new Change({
      before: this.config,
      after: edit.after,
      notices: this.describeSignIn(edit, undefined, options.dryRun === true),
    });
  }

  /**
   * List the methods a schema enables that some login flow lets an existing
   * user sign in with.
   *
   * @remarks
   * Only steps reached from `purposes.login` count: a passkey a register step
   * only enrols is offered to nobody signing in.
   *
   * @param schema - The schema.
   * @returns The methods.
   */
  listReachableMethods(schema: UserSchema): readonly SignInMethod[] {
    const offered = this.config.flows.findForSchema(schema).flatMap((flow) => {
      return flow.findOfferedMethods(schema.providers);
    });
    return schema.usableMethods.filter((method) => {
      return offered.includes(method);
    });
  }

  /**
   * List the schemas that list a provider in `sso.providers`.
   *
   * @param slug - The provider, as a file names it.
   * @returns The schemas.
   */
  listOffering(slug: string): readonly UserSchema[] {
    return this.all.filter((schema) => {
      return schema.lists(slug);
    });
  }

  /**
   * Resolve the schema a name picks: its file name or its `objectType`, or the
   * only schema when no name is given.
   *
   * @remarks
   * A name that fits more than one schema is refused rather than guessed, and
   * `<file>.json` names a schema by its file alone, which {@link nameUniquely}
   * gives where the file name alone would not do. A path to the file, such as
   * `.zitadel/schemas/customers.json`, names it by its file name too.
   *
   * @param requested - The name, if any.
   * @returns The schema.
   * @throws {@link SchemaNotFoundError} When there is no schema at all, or
   *   none has the name.
   * @throws {@link AmbiguousSchemaError} When more than one schema fits, or
   *   there are several and no name is given.
   */
  resolve(requested?: string): UserSchema {
    const only = this.all[0];
    if (only === undefined) {
      throw new SchemaNotFoundError(requested, this.all);
    }
    if (requested === undefined) {
      if (this.all.length > 1) {
        throw new AmbiguousSchemaError(undefined, this.all);
      }
      return only;
    }
    const byFile = requested.endsWith(FILE_SUFFIX);
    const wanted = byFile ? basename(requested, FILE_SUFFIX) : requested;
    const matches = this.all.filter((schema) => {
      return schema.name === wanted || (!byFile && schema.objectType === wanted);
    });
    const match = matches[0];
    if (match === undefined) {
      throw new SchemaNotFoundError(wanted, this.all);
    }
    if (matches.length > 1) {
      throw new AmbiguousSchemaError(wanted, matches);
    }
    return match;
  }

  /**
   * Name a schema the way {@link resolve} picks it and no other: its file
   * name, or `<file>.json` when that name is also another schema's
   * `objectType`.
   *
   * @param schema - The schema.
   * @returns The name.
   */
  nameUniquely(schema: UserSchema): string {
    const shadowed = this.all.some((other) => {
      return other.path !== schema.path && other.objectType === schema.name;
    });
    if (shadowed) {
      return `${schema.name}${FILE_SUFFIX}`;
    }
    return schema.name;
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
   * Describe who can sign in after an edit, for the person who made it.
   *
   * @remarks
   * A method enabled that no flow offers is said with where and how to offer
   * it, naming the login flows it could go in, since flows are not
   * edited for the developer (ADR 070 §2). Enabling first and editing the flow
   * second is a normal order of work, so it warns and does not refuse.
   *
   * @param edit - The edit, made on this collection's configuration.
   * @param enabled - The method the edit enables, if any.
   * @param dryRun - Whether the edit is only previewed, so what it leaves is
   *   said as what it would leave.
   * @returns The notices.
   */
  describeSignIn(
    edit: SchemaEdit,
    enabled?: ToggleableMethod,
    dryRun: boolean = false,
  ): readonly Notice[] {
    const schema = edit.edited;
    const reachable = edit.after.schemas.listReachableMethods(schema);
    const unoffered =
      enabled === undefined || reachable.includes(enabled)
        ? []
        : [this.describeUnoffered(edit, enabled)];
    if (this.removesLastWayIn(edit)) {
      const left = dryRun ? "would be left" : "is left";
      const noWayIn: Notice = {
        severity: "warning",
        message: `${schema.name} ${left} with no way to sign in. Its users can only be managed through the API.`,
      };
      return [...unoffered, noWayIn];
    }
    if (schema.usableMethods.length > 0 && reachable.length === 0) {
      const noFlow: Notice = {
        severity: "warning",
        message: `No login flow for ${schema.name} offers a method it enables, so nobody can sign in until one does.`,
      };
      return [...unoffered, noFlow];
    }
    return unoffered;
  }

  /**
   * Describe how to offer a method an edit enabled that no login flow offers.
   *
   * @param edit - The edit, made on this collection's configuration.
   * @param enabled - The method the edit enables.
   * @returns The warning, naming the flows it could go in.
   */
  private describeUnoffered(edit: SchemaEdit, enabled: ToggleableMethod): Notice {
    const schema = edit.edited;
    const paths = edit.after.flows
      .findForSchema(schema)
      .filter((flow) => {
        return flow.servesLogin;
      })
      .map((flow) => {
        return flow.path;
      });
    const where =
      paths.length > 0 ? paths.join(" or ") : `a login flow for ${schema.name} in .zitadel/flows/`;
    const how = HOW_TO_OFFER[enabled];
    return {
      severity: "warning",
      message: `No login flow for ${schema.name} offers ${enabled} yet. In ${where}, ${how} See .zitadel/flows/README.md.`,
    };
  }

  /**
   * Whether an edit takes a schema from some way to sign in to none.
   *
   * @param edit - The edit.
   * @returns Whether it does.
   */
  removesLastWayIn(edit: SchemaEdit): boolean {
    return edit.original.usableMethods.length > 0 && edit.edited.usableMethods.length === 0;
  }
}
