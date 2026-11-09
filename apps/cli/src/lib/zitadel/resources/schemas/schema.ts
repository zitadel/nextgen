import type { ConnectionSlug } from "@zitadel/config/idp";

import { basename } from "node:path";

import { schemaConfigSchema } from "@zitadel/config/schemas";

import type { BrokenFile } from "@/lib/zitadel/resources/broken";
import {
  ConfigDocument,
  type DocumentContract,
  type DocumentFile,
  type ReadableFile,
  type DocumentStatus,
  type Edit,
} from "@/lib/zitadel/resources/document";
import { RefusedEditError } from "@/lib/zitadel/errors";
import {
  type ObjectType,
  objectType,
  type PropertyName,
  type PropertyPath,
  propertyName,
  propertyPath,
} from "@/lib/zitadel/names";
import {
  type AuthMethodsValue,
  type EnabledMethods,
  type PropertiesValue,
  type SchemaValue,
  SIGN_IN_METHODS,
  type SignInMethod,
  type ToggleableMethod,
} from "@/lib/zitadel/resources/schemas/types";
import type { ConfigStore } from "@/lib/zitadel/storage/types";
import type { JsonObject } from "@/lib/zitadel/types";
import { isJsonArray, isJsonObject, objectAt, stringsIn } from "@/lib/zitadel/utils/json";

/**
 * A user schema under `.zitadel/schemas/`: the properties a user has, and how
 * a user signs in.
 */
export class UserSchema extends ConfigDocument<JsonObject, SchemaValue> {
  /**
   * The contract a user schema is held to; a file it refuses is broken, with
   * one `contract/schema` finding per refusal.
   */
  static readonly CONTRACT: DocumentContract<typeof schemaConfigSchema> = {
    kind: "schema",
    rule: "contract/schema",
    schema: schemaConfigSchema,
  };

  /**
   * Whether a method named in a file is one a flow can offer.
   *
   * @param method - The method as written.
   * @returns Whether it is password, passkey or SSO.
   */
  static isSignInMethod(method: string): method is SignInMethod {
    return SIGN_IN_METHODS.some((known) => {
      return known === method;
    });
  }

  /**
   * What kind of document this is: a user schema.
   */
  readonly kind = "schema";

  /**
   * Hold a schema the schema contract took.
   *
   * @param file - The project-relative path and the body as written.
   * @param value - What the contract parsed the body to.
   * @param status - Where it stands against the file on disk.
   */
  private constructor(file: DocumentFile, value: SchemaValue, status: DocumentStatus) {
    super(file, value, status);
  }

  /**
   * Read a user schema file: the schema, or the broken file it is.
   *
   * @param file - The file.
   * @returns The schema, marked as read, or the broken file.
   */
  static read(file: ReadableFile): UserSchema | BrokenFile {
    return UserSchema.readFile(UserSchema.CONTRACT, file, (value, parsed) => {
      return new UserSchema(parsed, value, "read");
    });
  }

  /**
   * Take a user schema as read.
   *
   * @param file - The file.
   * @returns The schema, marked as read.
   * @throws {@link BrokenFilesError} When the schema contract refuses the body.
   */
  static of(file: DocumentFile): UserSchema {
    return UserSchema.build(file, "read");
  }

  /**
   * A new user schema, not yet written: saving it never replaces a file
   * already there.
   *
   * @param file - Where it goes, and what it holds.
   * @returns The schema, marked as created.
   * @throws {@link BrokenFilesError} When the schema contract refuses the body.
   */
  static create(file: DocumentFile): UserSchema {
    return UserSchema.build(file, "created");
  }

  /**
   * Make a user schema of a body that must pass the schema contract, as every
   * factory and edit does.
   *
   * @param file - The project-relative path and the body.
   * @param status - Where it stands against the file on disk.
   * @returns The schema.
   * @throws {@link BrokenFilesError} When the schema contract refuses the body.
   */
  private static build(file: DocumentFile, status: DocumentStatus): UserSchema {
    return new UserSchema(file, UserSchema.parseFile(UserSchema.CONTRACT, file), status);
  }

  /**
   * The schema as saved: what it holds is now what the file holds.
   *
   * @returns The same schema, marked as read.
   */
  markRead(): UserSchema {
    return new UserSchema(this.file, this.value, "read");
  }

  /**
   * The body the server receives: the schema as written.
   *
   * @param _store - Unused: a schema holds no `$file` references.
   * @returns The body without the editor-only `$schema` pointer.
   */
  toWireBody(_store: ConfigStore): JsonObject {
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
   * @remarks
   * Only a schema written out in its own file has one, and the contract
   * accepts an empty one, which names nothing.
   *
   * @returns The object type, or `undefined` for a schema that points at an
   *   external schema, or whose `objectType` is empty.
   */
  get objectType(): ObjectType | undefined {
    if (this.value.kind === "schema-url" || this.value.objectType === "") {
      return undefined;
    }
    return objectType(this.value.objectType);
  }

  /**
   * The name a release pins the schema by: its `objectType`.
   *
   * @returns The object type, or `undefined` when it has none.
   */
  override get handle(): ObjectType | undefined {
    return this.objectType;
  }

  /**
   * The property that identifies a user, which `x-identifier` designates.
   *
   * @remarks
   * The login looks a user up by it once a step collects it, and a password
   * is checked against the user it finds. The contract makes `x-identifier`
   * optional and refuses an empty one, but accepts one that is only blanks,
   * which names no property.
   *
   * @returns The property's dotted path, or `undefined` when `x-identifier`
   *   is missing or blank.
   */
  get identifier(): string | undefined {
    if (this.value.kind === "schema-url") {
      return undefined;
    }
    const identifier = this.value["x-identifier"];
    if (identifier === undefined || identifier.trim() === "") {
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
    return this.value.kind === "schema-url";
  }

  /**
   * Every method `x-auth-methods` enables.
   *
   * @returns The method names, sorted; none when nothing is enabled.
   */
  get methods(): readonly string[] {
    const enabled = Object.entries(this.authMethods)
      .filter((pair) => {
        return pair[1]?.enabled === true;
      })
      .map((pair) => {
        return pair[0];
      });
    // A fresh list, so sorting it changes nothing anyone else holds.
    return enabled.sort();
  }

  /**
   * The ways the schema's users can actually sign in.
   *
   * @remarks
   * The meta-schema accepts other methods, but nothing in a flow can use them
   * yet, and SSO counts only with at least one provider listed.
   *
   * @returns The enabled methods among password, passkey and SSO, sorted.
   */
  get usableMethods(): readonly SignInMethod[] {
    return this.methods.filter(UserSchema.isSignInMethod).filter((method) => {
      if (method === "sso") {
        return this.providers.length > 0;
      }
      return true;
    });
  }

  /**
   * Whether the schema names the property that identifies a user, which a
   * password is checked against.
   *
   * @returns True when `x-identifier` is a non-blank string.
   */
  get hasIdentifier(): boolean {
    return this.identifier !== undefined;
  }

  /**
   * Whether SSO is an enabled way to sign in.
   *
   * @returns True when `x-auth-methods.sso.enabled` is true.
   */
  get isSsoEnabled(): boolean {
    return this.enables("sso");
  }

  /**
   * The providers `x-auth-methods.sso.providers` lists, as written.
   *
   * @remarks
   * Each is a well-formed connection slug: the contract refuses a schema that
   * lists anything else.
   *
   * @returns The slugs listed, in order; none when there is no list.
   */
  get providers(): readonly string[] {
    return this.authMethods.sso?.providers ?? [];
  }

  /**
   * The ways to sign in besides SSO that the schema enables.
   *
   * @returns Whether password and passkey are each enabled.
   */
  get enabledMethods(): EnabledMethods {
    return {
      password: this.enables("password"),
      passkey: this.enables("passkey"),
    };
  }

  /**
   * The top-level properties the schema defines.
   *
   * @returns Their names, in the order written.
   */
  get propertyNames(): readonly PropertyName[] {
    return Object.keys(this.properties).map(propertyName);
  }

  /**
   * The paths of every property a user must end up with.
   *
   * @remarks
   * Each required property, through the nested `required` of each required
   * object, and the identifier when a password signs people in, because only a
   * password asks for it again. The contract keeps no `required` list, so
   * those are read from the body as written.
   *
   * @returns The dotted paths, each once.
   */
  get requiredPaths(): readonly PropertyPath[] {
    const identifier = this.identifier;
    const required = UserSchema.findRequiredWithin(this.body, undefined);
    if (!this.enabledMethods.password || identifier === undefined) {
      return [...new Set(required)];
    }
    return [...new Set([...required, propertyPath(identifier)])];
  }

  /**
   * The authentication methods the schema lists, as its contract took them.
   *
   * @remarks
   * A schema that points at an external schema holds its methods there, so
   * it lists none here.
   *
   * @returns One entry per method listed; none for an external schema.
   */
  private get authMethods(): AuthMethodsValue {
    if (this.value.kind === "schema-url") {
      return {};
    }
    return this.value["x-auth-methods"];
  }

  /**
   * The top-level properties the schema defines, as its contract took them.
   *
   * @remarks
   * The contract keeps only the keywords it knows of each property: a native
   * JSON Schema keyword such as `type` is in the body alone.
   *
   * @returns Each property by name; none for an external schema, or one that
   *   defines none.
   */
  private get properties(): PropertiesValue {
    if (this.value.kind === "schema-url") {
      return {};
    }
    return this.value.properties ?? {};
  }

  /**
   * Whether a flow's `user_schema` names this schema, by its `objectType` or
   * its `$id`.
   *
   * @remarks
   * The contract keeps no `$id`, so it is read from the body as written.
   *
   * @param reference - The flow's `user_schema`.
   * @returns Whether it names this schema.
   */
  isNamedBy(reference: string): boolean {
    const byObjectType = this.value.kind === "user-schema" && this.value.objectType === reference;
    return byObjectType || this.body.$id === reference;
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
  has(property: PropertyName): boolean {
    return Object.hasOwn(this.properties, property);
  }

  /**
   * Find the JSON types a property declares.
   *
   * @remarks
   * The contract keeps no `type`, so it is read from the body as written.
   *
   * @param property - The property's name.
   * @returns The types, or `undefined` when it declares none and so accepts
   *   anything.
   */
  findDeclaredTypes(property: PropertyName): readonly string[] | undefined {
    const definition = objectAt(objectAt(this.body, "properties"), property);
    const type = definition.type;
    if (typeof type === "string") {
      return [type];
    }
    if (isJsonArray(type) && type.length > 0) {
      return stringsIn(type);
    }
    return undefined;
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
   * @throws {@link RefusedEditError} When the schema points at an external
   *   schema, or password is switched on in a schema with no identifier.
   * @throws {@link BrokenFilesError} When the schema contract refuses the
   *   schema the edit makes.
   */
  withMethod(method: ToggleableMethod): Edit<UserSchema> {
    this.assertMethodsEditable();
    if (this.enables(method)) {
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
    const next = { ...this.writtenMethod(method), enabled: true };
    return {
      document: UserSchema.build(
        { path: this.path, body: this.bodyWithMethod(method, next) },
        this.editedStatus,
      ),
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
   * @throws {@link RefusedEditError} When the schema points at an external
   *   schema, which holds its sign-in methods at its url.
   * @throws {@link BrokenFilesError} When the schema contract refuses the
   *   schema the edit makes.
   */
  withoutMethod(method: ToggleableMethod): Edit<UserSchema> {
    this.assertMethodsEditable();
    if (!this.enables(method)) {
      return { document: this, changed: false, skipped: [] };
    }
    const next = { ...this.writtenMethod(method), enabled: false };
    return {
      document: UserSchema.build(
        { path: this.path, body: this.bodyWithMethod(method, next) },
        this.editedStatus,
      ),
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
   * @throws {@link RefusedEditError} When the schema points at an external
   *   schema, which holds its sign-in methods at its url.
   * @throws {@link BrokenFilesError} When the schema contract refuses the
   *   schema the edit makes.
   */
  withProvider(slug: ConnectionSlug): Edit<UserSchema> {
    this.assertMethodsEditable();
    const listed = this.lists(slug);
    if (this.isSsoEnabled && listed) {
      return { document: this, changed: false, skipped: [] };
    }
    const providers = listed ? this.providers : [...this.providers, slug];
    const next = { ...this.writtenMethod("sso"), enabled: true, providers };
    return {
      document: UserSchema.build(
        { path: this.path, body: this.bodyWithMethod("sso", next) },
        this.editedStatus,
      ),
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
   * @throws {@link RefusedEditError} When the schema points at an external
   *   schema, which holds its sign-in methods at its url.
   * @throws {@link BrokenFilesError} When the schema contract refuses the
   *   schema the edit makes.
   */
  withoutProvider(slug: string): Edit<UserSchema> {
    this.assertMethodsEditable();
    if (!this.lists(slug)) {
      return { document: this, changed: false, skipped: [] };
    }
    const providers = this.providers.filter((provider) => {
      return provider !== slug;
    });
    const next = this.ssoWithout(this.writtenMethod("sso"), providers);
    return {
      document: UserSchema.build(
        { path: this.path, body: this.bodyWithMethod("sso", next) },
        this.editedStatus,
      ),
      changed: true,
      skipped: [],
    };
  }

  /**
   * Refuse an edit of the sign-in methods of a schema that points at an
   * external schema, which holds them at its url: writing `x-auth-methods`
   * into the pointer file would change nothing the server reads.
   *
   * @throws {@link RefusedEditError} When the schema is external.
   */
  private assertMethodsEditable(): void {
    if (!this.isExternal) {
      return;
    }
    throw new RefusedEditError(`${this.path} points at an external schema`, {
      hint:
        "Its sign-in methods live in the schema at its url, which the server fetches. " +
        "Edit x-auth-methods there instead.",
      details: { file: this.path },
    });
  }

  /**
   * The SSO entry once some providers are left: switched off when none is,
   * because the meta-schema requires at least one provider whenever the list
   * is there.
   *
   * @param entry - The SSO entry as written.
   * @param providers - The providers left.
   * @returns The new entry.
   */
  private ssoWithout(entry: JsonObject, providers: readonly string[]): JsonObject {
    if (providers.length === 0) {
      return { enabled: false };
    }
    return { ...entry, providers };
  }

  /**
   * Whether the schema enables one authentication method.
   *
   * @param method - The method, such as `sso`.
   * @returns True when the method's `enabled` is true.
   */
  private enables(method: SignInMethod): boolean {
    return this.authMethods[method]?.enabled === true;
  }

  /**
   * One authentication method's entry as written, which an edit builds the
   * new entry from so nothing else under it is lost.
   *
   * @param method - The method, such as `sso`.
   * @returns Its entry; an empty object when the body has none.
   */
  private writtenMethod(method: SignInMethod): JsonObject {
    return objectAt(objectAt(this.body, "x-auth-methods"), method);
  }

  /**
   * The body with one method's entry replaced, and everything else as written.
   *
   * @remarks
   * A key spread over its own keeps its place, so the file's key order holds.
   * Bodies are read-only all the way down, so the new document can share what
   * it did not change with this one.
   *
   * @param method - The method.
   * @param entry - Its new entry.
   * @returns The new body.
   */
  private bodyWithMethod(method: SignInMethod, entry: JsonObject): JsonObject {
    const methods = objectAt(this.body, "x-auth-methods");
    return { ...this.body, "x-auth-methods": { ...methods, [method]: entry } };
  }

  /**
   * Find the required paths under one object of a schema: each required
   * name, and for a required object that requires names of its own, those
   * instead.
   *
   * @param node - The schema, or one of its object properties, as written.
   * @param prefix - The path to `node`, or `undefined` at the root.
   * @returns The required paths.
   */
  private static findRequiredWithin(
    node: JsonObject,
    prefix: PropertyPath | undefined,
  ): readonly PropertyPath[] {
    const properties = objectAt(node, "properties");
    return stringsIn(node.required).flatMap((name) => {
      const path = UserSchema.joinPath(prefix, name);
      const property = properties[name];
      if (!isJsonObject(property) || stringsIn(property.required).length === 0) {
        return [path];
      }
      return UserSchema.findRequiredWithin(property, path);
    });
  }

  /**
   * A property's path under the object it sits in.
   *
   * @param prefix - The path to the object, or `undefined` at the root.
   * @param name - The property's name.
   * @returns The dotted path.
   */
  private static joinPath(prefix: PropertyPath | undefined, name: string): PropertyPath {
    if (prefix === undefined) {
      return propertyPath(name);
    }
    return propertyPath(`${prefix}.${name}`);
  }
}
