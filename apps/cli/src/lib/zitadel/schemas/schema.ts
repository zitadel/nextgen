	import type { ConnectionSlug } from "@zitadel/config/idp";

import { basename } from "node:path";

import { ConfigDocument, type DocumentStatus } from "@/lib/zitadel/document";
import { addSsoToSchema, removeSsoFromSchema, schemaEditRefusal } from "@/lib/zitadel/schemas/sso";
import { RefusedEditError } from "@/lib/zitadel/errors";
import { type PropertyName, propertyName } from "@/lib/zitadel/names";
import { type EnabledMethods, TOGGLEABLE_METHODS, type ToggleableMethod } from "@/lib/zitadel/schemas/types";
import type { JsonObject } from "@/lib/zitadel/types";
import { isJsonObject, objectAt, stringsIn } from "@/lib/zitadel/utils/json";

/**
 * A user schema under `.zitadel/schemas/`: the properties a user has, and how
 * a user signs in.
 */
export class UserSchema<Body extends JsonObject = JsonObject> extends ConfigDocument<Body> {
  private constructor(path: string, body: Body, status: DocumentStatus) {
    super(path, body, status);
  }

  /**
   * Take a user schema as read.
   *
   * @param file - The file.
   * @returns The schema.
   */
  static of<Body extends JsonObject>(
    file: Readonly<{ path: string; body: Body }>,
  ): UserSchema<Body> {
    return new UserSchema(file.path, file.body, "read");
  }

  /**
   * A new file, not yet written: saving it never replaces a file already there.
   *
   * @param file - Where it goes, and what it holds.
   * @returns The document.
   */
  static create<Body extends JsonObject>(
    file: Readonly<{ path: string; body: Body }>,
  ): UserSchema<Body> {
    return new UserSchema(file.path, file.body, "created");
  }

  /**
   * The document as saved: what it holds is now what the file holds.
   *
   * @returns The document, marked as read.
   */
  asRead(): UserSchema<Body> {
    return new UserSchema(this.path, this.body, "read");
  }

  /**
   * Whether a flow's `user_schema` names this schema, by its `objectType` or
   * its `$id`.
   *
   * @param reference - The flow's `user_schema`.
   * @returns Whether it names this schema.
   */
  isNamedBy(reference: string): boolean {
    return this.body.objectType === reference || this.body.$id === reference;
  }

  /** The file's name without `.json`, which `--schema` takes. */
  get name(): string {
    return basename(this.path, ".json");
  }

  /** The `objectType`, which a flow's `user_schema` names it by, or `undefined`. */
  get objectType(): string | undefined {
    const objectType = this.body.objectType;
    if (typeof objectType !== "string" || objectType === "") {
      return undefined;
    }
    return objectType;
  }

  /** Whether the schema points at an external schema, which holds its sign-in methods there. */
  get isExternal(): boolean {
    return this.body.kind === "schema-url";
  }

  /** Every method `x-auth-methods` enables, sorted. */
  get methods(): readonly string[] {
    return Object.entries(objectAt(this.body, "x-auth-methods"))
      .filter(([, value]) => {
        return isJsonObject(value) && value.enabled === true;
      })
      .map(([name]) => {
        return name;
      })
      .sort();
  }

  /**
   * The ways the schema's users can actually sign in: password, passkey, and
   * SSO with at least one well-formed provider. The meta-schema accepts other
   * methods, but nothing in a flow can use them yet.
   */
  get usableMethods(): readonly string[] {
    const toggleable: readonly string[] = TOGGLEABLE_METHODS;
    return this.methods.filter((method) => {
      if (method === "sso") {
        return this.signInProviders.length > 0;
      }
      return toggleable.includes(method);
    });
  }

  /** The listed providers that are well-formed slugs: `Not A Slug` names no connection. */
  get signInProviders(): readonly string[] {
    return this.providers.filter((provider) => {
      return provider.length <= 64 && /^[a-z0-9][a-z0-9_-]*$/.test(provider);
    });
  }

  /**
   * Whether the schema names the property that identifies a user, which a
   * password is checked against.
   */
  get hasIdentifier(): boolean {
    const identifier = this.body["x-identifier"];
    return typeof identifier === "string" && identifier.trim() !== "";
  }

  /** Whether SSO is an enabled way to sign in. */
  get ssoEnabled(): boolean {
    return this.method("sso").enabled === true;
  }

  /** The providers `x-auth-methods.sso.providers` lists, as written. */
  get providers(): readonly string[] {
    return stringsIn(this.method("sso").providers);
  }

  /** The providers listed more than once. */
  get repeatedProviders(): readonly string[] {
    const providers = this.providers;
    return [
      ...new Set(
        providers.filter((provider, index) => {
          return providers.indexOf(provider) !== index;
        }),
      ),
    ];
  }

  /** The ways to sign in besides SSO that the schema enables. */
  get enabledMethods(): EnabledMethods {
    return {
      password: this.method("password").enabled === true,
      passkey: this.method("passkey").enabled === true,
    };
  }

  /** The top-level properties the schema defines. */
  get propertyNames(): readonly PropertyName[] {
    return Object.keys(objectAt(this.body, "properties")).map(propertyName);
  }

  /**
   * The paths of every property a user must end up with: each required
   * property, through the nested `required` of each required object, and the
   * identifier when a password signs people in, because only a password asks
   * for it again.
   */
  get requiredPaths(): readonly string[] {
    const identifier = this.body["x-identifier"];
    const signsInByIdentifier =
      this.enabledMethods.password && typeof identifier === "string" && identifier !== "";
    const paths = [...requiredWithin(this.body, ""), ...(signsInByIdentifier ? [identifier] : [])];
    return [...new Set(paths)];
  }

  /**
   * Whether `x-auth-methods.sso.providers` lists a provider.
   *
   * @param slug - The provider.
   * @returns Whether it is listed.
   */
  lists(slug: string): boolean {
    return this.providers.includes(slug);
  }

  /**
   * Whether the schema defines a top-level property, by the name a claim
   * mapping uses for it. A name cannot hold a dot: a value is not addressable
   * inside a nested object, so `address.street` names nothing.
   *
   * @param property - The property's name.
   * @returns Whether it is defined.
   */
  has(property: string): boolean {
    return Object.hasOwn(objectAt(this.body, "properties"), property);
  }

  /**
   * The JSON types a property declares.
   *
   * @param property - The property's name.
   * @returns The types, or `undefined` when it declares none and so accepts
   *   anything.
   */
  declaredTypes(property: string): readonly string[] | undefined {
    const definition = objectAt(this.body, "properties")[property];
    const type = isJsonObject(definition) ? definition.type : undefined;
    if (typeof type === "string") {
      return [type];
    }
    if (Array.isArray(type) && type.length > 0) {
      return stringsIn(type);
    }
    return undefined;
  }

  /**
   * The schema with a method switched on or off. Only `enabled` is written:
   * anything else under the method belongs to whoever put it there.
   *
   * @param method - The method.
   * @param enabled - The state to put it in.
   * @returns The edited schema, or this one when it is already in that state.
   * @throws {@link RefusedEditError} When the region is not the shape this
   *   edits, or password is enabled on a schema with no identifier.
   */
  withMethod(method: ToggleableMethod, enabled: boolean): UserSchema<Body> {
    this.refuseUneditable(this.methodRefusal(method));
    const methods = objectAt(this.body, "x-auth-methods");
    const entry = objectAt(methods, method);
    if ((entry.enabled === true) === enabled) {
      return this;
    }
    if (enabled && method === "password" && !this.hasIdentifier) {
      throw new RefusedEditError(`${this.path} has no x-identifier for password`, {
        hint:
          "A password is checked against the user found by the schema's identifier. " +
          'Set "x-identifier" to the property users sign in with, e.g. "email", then run the command again.',
        details: { file: this.path, method: "password" },
      });
    }
    return new UserSchema(
      this.path,
      { ...this.body, "x-auth-methods": { ...methods, [method]: { ...entry, enabled } } },
      this.editedStatus,
    );
  }

  /**
   * Refuse an edit to a region that is not the shape the edit writes: it was
   * written by hand, and rewriting it would discard it.
   *
   * @param region - What is wrong with it, or `undefined` when nothing is.
   * @throws {@link RefusedEditError} Naming the file and the region.
   */
  refuseUneditable(region: string | undefined): void {
    if (region === undefined) {
      return;
    }
    throw new RefusedEditError(`${this.path}: ${region}`, {
      hint:
        "This command edits that region, and it is not the shape it edits. " +
        "Fix it against the dialect in .zitadel/meta/, then run the command again.",
      details: { file: this.path, region },
    });
  }

  /**
   * Why `x-auth-methods` cannot be edited for one method. Only an absent
   * container or entry counts as empty; the meta-schema requires `enabled` to
   * be a boolean, and anything else is neither on nor off.
   *
   * @param method - The method.
   * @returns The reason, or `undefined` when it can.
   */
  private methodRefusal(method: ToggleableMethod): string | undefined {
    const methods = this.body["x-auth-methods"];
    if (methods === undefined) {
      return undefined;
    }
    if (!isJsonObject(methods)) {
      return "x-auth-methods is not an object";
    }
    const entry = methods[method];
    if (entry === undefined) {
      return undefined;
    }
    if (!isJsonObject(entry)) {
      return `x-auth-methods.${method} is not an object`;
    }
    if (typeof entry.enabled !== "boolean") {
      return `x-auth-methods.${method}.enabled is not a boolean`;
    }
    return undefined;
  }

  /**
   * Why the schema cannot be edited to offer a provider.
   *
   * @returns The reason, or `undefined` when it can.
   */
  editRefusal(): string | undefined {
    return schemaEditRefusal(this.body);
  }

  /**
   * The schema with a provider enabled.
   *
   * @param slug - The provider.
   * @returns The edited schema, or this one when it already offers it.
   */
  withProvider(slug: ConnectionSlug): UserSchema<Body> {
    this.refuseUneditable(this.editRefusal());
    const result = addSsoToSchema(this.body, slug);
    if (!result.changed) {
      return this;
    }
    return new UserSchema(this.path, { ...this.body, ...result.body }, this.editedStatus);
  }

  /**
   * The schema without a provider.
   *
   * @param slug - The provider.
   * @returns The edited schema, or this one when it does not offer it.
   */
  withoutProvider(slug: string): UserSchema<Body> {
    this.refuseUneditable(this.editRefusal());
    const result = removeSsoFromSchema(this.body, slug);
    if (!result.changed) {
      return this;
    }
    return new UserSchema(this.path, { ...this.body, ...result.body }, this.editedStatus);
  }

  /**
   * One authentication method's settings.
   *
   * @param name - The method, such as `sso`.
   * @returns Its settings, or none when it has none.
   */
  private method(name: string): JsonObject {
    return objectAt(objectAt(this.body, "x-auth-methods"), name);
  }
}

/**
 * The required paths under one object of a schema: each required name, and
 * for a required object that requires names of its own, those instead.
 *
 * @param node - The schema, or one of its object properties.
 * @param prefix - The path to `node`, empty at the root.
 * @returns The required paths.
 */
function requiredWithin(node: JsonObject, prefix: string): string[] {
  const properties = objectAt(node, "properties");
  return stringsIn(node.required).flatMap((name) => {
    const path = prefix === "" ? name : `${prefix}.${name}`;
    const property = properties[name];
    if (!isJsonObject(property) || stringsIn(property.required).length === 0) {
      return [path];
    }
    return requiredWithin(property, path);
  });
}
