import { basename } from "node:path";

import {
  type ClientIdVariable,
  type ClientSecretVariable,
  type ConnectionEndpoints,
  type ConnectionSlug,
  credentialVariables,
  type IdpProvider,
  parseConnectionSlug,
  referencedVariable,
} from "@zitadel/config/idp";
import { metaSchemaFiles } from "@zitadel/config/meta-schemas";

import { ConfigDocument, type DocumentStatus } from "@/lib/zitadel/document";
import { type PropertyName, propertyName } from "@/lib/zitadel/names";
import type { UserSchema } from "@/lib/zitadel/schemas/schema";
import { CONFIG_DIRECTORIES, type ConfigFile, type JsonObject } from "@/lib/zitadel/types";
import { isJsonObject, objectAt, stringsIn } from "@/lib/zitadel/utils/json";

/** One row of a connection's `claim_mapping` or `verified_claims`. */
export type ClaimRow = Readonly<{
  property: PropertyName;
  /** The claim as written; a well-formed file holds a string. */
  claim: unknown;
}>;

/** A credential field that names a project variable instead of holding a value. */
export type VariableUse = Readonly<{
  field: "client_id" | "client_secret";
  variable: string;
}>;

/**
 * The project variables a connection reads its credentials from. A credential
 * the file holds as a value names no variable, so it is `undefined`: there is
 * nothing to publish to.
 */
export type CredentialNames = Readonly<{
  clientId: ClientIdVariable | undefined;
  clientSecret: ClientSecretVariable | undefined;
}>;

/**
 * Where `$schema` points in a connection file this library writes: the
 * meta-schema `zitadel setup` writes under `.zitadel/meta/`, so an editor
 * validates the file as it is typed.
 */
export const CONNECTION_SCHEMA_REF = "../meta/idp-connection.json";

/** A field the connection contract does not have. */
export type UnknownField = Readonly<{
  /** Where it is: `a connection`, or `the oidc block`. */
  where: string;
  key: string;
  /** The fields that are allowed there. */
  allowed: readonly string[];
}>;

/** The blocks of a connection whose fields the contract fixes, and how a message names each. */
const CHECKED_BLOCKS = [
  { path: [], where: "a connection" },
  { path: ["oidc"], where: "the oidc block" },
  { path: ["provisioning"], where: "the provisioning block" },
] as const;

/** The connection contract, as the meta-schema the editor validates against states it. */
const CONTRACT: unknown = metaSchemaFiles().find((entry) => {
  return entry.name === "idp-connection.json";
})?.body;

/**
 * An identity-provider connection under `.zitadel/idps/`: who signs people in,
 * and which of their claims fill which properties.
 */
export class Connection extends ConfigDocument {
  private constructor(path: string, body: JsonObject, status: DocumentStatus) {
    super(path, body, status);
  }

  /**
   * Take a connection as read.
   *
   * @param file - The file.
   * @returns The connection.
   */
  static of(file: ConfigFile): Connection {
    return new Connection(file.path, file.body, "read");
  }

  /**
   * The document as saved: what it holds is now what the file holds.
   *
   * @returns The document, marked as read.
   */
  asRead(): Connection {
    return new Connection(this.path, this.body, "read");
  }

  /**
   * A new connection file, not yet written: saving it never replaces a file
   * already there.
   *
   * @param file - Where it goes, and what it holds.
   * @returns The connection.
   */
  static create(file: ConfigFile): Connection {
    return new Connection(file.path, file.body, "created");
  }

  /**
   * A new connection to a provider, from the provider's own defaults, at the
   * file its slug names. Its claim mapping covers only the properties the
   * schema defines.
   *
   * @param provider - The provider, from the catalog or the developer's own settings.
   * @param schema - The user schema its sign-ins fill.
   * @param endpoints - Where the provider answers, when not at its own issuer.
   * @returns The connection, not yet written.
   */
  static forProvider(
    provider: IdpProvider,
    schema: UserSchema,
    endpoints?: ConnectionEndpoints,
  ): Connection {
    const body = provider.connection({
      schemaProperties: schema.propertyNames,
      schemaRef: CONNECTION_SCHEMA_REF,
      endpoints,
    });
    return Connection.create({
      path: `${CONFIG_DIRECTORIES.connections}/${provider.slug}.json`,
      body,
    });
  }

  /** The slug the connection is known by, as written, or `undefined` when it has none. */
  get slug(): string | undefined {
    return typeof this.body.slug === "string" ? this.body.slug : undefined;
  }

  /** What the connection is called: its `slug`, or its file name when it has none. */
  get name(): string {
    const slug = this.slug?.trim() ?? "";
    if (slug === "") {
      return basename(this.path, ".json");
    }
    return slug;
  }

  /** The slug, when it is one a schema or flow can name; `undefined` when it is missing or malformed. */
  get validSlug(): ConnectionSlug | undefined {
    const parsed = parseConnectionSlug(this.slug ?? "");
    if (!parsed.ok) {
      return undefined;
    }
    return parsed.value;
  }

  /** The catalog entry the connection was written from, or `undefined` for a connection of the developer's own. */
  get template(): string | undefined {
    return typeof this.body.template === "string" ? this.body.template : undefined;
  }

  /** The name shown on the sign-in button, as written. */
  get displayName(): string | undefined {
    return typeof this.body.display_name === "string" ? this.body.display_name : undefined;
  }

  /** The provider's issuer, as written. */
  get issuer(): string | undefined {
    const issuer = objectAt(this.body, "oidc").issuer;
    return typeof issuer === "string" ? issuer : undefined;
  }

  /** The client id as written: a value, or a `${{ NAME }}` reference. */
  get clientId(): string | undefined {
    const value = objectAt(this.body, "oidc").client_id;
    return typeof value === "string" ? value : undefined;
  }

  /**
   * The project variables the credentials are read from. A credential field
   * the file leaves out reads from the variable its slug derives, which is
   * where a credential for it is published.
   */
  get credentialNames(): CredentialNames {
    const slug = this.validSlug;
    const derived = slug === undefined ? undefined : credentialVariables(slug);
    const oidc = objectAt(this.body, "oidc");
    return {
      clientId: variableOf(oidc.client_id, derived?.clientId),
      clientSecret: variableOf(oidc.client_secret, derived?.clientSecret),
    };
  }

  /** The variable names {@link credentialNames} holds. */
  get variableNames(): readonly string[] {
    const { clientId, clientSecret } = this.credentialNames;
    return [clientId, clientSecret].filter(
      (name): name is ClientIdVariable | ClientSecretVariable => {
        return name !== undefined;
      },
    );
  }

  /**
   * Whether the connection's `slug` is this one, ignoring surrounding space.
   *
   * @param slug - The slug.
   * @returns Whether it declares it.
   */
  declares(slug: string): boolean {
    return (this.slug ?? "").trim() === slug;
  }

  /** Whether the provider may create users, which decides what a flow must route. */
  get createsUsers(): boolean {
    const provisioning = this.body.provisioning;
    return !isJsonObject(provisioning) || provisioning.creation !== "disabled";
  }

  /** The rows of `claim_mapping`: each property and the claim that fills it. */
  get mappings(): readonly ClaimRow[] {
    return rowsOf(objectAt(this.body, "claim_mapping"));
  }

  /** The rows of `verified_claims`: each property and the claim that verifies it. */
  get verifications(): readonly ClaimRow[] {
    return rowsOf(objectAt(this.body, "verified_claims"));
  }

  /** The scopes `oidc.scopes` asks for, or `undefined` when it lists none. */
  get scopes(): readonly string[] | undefined {
    const scopes = objectAt(this.body, "oidc").scopes;
    if (!Array.isArray(scopes)) {
      return undefined;
    }
    return stringsIn(scopes);
  }

  /** The claim identity keys on, or `undefined` when it names none. */
  get subjectClaim(): string | undefined {
    const subject = this.body.subject_claim;
    return typeof subject === "string" ? subject : undefined;
  }

  /** The credential fields that name a project variable. */
  get variables(): readonly VariableUse[] {
    const oidc = objectAt(this.body, "oidc");
    return (["client_id", "client_secret"] as const).flatMap((field) => {
      const value = oidc[field];
      const variable = typeof value === "string" ? referencedVariable(value) : undefined;
      if (variable === undefined) {
        return [];
      }
      return [{ field, variable }];
    });
  }

  /**
   * The fields the contract does not have, which the client drops without a
   * word and the server refuses.
   */
  get unknownFields(): readonly UnknownField[] {
    return CHECKED_BLOCKS.flatMap((block) => {
      const allowed = allowedFields(block.path);
      const value = block.path.length === 0 ? this.body : this.body[block.path[0]];
      if (allowed.length === 0 || !isJsonObject(value)) {
        return [];
      }
      return Object.keys(value)
        .filter((key) => {
          return !allowed.includes(key);
        })
        .map((key) => {
          return { where: block.where, key, allowed };
        });
    });
  }

  /**
   * Whether `claim_mapping` fills a property.
   *
   * @param property - The property's name.
   * @returns Whether it is mapped.
   */
  maps(property: string): boolean {
    return this.mappings.some((row) => {
      return row.property === property;
    });
  }
}

/**
 * The variable a credential field reads from: the one it references, the
 * fallback when the field is absent, or `undefined` when it holds a value.
 *
 * @param value - The field as written.
 * @param fallback - The variable an absent field reads from.
 * @returns The variable.
 */
function variableOf<V extends string>(value: unknown, fallback: V | undefined): V | undefined {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  // Whatever a client_id field references is a client id's variable, whatever
  // it is called, which is what the brand records.
  return referencedVariable(value) as V | undefined;
}

/**
 * The rows of a mapping block.
 *
 * @param block - `claim_mapping` or `verified_claims`.
 * @returns Each property and its claim.
 */
function rowsOf(block: JsonObject): ClaimRow[] {
  return Object.entries(block).map(([property, claim]) => {
    return { property: propertyName(property), claim };
  });
}

/**
 * The field names the contract allows in one block, when it forbids any other.
 *
 * @param path - The block's path from the root, empty for the root.
 * @returns The allowed names, or none when the block takes anything.
 */
function allowedFields(path: readonly string[]): readonly string[] {
  const level = path.reduce<unknown>((node, key) => {
    if (!isJsonObject(node)) {
      return undefined;
    }
    return objectAt(node, "properties")[key];
  }, CONTRACT);
  if (!isJsonObject(level) || level.additionalProperties !== false) {
    return [];
  }
  return Object.keys(objectAt(level, "properties"));
}
