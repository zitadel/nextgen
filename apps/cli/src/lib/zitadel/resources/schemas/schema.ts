import type { ConnectionSlug } from "@zitadel/config/idp";

import { basename } from "node:path";

import { schemaConfigSchema } from "@zitadel/config/schemas";

import {
  ConfigDocument,
  type DocumentFile,
  type DocumentStatus,
  type Edit,
} from "@/lib/zitadel/resources/document";
import { RefusedEditError } from "@/lib/zitadel/errors";
import { type PropertyName, propertyName } from "@/lib/zitadel/names";
import type { Issue, ValidationContext } from "@/lib/zitadel/rules/types";
import {
  type EditedMethod,
  type EnabledMethods,
  MAX_SLUG_LENGTH,
  SLUG_PATTERN,
  TOGGLEABLE_METHODS,
  type ToggleableMethod,
} from "@/lib/zitadel/resources/schemas/types";
import type { ConfigStore } from "@/lib/zitadel/storage/types";
import type { JsonObject } from "@/lib/zitadel/types";
import { isJsonObject, listAt, objectAt, stringsIn } from "@/lib/zitadel/utils/json";

/**
 * A user schema under `.zitadel/schemas/`: the properties a user has, and how
 * a user signs in.
 */
export class UserSchema<Body extends JsonObject = JsonObject> extends ConfigDocument<Body> {
  /**
   * What kind of document this is: a user schema.
   */
  readonly kind = "schema";

  /**
   * Hold a schema's body at its path.
   *
   * @param path - The project-relative path.
   * @param body - The body as written.
   * @param status - Where it stands against the file on disk.
   */
  private constructor(path: string, body: Body, status: DocumentStatus) {
    super(path, body, status);
  }

  /**
   * Take a user schema as read.
   *
   * @param file - The file.
   * @returns The schema, marked as read.
   */
  static of<Body extends JsonObject>(file: DocumentFile<Body>): UserSchema<Body> {
    return new UserSchema(file.path, file.body, "read");
  }

  /**
   * A new user schema, not yet written: saving it never replaces a file
   * already there.
   *
   * @param file - Where it goes, and what it holds.
   * @returns The schema, marked as created.
   */
  static create<Body extends JsonObject>(file: DocumentFile<Body>): UserSchema<Body> {
    return new UserSchema(file.path, file.body, "created");
  }

  /**
   * The schema as saved: what it holds is now what the file holds.
   *
   * @returns The same schema, marked as read.
   */
  asRead(): UserSchema<Body> {
    return new UserSchema(this.path, this.body, "read");
  }

  /**
   * Everything wrong with the schema on its own: what the schema contract
   * refuses.
   *
   * @param _context - Unused: the schema contract needs nothing beyond the file.
   * @returns One `contract/schema` finding per refusal; none when it conforms.
   */
  problems(_context: ValidationContext): readonly Issue[] {
    return this.contractIssues("contract/schema", schemaConfigSchema);
  }

  /**
   * The body the server receives: the schema as written.
   *
   * @param _store - Unused: a schema holds no `$file` references.
   * @returns The body without the editor-only `$schema` pointer.
   */
  wireBody(_store: ConfigStore): JsonObject {
    return this.contractBody;
  }

  /**
   * The file's name without `.json`, which `--schema` takes.
   *
   * @returns The name.
   */
  get name(): string {
    return basename(this.path, ".json");
  }

  /**
   * The `objectType`, which a flow's `user_schema` names the schema by.
   *
   * @returns The object type, or `undefined` when it is missing or empty.
   */
  get objectType(): string | undefined {
    const objectType = this.body.objectType;
    if (typeof objectType !== "string" || objectType === "") {
      return undefined;
    }
    return objectType;
  }

  /**
   * The property that identifies a user, which `x-identifier` designates.
   *
   * @remarks
   * The login looks a user up by it once a step collects it, and a password
   * is checked against the user it finds.
   *
   * @returns The property's dotted path, or `undefined` when `x-identifier`
   *   is missing, not a string, or blank.
   */
  get identifier(): string | undefined {
    const identifier = this.body["x-identifier"];
    if (typeof identifier !== "string" || identifier.trim() === "") {
      return undefined;
    }
    return identifier;
  }

  /**
   * Whether the schema points at an external schema, which holds its sign-in
   * methods there.
   *
   * @returns True for a `schema-url` schema.
   */
  get isExternal(): boolean {
    return this.body.kind === "schema-url";
  }

  /**
   * Every method `x-auth-methods` enables.
   *
   * @returns The method names, sorted; none when nothing is enabled.
   */
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
   * The ways the schema's users can actually sign in.
   *
   * @remarks
   * The meta-schema accepts other methods, but nothing in a flow can use them
   * yet, and SSO counts only with at least one well-formed provider.
   *
   * @returns The enabled methods among password, passkey and SSO, sorted.
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

  /**
   * The listed providers that are well-formed slugs.
   *
   * @remarks
   * `Not A Slug` names no connection, so nobody can sign in with it.
   *
   * @returns The providers, in the order listed.
   */
  get signInProviders(): readonly string[] {
    return this.providers.filter((provider) => {
      return provider.length <= MAX_SLUG_LENGTH && SLUG_PATTERN.test(provider);
    });
  }

  /**
   * Whether the schema names the property that identifies a user, which a
   * password is checked against.
   *
   * @returns True when `x-identifier` is a non-blank string.
   */
  get hasIdentifier(): boolean {
    const identifier = this.body["x-identifier"];
    return typeof identifier === "string" && identifier.trim() !== "";
  }

  /**
   * Whether SSO is an enabled way to sign in.
   *
   * @returns True when `x-auth-methods.sso.enabled` is true.
   */
  get ssoEnabled(): boolean {
    return this.method("sso").enabled === true;
  }

  /**
   * The providers `x-auth-methods.sso.providers` lists, as written.
   *
   * @remarks
   * A malformed slug is kept, so a rule can name it; an entry that is not a
   * string is left out.
   *
   * @returns The strings listed, in order; none when there is no list.
   */
  get providers(): readonly string[] {
    return stringsIn(this.method("sso").providers);
  }

  /**
   * The ways to sign in besides SSO that the schema enables.
   *
   * @returns Whether password and passkey are each enabled.
   */
  get enabledMethods(): EnabledMethods {
    return {
      password: this.method("password").enabled === true,
      passkey: this.method("passkey").enabled === true,
    };
  }

  /**
   * The top-level properties the schema defines.
   *
   * @returns Their names, in the order written.
   */
  get propertyNames(): readonly PropertyName[] {
    return Object.keys(objectAt(this.body, "properties")).map(propertyName);
  }

  /**
   * The paths of every property a user must end up with.
   *
   * @remarks
   * Each required property, through the nested `required` of each required
   * object, and the identifier when a password signs people in, because only a
   * password asks for it again.
   *
   * @returns The dotted paths, each once.
   */
  get requiredPaths(): readonly string[] {
    const identifier = this.body["x-identifier"];
    const signsInByIdentifier =
      this.enabledMethods.password && typeof identifier === "string" && identifier !== "";
    const paths = [...requiredWithin(this.body, ""), ...(signsInByIdentifier ? [identifier] : [])];
    return [...new Set(paths)];
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
   * mapping uses for it.
   *
   * @remarks
   * A name cannot hold a dot: a value is not addressable inside a nested
   * object, so `address.street` names nothing.
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
   * Refuse a schema whose `x-auth-methods.sso` a provider edit could not
   * write.
   *
   * @remarks
   * An absent region is written, since the schema has simply not got there
   * yet; one that holds something else was put there by hand. The meta-schema
   * requires `enabled` to be a boolean, so a missing one or a string `"true"`
   * is neither on nor off, and is refused rather than overwritten.
   * {@link withProvider} and {@link withoutProvider} check this themselves; a
   * caller checks it first only to refuse before it asks anything.
   *
   * @throws {@link RefusedEditError} When the region is not the shape the edit
   *   writes.
   */
  assertProviderEditable(): void {
    const providers = this.method("sso").providers;
    this.refuseUneditable(this.methodRefusal("sso"));
    if (providers !== undefined && !Array.isArray(providers)) {
      this.refuseUneditable("x-auth-methods.sso.providers is not a list");
    }
  }

  /**
   * The schema with a method switched on.
   *
   * @remarks
   * Only `enabled` is written: anything else under the method belongs to
   * whoever put it there.
   *
   * @param method - The method.
   * @returns The edit: the edited schema, or this one when the method is
   *   already on.
   * @throws {@link RefusedEditError} When the method's region is not the shape
   *   the edit writes, or password is switched on in a schema with no
   *   identifier.
   */
  withMethod(method: ToggleableMethod): Edit<UserSchema<Body>> {
    this.refuseUneditable(this.methodRefusal(method));
    const entry = this.method(method);
    if (entry.enabled === true) {
      return { document: this, changed: false, skipped: [] };
    }
    if (method === "password" && !this.hasIdentifier) {
      throw new RefusedEditError(`${this.path} has no x-identifier for password`, {
        hint:
          "A password is checked against the user found by the schema's identifier. " +
          'Set "x-identifier" to the property users sign in with, e.g. "email", then run the command again.',
        details: { file: this.path, method: "password" },
      });
    }
    const next = { ...entry, enabled: true };
    return {
      document: new UserSchema(this.path, this.bodyWithMethod(method, next), this.editedStatus),
      changed: true,
      skipped: [],
    };
  }

  /**
   * The schema with a method switched off.
   *
   * @remarks
   * Only `enabled` is written: anything else under the method belongs to
   * whoever put it there.
   *
   * @param method - The method.
   * @returns The edit: the edited schema, or this one when the method is
   *   already off.
   * @throws {@link RefusedEditError} When the method's region is not the shape
   *   the edit writes.
   */
  withoutMethod(method: ToggleableMethod): Edit<UserSchema<Body>> {
    this.refuseUneditable(this.methodRefusal(method));
    const entry = this.method(method);
    if (entry.enabled !== true) {
      return { document: this, changed: false, skipped: [] };
    }
    const next = { ...entry, enabled: false };
    return {
      document: new UserSchema(this.path, this.bodyWithMethod(method, next), this.editedStatus),
      changed: true,
      skipped: [],
    };
  }

  /**
   * The schema with a provider enabled.
   *
   * @remarks
   * Only `x-auth-methods.sso` is written, and the provider is added to the
   * list rather than replacing it, so enabling a second one later keeps the
   * first.
   *
   * @param slug - The provider.
   * @returns The edit: the edited schema, or this one when SSO is on and lists
   *   it.
   * @throws {@link RefusedEditError} When `x-auth-methods.sso` is not the shape
   *   the edit writes.
   */
  withProvider(slug: ConnectionSlug): Edit<UserSchema<Body>> {
    this.assertProviderEditable();
    const entry = this.method("sso");
    const listed = listAt(entry, "providers");
    if (entry.enabled === true && listed.includes(slug)) {
      return { document: this, changed: false, skipped: [] };
    }
    const providers = listed.includes(slug) ? listed : [...listed, slug];
    const next = { ...entry, enabled: true, providers };
    return {
      document: new UserSchema(this.path, this.bodyWithMethod("sso", next), this.editedStatus),
      changed: true,
      skipped: [],
    };
  }

  /**
   * The schema without a provider.
   *
   * @remarks
   * Only `x-auth-methods.sso` is written. When no provider is left, SSO
   * becomes `{ "enabled": false }`, because the meta-schema requires at least
   * one provider whenever the list is there.
   *
   * @param slug - The provider.
   * @returns The edit: the edited schema, or this one when it does not list
   *   the provider.
   * @throws {@link RefusedEditError} When `x-auth-methods.sso` is not the shape
   *   the edit writes.
   */
  withoutProvider(slug: string): Edit<UserSchema<Body>> {
    this.assertProviderEditable();
    const entry = this.method("sso");
    const listed = listAt(entry, "providers");
    if (!listed.includes(slug)) {
      return { document: this, changed: false, skipped: [] };
    }
    const providers = listed.filter((provider) => {
      return provider !== slug;
    });
    const next = providers.length === 0 ? { enabled: false } : { ...entry, providers };
    return {
      document: new UserSchema(this.path, this.bodyWithMethod("sso", next), this.editedStatus),
      changed: true,
      skipped: [],
    };
  }

  /**
   * One authentication method's settings.
   *
   * @param name - The method, such as `sso`.
   * @returns Its settings; an empty object when it has none.
   */
  private method(name: string): JsonObject {
    return objectAt(objectAt(this.body, "x-auth-methods"), name);
  }

  /**
   * Why one method's entry in `x-auth-methods` cannot be written.
   *
   * @remarks
   * Only an absent container or entry counts as empty; the meta-schema
   * requires `enabled` to be a boolean, and anything else is neither on nor
   * off.
   *
   * @param method - The method.
   * @returns The reason, or `undefined` when it can be written.
   */
  private methodRefusal(method: EditedMethod): string | undefined {
    const methods = this.body["x-auth-methods"];
    const entry = isJsonObject(methods) ? methods[method] : undefined;
    if (methods !== undefined && !isJsonObject(methods)) {
      return "x-auth-methods is not an object";
    }
    if (entry !== undefined && !isJsonObject(entry)) {
      return `x-auth-methods.${method} is not an object`;
    }
    if (entry !== undefined && typeof entry.enabled !== "boolean") {
      return `x-auth-methods.${method}.enabled is not a boolean`;
    }
    return undefined;
  }

  /**
   * The body with one method's entry replaced, and everything else as written.
   *
   * @remarks
   * A key spread over its own keeps its place, so the file's key order holds.
   * The result is a deep copy, so the new document shares nothing with this
   * one.
   *
   * @param method - The method.
   * @param entry - Its new entry.
   * @returns The new body.
   */
  private bodyWithMethod(method: EditedMethod, entry: JsonObject): Body {
    const methods = objectAt(this.body, "x-auth-methods");
    return structuredClone({ ...this.body, "x-auth-methods": { ...methods, [method]: entry } });
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
