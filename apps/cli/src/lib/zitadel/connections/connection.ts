import { basename } from "node:path";

import {
  type ClientIdVariable,
  type ClientSecretVariable,
  type ConnectionEndpoints,
  type ConnectionSlug,
  credentialVariables,
  type IdpProvider,
  isVariableReference,
  missingEndpoints,
  parseConnectionSlug,
  referencedVariable,
} from "@zitadel/config/idp";
import { metaSchemaFiles } from "@zitadel/config/meta-schemas";
import { idpConnectionConfigSchema } from "@zitadel/config/schemas";

import { ConfigDocument, type DocumentFile, type DocumentStatus } from "@/lib/zitadel/document";
import { type PropertyName, propertyName } from "@/lib/zitadel/names";
import type { Issue, ValidationContext } from "@/lib/zitadel/rules/types";
import type { UserSchema } from "@/lib/zitadel/schemas/schema";
import type { ConfigStore } from "@/lib/zitadel/storage/types";
import { CONFIG_DIRECTORIES, type JsonObject } from "@/lib/zitadel/types";
import { isJsonObject, objectAt, stringsIn } from "@/lib/zitadel/utils/json";
import { didYouMean } from "@/lib/zitadel/utils/spelling";

/**
 * One row of a connection's `claim_mapping` or `verified_claims`.
 */
export type ClaimRow = Readonly<{
  /**
   * The schema property the row fills or verifies.
   */
  property: PropertyName;
  /**
   * The claim as written; a well-formed file holds a string.
   */
  claim: unknown;
}>;

/**
 * A credential field that names a project variable instead of holding a value.
 */
export type VariableUse = Readonly<{
  /**
   * The credential field.
   */
  field: CredentialField;
  /**
   * The variable it names.
   */
  variable: string;
}>;

/**
 * The project variables a connection reads its credentials from.
 *
 * @remarks
 * A credential the file holds as a value names no variable, so it is
 * `undefined`: there is nothing to publish to.
 */
export type CredentialNames = Readonly<{
  /**
   * The variable the client id is read from.
   */
  clientId: ClientIdVariable | undefined;
  /**
   * The variable the client secret is read from.
   */
  clientSecret: ClientSecretVariable | undefined;
}>;

/**
 * A field of the `oidc` block that holds a credential.
 */
type CredentialField = "client_id" | "client_secret";

/**
 * The fields of the `oidc` block that hold a credential, in the order they are
 * reported.
 */
const CREDENTIAL_FIELDS: readonly CredentialField[] = ["client_id", "client_secret"];

/**
 * Where `$schema` points in a connection file this library writes.
 *
 * @remarks
 * The meta-schema `zitadel setup` writes under `.zitadel/meta/`, so an editor
 * validates the file as it is typed.
 */
export const CONNECTION_SCHEMA_REF = "../meta/idp-connection.json";

/**
 * A block of a connection whose fields the contract fixes.
 */
type CheckedBlock = Readonly<{
  /**
   * The block's path from the root, empty for the root.
   */
  path: readonly string[];
  /**
   * How a message names the block.
   */
  where: string;
}>;

/**
 * The blocks of a connection whose fields the contract fixes.
 */
const CHECKED_BLOCKS: readonly CheckedBlock[] = [
  { path: [], where: "a connection" },
  { path: ["oidc"], where: "the oidc block" },
  { path: ["provisioning"], where: "the provisioning block" },
];

/**
 * The connection contract, as the meta-schema the editor validates against
 * states it.
 */
const CONTRACT: unknown = metaSchemaFiles().find((entry) => {
  return entry.name === "idp-connection.json";
})?.body;

/**
 * An identity-provider connection under `.zitadel/idps/`: who signs people in,
 * and which of their claims fill which properties.
 */
export class Connection<Body extends JsonObject = JsonObject> extends ConfigDocument<Body> {
  /**
   * Hold a connection's body at its path.
   *
   * @param path - The project-relative path.
   * @param body - The body as written.
   * @param status - Where it stands against the file on disk.
   */
  private constructor(path: string, body: Body, status: DocumentStatus) {
    super(path, body, status);
  }

  /**
   * Take a connection as read.
   *
   * @param file - The file.
   * @returns The connection, marked as read.
   */
  static of<Body extends JsonObject>(file: DocumentFile<Body>): Connection<Body> {
    return new Connection(file.path, file.body, "read");
  }

  /**
   * A new connection, not yet written: saving it never replaces a file already
   * there.
   *
   * @param file - Where it goes, and what it holds.
   * @returns The connection, marked as created.
   */
  static create<Body extends JsonObject>(file: DocumentFile<Body>): Connection<Body> {
    return new Connection(file.path, file.body, "created");
  }

  /**
   * A new connection to a provider, from the provider's own defaults, at the
   * file its slug names.
   *
   * @remarks
   * Its claim mapping covers only the properties the schema defines.
   *
   * @param provider - The provider, from the catalog or the developer's own settings.
   * @param schema - The user schema its sign-ins fill.
   * @param endpoints - Where the provider answers, when not at its own issuer.
   * @returns The connection, marked as created.
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

  /**
   * The connection as saved: what it holds is now what the file holds.
   *
   * @returns The same connection, marked as read.
   */
  asRead(): Connection<Body> {
    return new Connection(this.path, this.body, "read");
  }

  /**
   * Everything wrong with the connection on its own.
   *
   * @remarks
   * What the connection contract refuses; a secret held as a value, which
   * would publish the credential, reported once with what to do instead of
   * again as a shape the contract does not take; an `oidc` block that names
   * some endpoints but not every one the server needs, where naming none
   * reads them from discovery; and every field the contract does not have,
   * which the client drops without a word and the server refuses.
   *
   * The SSO rules report the unknown fields only for the connection that
   * stands for its slug, so `sso/unknown-connection-field` is the one finding
   * here that {@link ZitadelConfig.validate} may leave out.
   *
   * @param _context - Unused: the connection checks need nothing beyond the file.
   * @returns The `contract/connection`, `connection/literal-secret`,
   *   `connection/endpoints` and `sso/unknown-connection-field` findings, in
   *   that order; none when the connection is sound.
   */
  problems(_context: ValidationContext): readonly Issue[] {
    const refusals = this.contractIssues("contract/connection", idpConnectionConfigSchema);
    const secret = objectAt(this.body, "oidc").client_secret;
    const literalSecret = typeof secret === "string" && !isVariableReference(secret);
    const missing = refusals.length === 0 ? missingEndpoints(this.body.oidc) : [];
    return [
      ...refusals.filter((refusal) => {
        return !(literalSecret && refusal.message.includes("client_secret"));
      }),
      ...(literalSecret
        ? [
            this.issue(
              "connection/literal-secret",
              'client_secret must reference a variable, not hold a value. Use "client_secret": "${{ NAME }}" and publish the value as that variable.',
            ),
          ]
        : []),
      ...(missing.length > 0
        ? [
            this.issue(
              "connection/endpoints",
              `oidc names some endpoints but not ${missing.join(", ")}. Name every endpoint (authorization_endpoint, jwks_uri, token_endpoint, and userinfo_endpoint unless id_token_mapping is true), or none to read them from the issuer's discovery document.`,
            ),
          ]
        : []),
      ...CHECKED_BLOCKS.flatMap((block) => {
        const allowed = allowedFields(block.path);
        const value = block.path.reduce<unknown>((node, key) => {
          return isJsonObject(node) ? node[key] : undefined;
        }, this.body);
        if (allowed.length === 0 || !isJsonObject(value)) {
          return [];
        }
        return Object.keys(value)
          .filter((key) => {
            return !allowed.includes(key);
          })
          .map((key) => {
            return this.issue(
              "sso/unknown-connection-field",
              `${JSON.stringify(key)} is not a field of ${block.where}, so it is ignored or refused.${didYouMean(key, allowed)} Fix the name, or remove it.`,
            );
          });
      }),
    ];
  }

  /**
   * The body the server receives: the connection as written.
   *
   * @param _store - Unused: a connection holds no `$file` references.
   * @returns The body without the editor-only `$schema` pointer.
   */
  wireBody(_store: ConfigStore): JsonObject {
    return this.contractBody;
  }

  /**
   * The slug the connection is known by, as written.
   *
   * @returns The slug, or `undefined` when it has none.
   */
  get slug(): string | undefined {
    return typeof this.body.slug === "string" ? this.body.slug : undefined;
  }

  /**
   * What the connection is called.
   *
   * @returns Its `slug`, or its file name without `.json` when the slug is
   *   missing or blank.
   */
  get name(): string {
    const slug = this.slug?.trim() ?? "";
    if (slug === "") {
      return basename(this.path, ".json");
    }
    return slug;
  }

  /**
   * The slug, when it is one a schema or flow can name.
   *
   * @returns The slug, or `undefined` when it is missing or malformed.
   */
  get validSlug(): ConnectionSlug | undefined {
    const parsed = parseConnectionSlug(this.slug ?? "");
    if (!parsed.ok) {
      return undefined;
    }
    return parsed.value;
  }

  /**
   * The catalog entry the connection was written from.
   *
   * @returns The entry's name, or `undefined` for a connection of the
   *   developer's own.
   */
  get template(): string | undefined {
    return typeof this.body.template === "string" ? this.body.template : undefined;
  }

  /**
   * The name shown on the sign-in button, as written.
   *
   * @returns The name, or `undefined` when it has none.
   */
  get displayName(): string | undefined {
    return typeof this.body.display_name === "string" ? this.body.display_name : undefined;
  }

  /**
   * The provider's issuer, as written.
   *
   * @returns The issuer, or `undefined` when `oidc.issuer` is not a string.
   */
  get issuer(): string | undefined {
    const issuer = objectAt(this.body, "oidc").issuer;
    return typeof issuer === "string" ? issuer : undefined;
  }

  /**
   * The client id as written.
   *
   * @returns A value or a `${{ NAME }}` reference, or `undefined` when
   *   `oidc.client_id` is not a string.
   */
  get clientId(): string | undefined {
    const value = objectAt(this.body, "oidc").client_id;
    return typeof value === "string" ? value : undefined;
  }

  /**
   * The project variables the credentials are read from.
   *
   * @remarks
   * A credential field the file leaves out reads from the variable its slug
   * derives, which is where a credential for it is published.
   *
   * @returns The client id's and client secret's variables.
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

  /**
   * The variable names {@link credentialNames} holds.
   *
   * @returns The names, client id first; none when both are held as values.
   */
  get variableNames(): readonly string[] {
    const { clientId, clientSecret } = this.credentialNames;
    return [clientId, clientSecret].filter(
      (name): name is ClientIdVariable | ClientSecretVariable => {
        return name !== undefined;
      },
    );
  }

  /**
   * Whether the provider may create users, which decides what a flow must route.
   *
   * @returns False only when `provisioning.creation` is `disabled`.
   */
  get createsUsers(): boolean {
    const provisioning = this.body.provisioning;
    return !isJsonObject(provisioning) || provisioning.creation !== "disabled";
  }

  /**
   * The rows of `claim_mapping`.
   *
   * @returns Each property and the claim that fills it, in the order written;
   *   none when there is no mapping.
   */
  get mappings(): readonly ClaimRow[] {
    return rowsOf(objectAt(this.body, "claim_mapping"));
  }

  /**
   * The rows of `verified_claims`.
   *
   * @returns Each property and the claim that verifies it, in the order
   *   written; none when nothing is verified.
   */
  get verifications(): readonly ClaimRow[] {
    return rowsOf(objectAt(this.body, "verified_claims"));
  }

  /**
   * The scopes `oidc.scopes` asks for.
   *
   * @returns The strings listed, or `undefined` when it lists none.
   */
  get scopes(): readonly string[] | undefined {
    const scopes = objectAt(this.body, "oidc").scopes;
    if (!Array.isArray(scopes)) {
      return undefined;
    }
    return stringsIn(scopes);
  }

  /**
   * The claim identity keys on.
   *
   * @returns The claim, or `undefined` when `subject_claim` names none.
   */
  get subjectClaim(): string | undefined {
    const subject = this.body.subject_claim;
    return typeof subject === "string" ? subject : undefined;
  }

  /**
   * The credential fields that name a project variable.
   *
   * @returns Each such field and its variable, client id first; none when
   *   neither names one.
   */
  get variables(): readonly VariableUse[] {
    const oidc = objectAt(this.body, "oidc");
    return CREDENTIAL_FIELDS.flatMap((field) => {
      const value = oidc[field];
      const variable = typeof value === "string" ? referencedVariable(value) : undefined;
      if (variable === undefined) {
        return [];
      }
      return [{ field, variable }];
    });
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
 * The variable a credential field reads from.
 *
 * @param value - The field as written.
 * @param fallback - The variable an absent field reads from.
 * @returns The variable it references, the fallback when the field is absent,
 *   or `undefined` when it holds a value.
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
 * @returns Each property and its claim, in the order written.
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
