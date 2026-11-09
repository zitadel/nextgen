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
  type Parsed,
  parseConnectionSlug,
  parseDisplayName,
  parseIssuer,
  referencedVariable,
} from "@zitadel/config/idp";
import { idpConnectionConfigSchema } from "@zitadel/config/schemas";

import {
  CHECKED_BLOCKS,
  type ClaimRead,
  type ClaimRow,
  CONNECTION_CONTRACT,
  CONNECTION_SCHEMA_REF,
  type ConnectionSetting,
  CREDENTIAL_FIELDS,
  type CredentialNames,
  type StoredSettings,
  type VariableUse,
} from "@/lib/zitadel/resources/connections/types";
import {
  ConfigDocument,
  type DocumentFile,
  type DocumentStatus,
  type Edit,
} from "@/lib/zitadel/resources/document";
import { ConfigError, ConflictError } from "@/lib/zitadel/errors";
import { propertyName } from "@/lib/zitadel/names";
import type { Issue, ValidationContext } from "@/lib/zitadel/rules/types";
import type { UserSchema } from "@/lib/zitadel/resources/schemas/schema";
import type { ConfigStore } from "@/lib/zitadel/storage/types";
import { CONFIG_DIRECTORIES, type JsonObject } from "@/lib/zitadel/types";
import { isJsonObject, objectAt, stringsIn } from "@/lib/zitadel/utils/json";
import { didYouMean } from "@/lib/zitadel/utils/spelling";

/**
 * An identity-provider connection under `.zitadel/idps/`: who signs people in,
 * and which of their claims fill which properties.
 */
export class Connection<Body extends JsonObject = JsonObject> extends ConfigDocument<Body> {
  /**
   * What kind of document this is: an identity-provider connection.
   */
  readonly kind = "connection";

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
    const secretIssue = this.issue(
      "connection/literal-secret",
      'client_secret must reference a variable, not hold a value. Use "client_secret": "${{ NAME }}" and publish the value as that variable.',
    );
    const endpointsIssue = this.issue(
      "connection/endpoints",
      `oidc names some endpoints but not ${missing.join(", ")}. Name every endpoint (authorization_endpoint, jwks_uri, token_endpoint, and userinfo_endpoint unless id_token_mapping is true), or none to read them from the issuer's discovery document.`,
    );
    const secretIssues = literalSecret ? [secretIssue] : [];
    const endpointsIssues = missing.length > 0 ? [endpointsIssue] : [];
    return [
      ...refusals.filter((refusal) => {
        return !(literalSecret && refusal.message.includes("client_secret"));
      }),
      ...secretIssues,
      ...endpointsIssues,
      ...CHECKED_BLOCKS.flatMap((block) => {
        const allowed = Connection.allowedFields(block.path);
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
      clientId: Connection.variableOf(oidc.client_id, derived?.clientId),
      clientSecret: Connection.variableOf(oidc.client_secret, derived?.clientSecret),
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
    return this.rows("claim_mapping");
  }

  /**
   * The rows of `verified_claims`.
   *
   * @returns Each property and the claim that verifies it, in the order
   *   written; none when nothing is verified.
   */
  get verifications(): readonly ClaimRow[] {
    return this.rows("verified_claims");
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
    const mappings = this.mappings.map((item) => {
      const { property, claim } = item;
      return `  ${property} ← ${String(claim)}`;
    });
    const verifications = this.verifications.map((item) => {
      const { property, claim } = item;
      if (claim === true) {
        return `  ${property} is treated as verified.`;
      }
      return `  ${property} is treated as verified only when ${provider} says so in the ${String(claim)} claim.`;
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
    ];
    return blocks.flatMap((block) => {
      return block.rows.flatMap((row) => {
        if (typeof row.claim !== "string") {
          return [];
        }
        return [{ field: block.field, claim: row.claim }];
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

  /**
   * The settings this file holds that a run reusing the connection takes
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
  storedSettings(given: StoredSettings): StoredSettings {
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
    return {
      displayName: this.usableSetting(
        "a display name",
        this.displayName,
        given.displayName,
        parseDisplayName,
      ),
      issuer: this.usableSetting("an issuer", issuer, given.issuer, parseIssuer),
    };
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
    const body = { ...this.body, oidc: { ...objectAt(this.body, "oidc"), issuer } };
    return {
      document: new Connection(this.path, body, this.editedStatus),
      changed: true,
      skipped: [],
    };
  }

  /**
   * The settings the developer gave that this connection, reused in place of
   * a candidate, does not have, which reusing it does not apply.
   *
   * @param candidate - The connection the settings would have written.
   * @param given - The settings the developer gave.
   * @returns The settings not applied.
   */
  unappliedSettings(
    candidate: Connection,
    given: readonly ConnectionSetting[],
  ): readonly ConnectionSetting[] {
    return given.filter((setting) => {
      if (setting === "display name") {
        return this.displayName !== candidate.displayName;
      }
      return (this.scopes ?? []).join(" ") !== (candidate.scopes ?? []).join(" ");
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
   * A setting the file holds, when a run reusing the connection uses it.
   *
   * @typeParam T - What a typed answer parses to.
   * @param what - How a refusal names the setting.
   * @param stored - The setting as the file holds it.
   * @param given - The setting as the run was given it, which replaces the file's.
   * @param parse - The rules a typed answer is held to.
   * @returns The stored setting, or `undefined` when the run was given one or
   *   the file holds none.
   * @throws {@link ConfigError} When the stored setting cannot be used.
   */
  private usableSetting<T>(
    what: string,
    stored: string | undefined,
    given: string | undefined,
    parse: (value: string) => Parsed<T>,
  ): string | undefined {
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
    return stored;
  }

  /**
   * The rows of a mapping block.
   *
   * @param block - `claim_mapping` or `verified_claims`.
   * @returns Each property and its claim, in the order written; none when the
   *   block is absent.
   */
  private rows(block: "claim_mapping" | "verified_claims"): readonly ClaimRow[] {
    return Object.entries(objectAt(this.body, block)).map((pair) => {
      const [property, claim] = pair;
      return { property: propertyName(property), claim };
    });
  }

  /**
   * The variable a credential field reads from.
   *
   * @typeParam V - The kind of variable the field names.
   * @param value - The field as written.
   * @param fallback - The variable an absent field reads from.
   * @returns The variable it references, the fallback when the field is absent,
   *   or `undefined` when it holds a value.
   */
  private static variableOf<V extends string>(
    value: unknown,
    fallback: V | undefined,
  ): V | undefined {
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
   * The field names the contract allows in one block, when it forbids any
   * other.
   *
   * @param path - The block's path from the root, empty for the root.
   * @returns The allowed names, or none when the block takes anything.
   */
  private static allowedFields(path: readonly string[]): readonly string[] {
    const level = path.reduce<unknown>((node, key) => {
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
