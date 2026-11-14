import {
  type ConnectionEndpoints,
  type ConnectionSlug,
  type DisplayName,
  type IdpProvider,
  type Issuer,
  isVariableReference,
  missingEndpoints,
  type Parsed,
  parseConnectionSlug,
  parseDisplayName,
  parseIssuer,
  referencedClientIdVariable,
  referencedClientSecretVariable,
  validated,
} from "@zitadel/config/idp";
import { idpConnectionConfigSchema } from "@zitadel/config/schemas";

import {
  CHECKED_BLOCKS,
  type ClaimRow,
  CONNECTION_CONTRACT,
  CONNECTION_SCHEMA_REF,
  type ConnectionCredentials,
  type ConnectionPath,
  type ConnectionSetting,
  type ConnectionValue,
  type Credential,
  type CredentialField,
  type CredentialVariable,
} from "@/lib/zitadel/resources/connections/types";
import type { BrokenFile } from "@/lib/zitadel/resources/broken";
import {
  ConfigDocument,
  type DocumentContract,
  type DocumentFile,
  type ReadableFile,
  type DocumentStatus,
  type Edit,
} from "@/lib/zitadel/resources/document";
import {
  ClientIdMismatchError,
  NotOidcConnectionError,
  UnusableSettingError,
} from "@/lib/zitadel/errors";
import { type ClaimName, claimName, type PropertyName, propertyName } from "@/lib/zitadel/names";
import type { Issue, ValidationContext } from "@/lib/zitadel/rules/types";
import type { UserSchema } from "@/lib/zitadel/resources/schemas/schema";
import type { ConfigStore } from "@/lib/zitadel/storage/types";
import { CONFIG_DIRECTORIES, type JsonObject, type JsonValue } from "@/lib/zitadel/types";
import { isJsonObject, objectAt, stringAt, toJsonObject } from "@/lib/zitadel/utils/json";
import { isStandardScope, standardClaim } from "@/lib/zitadel/rules/claims";
import { didYouMean } from "@/lib/zitadel/utils/spelling";

/**
 * An identity-provider connection under `.zitadel/idps/`: who signs people in,
 * and which of their claims fill which properties.
 */
export class Connection extends ConfigDocument<ConnectionValue> {
  /**
   * The contract a connection is held to.
   *
   * @remarks
   * A file it refuses is broken by the `contract/connection` refusals,
   * reworded where they are about a secret held as a value, and by every field
   * the contract does not have, as {@link findIssues} reports them.
   */
  static readonly CONTRACT: DocumentContract<typeof idpConnectionConfigSchema> = {
    kind: "connection",
    rule: "contract/connection",
    schema: idpConnectionConfigSchema,
    explain: (file, refusals) => {
      return Connection.findIssues(file, refusals);
    },
  };

  /**
   * What kind of document this is: an identity-provider connection.
   */
  readonly kind = "connection";

  /**
   * The slug schemas and flows name the connection by.
   */
  readonly slug: ConnectionSlug;

  /**
   * Hold a connection the connection contract took.
   *
   * @remarks
   * The contract holds the slug to the pattern a slug is parsed against, so
   * it always parses.
   *
   * @param file - The project-relative path and the body as written.
   * @param value - What the contract parsed the body to.
   * @param status - Where it stands against the file on disk.
   */
  private constructor(file: DocumentFile, value: ConnectionValue, status: DocumentStatus) {
    super(file, value, status);
    this.slug = validated(parseConnectionSlug(value.slug));
  }

  /**
   * Read a connection file: the connection, or the broken file it is.
   *
   * @param file - The file.
   * @returns The connection, marked as read, or the broken file.
   */
  static read(file: ReadableFile): Connection | BrokenFile {
    return Connection.readFile(Connection.CONTRACT, file, (value, parsed) => {
      return new Connection(parsed, value, "read");
    });
  }

  /**
   * Take a connection as read.
   *
   * @param file - The file.
   * @returns The connection, marked as read.
   * @throws {@link BrokenFilesError} When the connection contract refuses the body.
   */
  static of(file: DocumentFile): Connection {
    return Connection.build(file, "read");
  }

  /**
   * A new connection, not yet written: saving it never replaces a file already
   * there.
   *
   * @param file - Where it goes, and what it holds.
   * @returns The connection, marked as created.
   * @throws {@link BrokenFilesError} When the connection contract refuses the body.
   */
  static create(file: DocumentFile): Connection {
    return Connection.build(file, "created");
  }

  /**
   * Make a connection of a body that must pass the connection contract, as
   * every factory and edit does.
   *
   * @param file - The project-relative path and the body.
   * @param status - Where it stands against the file on disk.
   * @returns The connection.
   * @throws {@link BrokenFilesError} When the connection contract refuses the body.
   */
  private static build(file: DocumentFile, status: DocumentStatus): Connection {
    return new Connection(file, Connection.parseFile(Connection.CONTRACT, file), status);
  }

  /**
   * A new connection to a provider, from the provider's own defaults, at the
   * file its slug names.
   *
   * @remarks
   * Its claim mapping covers only the properties the schema defines, and
   * only the standard claims the requested scopes return.
   *
   * @param provider - The provider, from the catalog or the developer's own settings.
   * @param schema - The user schema its sign-ins fill.
   * @param endpoints - Where the provider answers, when not at its own issuer.
   * @returns The connection, marked as created.
   * @throws {@link ConfigError} When the provider's document is not JSON.
   * @throws {@link BrokenFilesError} When the connection contract refuses the
   *   provider's document.
   */
  static forProvider(
    provider: IdpProvider,
    schema: UserSchema,
    endpoints?: ConnectionEndpoints,
  ): Connection {
    const generated = provider.connection({
      schemaProperties: schema.propertyNames,
      schemaRef: CONNECTION_SCHEMA_REF,
      endpoints,
    });
    const body = Connection.withoutUnrequestedClaims(
      toJsonObject(generated, `the ${provider.slug} connection`),
    );
    const path: ConnectionPath = `${CONFIG_DIRECTORIES.connections}/${provider.slug}.json`;
    return Connection.create({ path, body });
  }

  /**
   * A connection's body without the mappings of standard claims its scopes do
   * not return.
   *
   * @remarks
   * Only a list of standard scopes alone can be said to leave a claim out: a
   * scope the standard does not define may bundle claims. A mapping dropped
   * takes the property's `verified_claims` entry with it, which would have
   * nothing to verify.
   *
   * @param body - The connection's body as the provider generated it.
   * @returns The body, with those mappings removed.
   */
  private static withoutUnrequestedClaims(body: JsonObject): JsonObject {
    const scopes = objectAt(body, "oidc").scopes;
    if (!Array.isArray(scopes) || !scopes.every(isStandardScope)) {
      return body;
    }
    const returned = (claim: JsonValue | undefined): boolean => {
      const scope = standardClaim(claim)?.scope;
      return scope === undefined || scopes.includes(scope);
    };
    const mapping = objectAt(body, "claim_mapping");
    const dropped = Object.keys(mapping).filter((property) => {
      return !returned(mapping[property]);
    });
    const keep = (block: JsonObject): JsonObject => {
      return Object.fromEntries(
        Object.entries(block).filter((entry) => {
          return !dropped.includes(entry[0]);
        }),
      );
    };
    const claimMapping = isJsonObject(body.claim_mapping) ? keep(mapping) : undefined;
    const verified = isJsonObject(body.verified_claims) ? keep(body.verified_claims) : undefined;
    return {
      ...body,
      ...(claimMapping === undefined ? {} : { claim_mapping: claimMapping }),
      ...(verified === undefined ? {} : { verified_claims: verified }),
    };
  }

  /**
   * What else is wrong with the connection on its own, beyond what its
   * contract refuses.
   *
   * @remarks
   * The same findings {@link findIssues} gives a broken connection, with no
   * refusals to word: an `oidc` block that names some endpoints but not every
   * one the server needs, where naming none reads them from discovery; and
   * every field the contract does not have, which the client drops without a
   * word and the server refuses.
   *
   * {@link ZitadelConfig.validate} gets these through the connection contract
   * rule alone, which reports each finding here once, for every connection
   * file; the SSO rules do not repeat the unknown fields.
   *
   * @param _context - Unused: the connection checks need nothing beyond the file.
   * @returns The `connection/literal-secret`, `connection/endpoints` and
   *   `sso/unknown-connection-field` findings, in that order; none when the
   *   connection is sound.
   */
  override check(_context: ValidationContext): readonly Issue[] {
    return Connection.findIssues(this.file, []);
  }

  /**
   * Find everything wrong with a connection file on its own, given what the
   * connection contract refused.
   *
   * @remarks
   * A secret held as a value, which would publish the credential, is reported
   * once with what to do instead, not again as a shape the contract does not
   * take. An `oidc` block that names some endpoints but not every one is
   * judged only once the contract takes the file. Every field the contract
   * does not have is reported either way.
   *
   * @param file - The connection file.
   * @param refusals - The `contract/connection` refusals; none for a file the
   *   contract takes.
   * @returns The kept refusals, then the `connection/literal-secret`,
   *   `connection/endpoints` and `sso/unknown-connection-field` findings.
   */
  private static findIssues(file: DocumentFile, refusals: readonly Issue[]): readonly Issue[] {
    const body = file.body;
    const secret = stringAt(objectAt(body, "oidc"), "client_secret");
    const literalSecret = secret !== undefined && !isVariableReference(secret);
    const missing = refusals.length === 0 ? missingEndpoints(body.oidc) : [];
    const secretIssue = Connection.makeFileIssue(
      file.path,
      "connection/literal-secret",
      'client_secret must reference a variable, not hold a value. Use "client_secret": "${{ NAME }}" and publish the value as that variable.',
    );
    const endpointsIssue = Connection.makeFileIssue(
      file.path,
      "connection/endpoints",
      `oidc names some endpoints but not ${missing.join(", ")}. Name every endpoint (authorization_endpoint, jwks_uri, token_endpoint, and userinfo_endpoint unless id_token_mapping is true), or none to read them from the issuer's discovery document.`,
    );
    const secretIssues = literalSecret ? [secretIssue] : [];
    const endpointsIssues = missing.length > 0 ? [endpointsIssue] : [];
    const kept = refusals.filter((refusal) => {
      return !(literalSecret && refusal.message.includes("client_secret"));
    });
    const unknownFields = CHECKED_BLOCKS.flatMap((block) => {
      const allowed = Connection.readAllowedFields(block.path);
      const value = block.path.reduce<JsonValue | undefined>((node, key) => {
        if (!isJsonObject(node)) {
          return undefined;
        }
        return node[key];
      }, body);
      if (allowed.length === 0 || !isJsonObject(value)) {
        return [];
      }
      return Object.keys(value)
        .filter((key) => {
          return !allowed.includes(key);
        })
        .map((key) => {
          return Connection.makeFileIssue(
            file.path,
            "sso/unknown-connection-field",
            `${JSON.stringify(key)} is not a field of ${block.where}, so it is ignored or refused.${didYouMean(key, allowed)} Fix the name, or remove it.`,
          );
        });
    });
    return [...kept, ...secretIssues, ...endpointsIssues, ...unknownFields];
  }

  /**
   * The body the server receives: the connection as written.
   *
   * @param _store - Unused: a connection holds no `$file` references.
   * @returns The body without the editor-only `$schema` pointer.
   */
  toWireBody(_store: ConfigStore): JsonObject {
    return this.contractBody;
  }

  /**
   * The catalog entry the connection was written from.
   *
   * @returns The entry's name, or `undefined` for a connection of the
   *   developer's own.
   */
  get template(): string | undefined {
    return this.value.template;
  }

  /**
   * The name shown on the sign-in button.
   *
   * @returns The name.
   */
  get displayName(): string {
    return this.value.display_name;
  }

  /**
   * The provider's issuer.
   *
   * @returns The issuer, or `undefined` when the file has no `oidc` block.
   */
  get issuer(): string | undefined {
    return this.value.oidc?.issuer;
  }

  /**
   * The credentials, each a variable reference or a value.
   *
   * @returns The client id and client secret, or `undefined` when the file
   *   has no `oidc` block.
   */
  get credentials(): ConnectionCredentials | undefined {
    const oidc = this.value.oidc;
    if (oidc === undefined) {
      return undefined;
    }
    return {
      clientId: Connection.readCredential("client_id", oidc.client_id, referencedClientIdVariable),
      clientSecret: Connection.readCredential(
        "client_secret",
        oidc.client_secret,
        referencedClientSecretVariable,
      ),
    };
  }

  /**
   * Whether the provider may create users, which decides what a flow must route.
   *
   * @returns False only when `provisioning.creation` is `disabled`.
   */
  get createsUsers(): boolean {
    return this.value.provisioning?.creation !== "disabled";
  }

  /**
   * The rows of `claim_mapping`.
   *
   * @returns Each property and the claim that fills it, in the order written;
   *   none when there is no mapping.
   */
  get mappings(): readonly ClaimRow<string>[] {
    const mapping = this.value.claim_mapping ?? {};
    return Object.entries(mapping).map((entry) => {
      return { property: propertyName(entry[0]), claim: entry[1] };
    });
  }

  /**
   * The rows of `verified_claims`.
   *
   * @returns Each property and what verifies it, a claim's name or a fixed
   *   answer, in the order written; none when nothing is verified.
   */
  get verifications(): readonly ClaimRow[] {
    const verified = this.value.verified_claims ?? {};
    return Object.entries(verified).map((entry) => {
      return { property: propertyName(entry[0]), claim: entry[1] };
    });
  }

  /**
   * The scopes `oidc.scopes` asks for.
   *
   * @returns The scopes, or `undefined` when the file has no `oidc` block.
   */
  get scopes(): readonly string[] | undefined {
    return this.value.oidc?.scopes;
  }

  /**
   * The claim identity keys on.
   *
   * @returns The claim, or `undefined` when the file names none.
   */
  get subjectClaim(): ClaimName | undefined {
    const subject = this.value.subject_claim;
    if (subject === undefined) {
      return undefined;
    }
    return claimName(subject);
  }

  /**
   * Whether `claim_mapping` fills a property.
   *
   * @param property - The property's name.
   * @returns Whether it is mapped.
   */
  maps(property: PropertyName): boolean {
    return this.mappings.some((row) => {
      return row.property === property;
    });
  }

  /**
   * The connection pointing at other endpoints, such as a local stand-in for
   * the provider that a development run answers with.
   *
   * @remarks
   * Only the issuer is written: the engine takes a connection naming every
   * endpoint or none, and a stand-in serves its own discovery document as the
   * vendor does. A missing or blank issuer leaves the connection as it is.
   *
   * @param endpoints - Where the provider answers.
   * @returns The edit: the connection pointing at the issuer, or this one when
   *   nothing changes.
   */
  withEndpoints(endpoints: ConnectionEndpoints): Edit<Connection> {
    const issuer = endpoints.issuer;
    if (issuer === undefined || issuer === "") {
      return { document: this, changed: false, skipped: [] };
    }
    const oidc = { ...objectAt(this.body, "oidc"), issuer };
    const body = { ...this.body, oidc };
    return {
      document: Connection.build({ path: this.path, body }, this.editedStatus),
      changed: true,
      skipped: [],
    };
  }

  /**
   * The connection with a claim mapping, its verification and its scopes
   * written in.
   *
   * @remarks
   * A block the claims leave empty is removed rather than left as the provider
   * scaffolded it: what is given is what the connection ends up with.
   *
   * @param claims - The mapping from schema property to claim, how each
   *   property is verified (a claim, or `true` to trust the provider), and the
   *   scopes to request.
   * @returns The edit: the connection with the claims written in.
   * @throws {@link BrokenFilesError} When the connection contract refuses the
   *   body the edit makes.
   */
  withClaims(claims: {
    readonly mapping: Readonly<Record<string, string>>;
    readonly verified: Readonly<Record<string, string | boolean>>;
    readonly scopes: readonly string[];
  }): Edit<Connection> {
    const kept = Object.fromEntries(
      Object.entries(this.body).filter(([block]) => {
        return block !== "claim_mapping" && block !== "verified_claims";
      }),
    );
    const body = {
      ...kept,
      ...(Object.keys(claims.mapping).length > 0 ? { claim_mapping: { ...claims.mapping } } : {}),
      ...(Object.keys(claims.verified).length > 0
        ? { verified_claims: { ...claims.verified } }
        : {}),
      oidc: {
        ...Object.fromEntries(
          Object.entries(objectAt(this.body, "oidc")).filter(([key]) => {
            return key !== "scopes";
          }),
        ),
        ...(claims.scopes.length > 0 ? { scopes: [...claims.scopes] } : {}),
      },
    };
    return {
      document: Connection.build({ path: this.path, body }, this.editedStatus),
      changed: true,
      skipped: [],
    };
  }

  /**
   * List the settings the developer gave that this connection, reused in
   * place of a candidate, does not have, which reusing it does not apply.
   *
   * @param candidate - The connection the settings would have written.
   * @param given - The settings the developer gave.
   * @returns The settings not applied.
   */
  listUnappliedSettings(
    candidate: Connection,
    given: readonly ConnectionSetting[],
  ): readonly ConnectionSetting[] {
    return given.filter((setting) => {
      if (setting === "display name") {
        return this.displayName !== candidate.displayName;
      }
      const ours = this.scopes ?? [];
      const theirs = candidate.scopes ?? [];
      return ours.join(" ") !== theirs.join(" ");
    });
  }

  /**
   * Refuse a client id other than the one this connection holds as a value.
   *
   * @remarks
   * A connection that references a variable holds no id to disagree with.
   *
   * @param clientId - The client id the developer gave.
   * @throws {@link ClientIdMismatchError} When they differ.
   */
  refuseDifferentClientId(clientId: string | undefined): void {
    const existing = this.credentials?.clientId;
    if (clientId === undefined || existing === undefined || existing.kind === "variable") {
      return;
    }
    if (existing.value === clientId) {
      return;
    }
    throw new ClientIdMismatchError(this.path, existing.value, clientId);
  }

  /**
   * Refuse a connection with no issuer, which is not an OIDC connection to
   * reuse at all, whatever issuer is given.
   *
   * @throws {@link NotOidcConnectionError} When the file has no issuer.
   */
  refuseNonOidc(): void {
    if (this.issuer === undefined) {
      throw new NotOidcConnectionError(this.path, this.slug);
    }
  }

  /**
   * Read the display name, held to the rules a typed one is.
   *
   * @returns The display name.
   * @throws {@link UnusableSettingError} When the platform would not take it,
   *   naming the file.
   */
  readUsableDisplayName(): DisplayName {
    return this.readUsable("a display name", this.displayName, parseDisplayName);
  }

  /**
   * Read the issuer of an OIDC connection, held to the rules a typed one is.
   *
   * @returns The issuer.
   * @throws {@link NotOidcConnectionError} When the file has no issuer.
   * @throws {@link UnusableSettingError} When the platform would not take it,
   *   naming the file.
   */
  readUsableIssuer(): Issuer {
    const issuer = this.issuer;
    if (issuer === undefined) {
      throw new NotOidcConnectionError(this.path, this.slug);
    }
    return this.readUsable("an issuer", issuer, parseIssuer);
  }

  /**
   * Read a setting the file holds, held to the rules a typed answer is.
   *
   * @typeParam T - What a typed answer parses to.
   * @param what - How a refusal names the setting.
   * @param stored - The setting as the file holds it.
   * @param parse - The rules a typed answer is held to.
   * @returns The setting as parsed.
   * @throws {@link UnusableSettingError} When the platform would not take it.
   */
  private readUsable<T>(what: string, stored: string, parse: (value: string) => Parsed<T>): T {
    const parsed = parse(stored);
    if (!parsed.ok) {
      throw new UnusableSettingError(this.path, this.slug, what, parsed.problem);
    }
    return parsed.value;
  }

  /**
   * Read one credential field: the variable it references, or its value.
   *
   * @typeParam Field - The field.
   * @typeParam Variable - The kind of variable the field references.
   * @param field - The field.
   * @param written - The field as written.
   * @param referenced - The variable a `${{ NAME }}` reference names, branded
   *   for the field.
   * @returns The credential.
   */
  private static readCredential<Field extends CredentialField, Variable extends CredentialVariable>(
    field: Field,
    written: string,
    referenced: (value: string) => Variable | undefined,
  ): Credential<Field, Variable> {
    const variable = referenced(written);
    if (variable === undefined) {
      return { kind: "literal", field, value: written };
    }
    return { kind: "variable", field, variable };
  }

  /**
   * Read the field names the contract allows in one block, when it forbids
   * any other.
   *
   * @param path - The block's path from the root, empty for the root.
   * @returns The allowed names, or none when the block takes anything.
   */
  private static readAllowedFields(path: readonly string[]): readonly string[] {
    const level = path.reduce<JsonValue | undefined>((node, key) => {
      if (!isJsonObject(node)) {
        return undefined;
      }
      return objectAt(node, "properties")[key];
    }, CONNECTION_CONTRACT);
    if (!isJsonObject(level) || level.additionalProperties !== false) {
      return [];
    }
    return Object.keys(objectAt(level, "properties"));
  }
}
