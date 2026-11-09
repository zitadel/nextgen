import { basename } from "node:path";

import {
  type ConnectionEndpoints,
  type ConnectionSlug,
  credentialVariables,
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
} from "@zitadel/config/idp";
import { idpConnectionConfigSchema } from "@zitadel/config/schemas";

import {
  CHECKED_BLOCKS,
  type ClaimField,
  type ClaimRead,
  type ClaimRow,
  CONNECTION_CONTRACT,
  CONNECTION_SCHEMA_REF,
  type ConnectionPath,
  type ConnectionSetting,
  type ConnectionValue,
  type CredentialNames,
  type CredentialVariable,
  type GivenSettings,
  type StoredSettings,
  type VariableUse,
} from "@/lib/zitadel/resources/connections/types";
import type { BrokenFile } from "@/lib/zitadel/resources/broken";
import {
  ConfigDocument,
  type DocumentContract,
  type DocumentFile,
  type DocumentStatus,
  type Edit,
} from "@/lib/zitadel/resources/document";
import { ConfigError, ConflictError } from "@/lib/zitadel/errors";
import { type ClaimName, claimName, type PropertyName, propertyName } from "@/lib/zitadel/names";
import type { Issue, ValidationContext } from "@/lib/zitadel/rules/types";
import type { UserSchema } from "@/lib/zitadel/resources/schemas/schema";
import type { ConfigStore } from "@/lib/zitadel/storage/types";
import { CONFIG_DIRECTORIES, type JsonObject, type JsonValue } from "@/lib/zitadel/types";
import {
  isJsonArray,
  isJsonObject,
  objectAt,
  stringAt,
  stringsIn,
  toJsonObject,
} from "@/lib/zitadel/utils/json";
import { didYouMean } from "@/lib/zitadel/utils/spelling";

/**
 * The blocks whose rows name a claim.
 */
type RowBlock = Extract<ClaimField, "claim_mapping" | "verified_claims">;

/**
 * An identity-provider connection under `.zitadel/idps/`: who signs people in,
 * and which of their claims fill which properties.
 */
export class Connection<Body extends JsonObject = JsonObject> extends ConfigDocument<
  Body,
  ConnectionValue
> {
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
   * Hold a connection the connection contract took.
   *
   * @param file - The project-relative path and the body as written.
   * @param value - What the contract parsed the body to.
   * @param status - Where it stands against the file on disk.
   */
  private constructor(file: DocumentFile<Body>, value: ConnectionValue, status: DocumentStatus) {
    super(file, value, status);
  }

  /**
   * Read a connection file: the connection, or the broken file it is.
   *
   * @typeParam Body - The body's type.
   * @param file - The file.
   * @returns The connection, marked as read, or the broken file.
   */
  static read<Body extends JsonObject>(file: DocumentFile<Body>): Connection<Body> | BrokenFile {
    return Connection.readFile(Connection.CONTRACT, file, (value) => {
      return new Connection(file, value, "read");
    });
  }

  /**
   * Take a connection as read.
   *
   * @typeParam Body - The body's type.
   * @param file - The file.
   * @returns The connection, marked as read.
   * @throws {@link BrokenFilesError} When the connection contract refuses the body.
   */
  static of<Body extends JsonObject>(file: DocumentFile<Body>): Connection<Body> {
    return Connection.build(file, "read");
  }

  /**
   * A new connection, not yet written: saving it never replaces a file already
   * there.
   *
   * @typeParam Body - The body's type.
   * @param file - Where it goes, and what it holds.
   * @returns The connection, marked as created.
   * @throws {@link BrokenFilesError} When the connection contract refuses the body.
   */
  static create<Body extends JsonObject>(file: DocumentFile<Body>): Connection<Body> {
    return Connection.build(file, "created");
  }

  /**
   * Make a connection of a body that must pass the connection contract, as
   * every factory and edit does.
   *
   * @typeParam Body - The body's type.
   * @param file - The project-relative path and the body.
   * @param status - Where it stands against the file on disk.
   * @returns The connection.
   * @throws {@link BrokenFilesError} When the connection contract refuses the body.
   */
  private static build<Body extends JsonObject>(
    file: DocumentFile<Body>,
    status: DocumentStatus,
  ): Connection<Body> {
    return new Connection(file, Connection.parseFile(Connection.CONTRACT, file), status);
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
    const body = toJsonObject(generated, `the ${provider.slug} connection`);
    const path: ConnectionPath = `${CONFIG_DIRECTORIES.connections}/${provider.slug}.json`;
    return Connection.create({ path, body });
  }

  /**
   * The connection as saved: what it holds is now what the file holds.
   *
   * @returns The same connection, marked as read.
   */
  markRead(): Connection<Body> {
    return new Connection({ path: this.path, body: this.body }, this.value, "read");
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
   * The SSO rules report the unknown fields only for the connection that
   * stands for its slug, so `sso/unknown-connection-field` is the one finding
   * here that {@link ZitadelConfig.validate} may leave out.
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
   * The slug the connection is known by, as written.
   *
   * @returns The slug, or `undefined` when it has none.
   */
  get slug(): string | undefined {
    return stringAt(this.body, "slug");
  }

  /**
   * The slug as a schema or flow compares it: without surrounding space.
   *
   * @returns The trimmed slug, or `""` when it has none.
   */
  get declaredSlug(): string {
    const slug = this.slug ?? "";
    return slug.trim();
  }

  /**
   * What the connection is called.
   *
   * @returns Its `slug`, or its file name without `.json` when the slug is
   *   missing or blank.
   */
  get name(): string {
    const slug = this.declaredSlug;
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
    return stringAt(this.body, "template");
  }

  /**
   * The name shown on the sign-in button, as written.
   *
   * @returns The name, or `undefined` when it has none.
   */
  get displayName(): string | undefined {
    return stringAt(this.body, "display_name");
  }

  /**
   * The provider's issuer, as written.
   *
   * @returns The issuer, or `undefined` when `oidc.issuer` is not a string.
   */
  get issuer(): string | undefined {
    return stringAt(objectAt(this.body, "oidc"), "issuer");
  }

  /**
   * The client id as written.
   *
   * @returns A value or a `${{ NAME }}` reference, or `undefined` when
   *   `oidc.client_id` is not a string.
   */
  get clientId(): string | undefined {
    return stringAt(objectAt(this.body, "oidc"), "client_id");
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
    const clientId = Connection.readVariable(
      oidc.client_id,
      derived?.clientId,
      referencedClientIdVariable,
    );
    const clientSecret = Connection.readVariable(
      oidc.client_secret,
      derived?.clientSecret,
      referencedClientSecretVariable,
    );
    return { clientId, clientSecret };
  }

  /**
   * The variable names {@link credentialNames} holds.
   *
   * @returns The names, client id first; none when both are held as values.
   */
  get variableNames(): readonly CredentialVariable[] {
    const { clientId, clientSecret } = this.credentialNames;
    return [clientId, clientSecret].filter((name): name is CredentialVariable => {
      return name !== undefined;
    });
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
    return this.readRows("claim_mapping");
  }

  /**
   * The rows of `verified_claims`.
   *
   * @returns Each property and the claim that verifies it, in the order
   *   written; none when nothing is verified.
   */
  get verifications(): readonly ClaimRow[] {
    return this.readRows("verified_claims");
  }

  /**
   * The provider's name as a message gives it: its display name, or its slug
   * when it has none.
   *
   * @returns The name.
   */
  get providerName(): string {
    return this.displayName ?? this.name;
  }

  /**
   * The claim mappings the connection was written with: which side of each
   * line is the schema's and which the claim the provider must return, then
   * what verifies a value, which a mapping alone does not.
   *
   * @returns The summary, one line per row.
   */
  get mappingSummary(): string {
    const provider = this.providerName;
    const mappings = this.mappings.map((row) => {
      return `  ${row.property} ← ${String(row.claim)}`;
    });
    const verifications = this.verifications.map((row) => {
      if (row.claim === true) {
        return `  ${row.property} is treated as verified.`;
      }
      return `  ${row.property} is treated as verified only when ${provider} says so in the ${String(row.claim)} claim.`;
    });
    const verification =
      verifications.length === 0
        ? ["Nothing is treated as verified."]
        : ["Verification, which a mapping alone does not give:", ...verifications];
    return [
      `Claim mappings in ${this.path}. Each line is an attribute of your user schema, then the claim ${provider} must return for it:`,
      ...mappings,
      ...verification,
      "Edit the mappings in that file if your provider returns other claims.",
    ].join("\n");
  }

  /**
   * The claims the connection reads, by name: its mappings, then its
   * verifications, as long as the claim is written as a name.
   *
   * @returns Each claim and the block it is read in.
   */
  get claimReads(): readonly ClaimRead[] {
    const blocks = [
      { field: "claim_mapping", rows: this.mappings },
      { field: "verified_claims", rows: this.verifications },
    ] as const;
    return blocks.flatMap((block) => {
      return block.rows.flatMap((row): readonly ClaimRead[] => {
        if (typeof row.claim !== "string") {
          return [];
        }
        return [{ field: block.field, claim: claimName(row.claim) }];
      });
    });
  }

  /**
   * The scopes `oidc.scopes` asks for.
   *
   * @returns The strings listed, or `undefined` when it lists none.
   */
  get scopes(): readonly string[] | undefined {
    const scopes = objectAt(this.body, "oidc").scopes;
    if (!isJsonArray(scopes)) {
      return undefined;
    }
    return stringsIn(scopes);
  }

  /**
   * The claim identity keys on.
   *
   * @returns The claim, or `undefined` when `subject_claim` names none.
   */
  get subjectClaim(): ClaimName | undefined {
    const subject = stringAt(this.body, "subject_claim");
    if (subject === undefined) {
      return undefined;
    }
    return claimName(subject);
  }

  /**
   * The credential fields that name a project variable.
   *
   * @returns Each such field and its variable, client id first; none when
   *   neither names one.
   */
  get variables(): readonly VariableUse[] {
    const oidc = objectAt(this.body, "oidc");
    const clientId = stringAt(oidc, "client_id");
    const clientSecret = stringAt(oidc, "client_secret");
    const idVariable = clientId === undefined ? undefined : referencedClientIdVariable(clientId);
    const secretVariable =
      clientSecret === undefined ? undefined : referencedClientSecretVariable(clientSecret);
    const idUses: readonly VariableUse[] =
      idVariable === undefined ? [] : [{ field: "client_id", variable: idVariable }];
    const secretUses: readonly VariableUse[] =
      secretVariable === undefined ? [] : [{ field: "client_secret", variable: secretVariable }];
    return [...idUses, ...secretUses];
  }

  /**
   * Whether the connection's `slug` is this one, ignoring surrounding space.
   *
   * @param slug - The slug, as written or typed.
   * @returns Whether it declares it.
   */
  declares(slug: string): boolean {
    return this.declaredSlug === slug;
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
   * Read the settings this file holds that a run reusing the connection takes
   * instead of asking for them, each held to the rules a typed answer is.
   *
   * @remarks
   * A setting the run was given is not read at all, so a stored value it
   * replaces is never refused. Scopes are left out: reusing a connection never
   * applies them.
   *
   * @param given - The settings the run was given.
   * @returns Each stored setting the run uses; `undefined` for one it was
   *   given or the file does not hold.
   * @throws {@link ConflictError} When the file has no issuer, so it is not an
   *   OIDC connection to reuse at all, whatever issuer is given.
   * @throws {@link ConfigError} When a stored setting the run would use cannot
   *   be used, naming the file.
   */
  readStoredSettings(given: GivenSettings): StoredSettings {
    const issuer = this.issuer;
    if (issuer === undefined) {
      throw new ConflictError(
        `${this.path} is already named ${this.name} and is not an OIDC connection`,
        {
          hint: "Fix the file, or choose another slug, then run the command again.",
          details: { file: this.path, slug: this.name },
        },
      );
    }
    const displayName: DisplayName | undefined = this.readUsableSetting(
      "a display name",
      this.displayName,
      given.displayName,
      parseDisplayName,
    );
    const storedIssuer: Issuer | undefined = this.readUsableSetting(
      "an issuer",
      issuer,
      given.issuer,
      parseIssuer,
    );
    return { displayName, issuer: storedIssuer };
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
  withEndpoints(endpoints: ConnectionEndpoints): Edit<Connection<Body>> {
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
   * @throws {@link ConfigError} When they differ.
   */
  refuseDifferentClientId(clientId: string | undefined): void {
    const existing = this.clientId;
    if (
      clientId === undefined ||
      existing === undefined ||
      isVariableReference(existing) ||
      existing === clientId
    ) {
      return;
    }
    throw new ConfigError(`${this.path} already uses client id ${existing}, not ${clientId}`, {
      hint: "Edit the connection file to change its client id, or run the command without one to reuse it.",
      details: { file: this.path, stored_client_id: existing, supplied_client_id: clientId },
    });
  }

  /**
   * Read a setting the file holds, when a run reusing the connection uses it.
   *
   * @typeParam T - What a typed answer parses to.
   * @param what - How a refusal names the setting.
   * @param stored - The setting as the file holds it.
   * @param given - The setting as the run was given it, which replaces the file's.
   * @param parse - The rules a typed answer is held to.
   * @returns The stored setting as parsed, or `undefined` when the run was
   *   given one or the file holds none.
   * @throws {@link ConfigError} When the stored setting cannot be used.
   */
  private readUsableSetting<T>(
    what: string,
    stored: string | undefined,
    given: string | undefined,
    parse: (value: string) => Parsed<T>,
  ): T | undefined {
    if (given !== undefined || stored === undefined) {
      return undefined;
    }
    const parsed = parse(stored);
    if (!parsed.ok) {
      throw new ConfigError(`${this.path} holds ${what} that cannot be used: ${parsed.problem}`, {
        hint: "Fix it in that file, or choose another slug.",
        details: { file: this.path, slug: this.name },
      });
    }
    return parsed.value;
  }

  /**
   * Read the rows of a mapping block.
   *
   * @param block - `claim_mapping` or `verified_claims`.
   * @returns Each property and its claim, in the order written; none when the
   *   block is absent.
   */
  private readRows(block: RowBlock): readonly ClaimRow[] {
    return Object.entries(objectAt(this.body, block)).flatMap((entry): readonly ClaimRow[] => {
      const claim = entry[1];
      // A member that is absent is no row.
      if (claim === undefined) {
        return [];
      }
      return [{ property: propertyName(entry[0]), claim }];
    });
  }

  /**
   * Read the variable a credential field reads from.
   *
   * @typeParam V - The kind of variable the field names.
   * @param value - The field as written.
   * @param fallback - The variable an absent field reads from.
   * @param referenced - The variable a `${{ NAME }}` reference names, branded
   *   for the field.
   * @returns The variable it references, the fallback when the field is absent,
   *   or `undefined` when it holds a value.
   */
  private static readVariable<V extends CredentialVariable>(
    value: JsonValue | undefined,
    fallback: V | undefined,
    referenced: (value: string) => V | undefined,
  ): V | undefined {
    if (value === undefined) {
      return fallback;
    }
    if (typeof value !== "string") {
      return undefined;
    }
    return referenced(value);
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
