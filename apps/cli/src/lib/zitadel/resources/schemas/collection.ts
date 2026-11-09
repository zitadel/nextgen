import { Change, type Notice } from "@/lib/zitadel/change";
import { Collection } from "@/lib/zitadel/resources/collection";
import { AmbiguousSchemaError, NoSignInLeftError, SchemaNotFoundError } from "@/lib/zitadel/errors";
import { assertFlowsIntact, assertMethodUnused } from "@/lib/zitadel/resources/flows/checks";
import { UserSchema } from "@/lib/zitadel/resources/schemas/schema";
import {
  type ForceOptions,
  type SchemaEdit,
  TOGGLEABLE_METHODS,
  type ToggleableMethod,
} from "@/lib/zitadel/resources/schemas/types";
import { CONFIG_DIRECTORIES, type JsonObject } from "@/lib/zitadel/types";

/**
 * What a name ends with to name a schema by its file alone.
 */
const FILE_SUFFIX = ".json";

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
   * The schema a name picks: its file name or its `objectType`, or the only
   * schema when no name is given.
   *
   * @remarks
   * A name that fits more than one schema is refused rather than guessed, and
   * `<file>.json` names a schema by its file alone, which {@link nameFor}
   * gives where the file name alone would not do.
   *
   * @param requested - The name, if any.
   * @returns The schema.
   * @throws {@link SchemaNotFoundError} When there is no schema at all, or
   *   none has the name.
   * @throws {@link AmbiguousSchemaError} When more than one schema fits, or
   *   there are several and no name is given.
   */
  named(requested?: string): UserSchema {
    if (this.all.length === 0) {
      throw new SchemaNotFoundError(requested, this.all);
    }
    if (requested === undefined) {
      const [only, ...rest] = this.all;
      if (only === undefined || rest.length > 0) {
        throw new AmbiguousSchemaError(undefined, this.all);
      }
      return only;
    }
    const byFile = requested.endsWith(FILE_SUFFIX);
    const wanted = byFile ? requested.slice(0, -FILE_SUFFIX.length) : requested;
    const matches = this.all.filter((schema) => {
      return schema.name === wanted || (!byFile && schema.objectType === wanted);
    });
    const [match, ...others] = matches;
    if (match === undefined) {
      throw new SchemaNotFoundError(wanted, this.all);
    }
    if (others.length > 0) {
      throw new AmbiguousSchemaError(wanted, matches);
    }
    return match;
  }

  /**
   * The name {@link named} picks a schema by and no other: its file name, or
   * `<file>.json` when that name is also another schema's `objectType`.
   *
   * @param schema - The schema.
   * @returns The name.
   */
  nameFor(schema: UserSchema): string {
    const shadowed = this.all.some((other) => {
      return other.path !== schema.path && other.objectType === schema.name;
    });
    if (shadowed) {
      return `${schema.name}${FILE_SUFFIX}`;
    }
    return schema.name;
  }

  /**
   * Where a schema a release pins by a handle goes: the file that holds the
   * handle, or `<handle>.json` when none does.
   *
   * @param handle - The schema's `objectType`.
   * @returns The project-relative path.
   */
  pathFor(handle: string): string {
    return this.holding(handle)?.path ?? `${CONFIG_DIRECTORIES.schemas}/${handle}.json`;
  }

  /**
   * Place a schema revision a release pinned at {@link pathFor}, replacing
   * the file there.
   *
   * @param handle - The schema's `objectType`.
   * @param body - The revision as the server answered it.
   * @returns The change; one that writes nothing when the file already holds
   *   exactly this.
   */
  revision(handle: string, body: JsonObject): Change {
    return this.placeRevision(this.pathFor(handle), body, (file) => {
      return UserSchema.create(file);
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
