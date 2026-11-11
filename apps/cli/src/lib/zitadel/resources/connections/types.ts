/**
 * The types and constants of identity-provider connections: a connection's
 * claim rows and credentials, the contract its blocks are held to, and what
 * finding or enabling one is told beyond its file.
 */

import type { ClientId, ClientIdVariable, ClientSecretVariable } from "@zitadel/config/idp";
import { metaSchemaFiles } from "@zitadel/config/meta-schemas";
import type { idpConnectionConfigSchema } from "@zitadel/config/schemas";

import type { ClaimName, PropertyName } from "@/lib/zitadel/names";
import type { Connection } from "@/lib/zitadel/resources/connections/connection";
import type { ContractValue } from "@/lib/zitadel/resources/document";
import type { CONFIG_DIRECTORIES, JsonObject } from "@/lib/zitadel/types";
import { isJsonObject, isJsonValue } from "@/lib/zitadel/utils/json";

/**
 * What a connection holds once the connection contract took its body.
 */
export type ConnectionValue = ContractValue<typeof idpConnectionConfigSchema>;

/**
 * The project-relative path of a connection file.
 */
export type ConnectionPath = `${typeof CONFIG_DIRECTORIES.connections}/${string}.json`;

/**
 * One row of a connection's `claim_mapping` or `verified_claims`.
 *
 * @typeParam Claim - What the block holds for a property: a claim's name in
 *   `claim_mapping`; a claim's name or a fixed answer in `verified_claims`.
 */
export type ClaimRow<Claim extends string | boolean = string | boolean> = {
  /**
   * The schema property the row fills or verifies.
   */
  readonly property: PropertyName;

  /**
   * The claim as written.
   */
  readonly claim: Claim;
};

/**
 * The blocks of a connection that name a claim, in the order they are read.
 */
export const CLAIM_FIELDS = ["claim_mapping", "verified_claims", "subject_claim"] as const;

/**
 * A block of a connection that names a claim.
 */
export type ClaimField = (typeof CLAIM_FIELDS)[number];

/**
 * A claim a connection reads by name, and the block it is read in.
 */
export type ClaimRead = {
  /**
   * The block it is read in.
   */
  readonly field: ClaimField;

  /**
   * The claim's name.
   */
  readonly claim: ClaimName;
};

/**
 * The fields of the `oidc` block that hold a credential, in the order they are
 * reported.
 */
export const CREDENTIAL_FIELDS = ["client_id", "client_secret"] as const;

/**
 * A field of the `oidc` block that holds a credential.
 */
export type CredentialField = (typeof CREDENTIAL_FIELDS)[number];

/**
 * The project variable a connection reads one of its credentials from.
 */
export type CredentialVariable = ClientIdVariable | ClientSecretVariable;

/**
 * One credential field of the `oidc` block, as the file holds it: a
 * `${{ NAME }}` reference to a project variable, or the value itself.
 *
 * @typeParam Field - The field.
 * @typeParam Variable - The kind of variable the field references, which
 *   follows the field: what `client_id` references is a client id's variable,
 *   whatever it is called.
 */
export type Credential<Field extends CredentialField, Variable extends CredentialVariable> =
  | {
      /**
       * The field references a project variable.
       */
      readonly kind: "variable";

      /**
       * The field.
       */
      readonly field: Field;

      /**
       * The variable the field references.
       */
      readonly variable: Variable;
    }
  | {
      /**
       * The field holds its value.
       */
      readonly kind: "literal";

      /**
       * The field.
       */
      readonly field: Field;

      /**
       * The value as written.
       */
      readonly value: string;
    };

/**
 * The credentials of a connection's `oidc` block.
 */
export type ConnectionCredentials = {
  /**
   * The client id.
   */
  readonly clientId: Credential<"client_id", ClientIdVariable>;

  /**
   * The client secret, which the contract holds to a reference.
   */
  readonly clientSecret: Credential<"client_secret", ClientSecretVariable>;
};

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
export type CheckedBlock = {
  /**
   * The block's path from the root, empty for the root.
   */
  readonly path: readonly string[];

  /**
   * How a message names the block.
   */
  readonly where: string;
};

/**
 * The blocks of a connection whose fields the contract fixes.
 */
export const CHECKED_BLOCKS: readonly CheckedBlock[] = [
  { path: [], where: "a connection" },
  { path: ["oidc"], where: "the oidc block" },
  { path: ["provisioning"], where: "the provisioning block" },
];

/**
 * The meta-schema the editor validates a connection against, as shipped.
 */
const CONTRACT_FILE: unknown = metaSchemaFiles().find((entry) => {
  return entry.name === "idp-connection.json";
})?.body;

/**
 * The connection contract, as the meta-schema the editor validates against
 * states it; empty when the meta-schema is missing, which allows any field.
 */
export const CONNECTION_CONTRACT: JsonObject =
  isJsonValue(CONTRACT_FILE) && isJsonObject(CONTRACT_FILE) ? CONTRACT_FILE : {};

/**
 * The settings a developer can give for a connection, which an existing file
 * may not have.
 */
export const CONNECTION_SETTINGS = ["display name", "scopes"] as const;

/**
 * A setting the developer gave for a connection, which an existing file may
 * not have.
 */
export type ConnectionSetting = (typeof CONNECTION_SETTINGS)[number];

/**
 * What is known about a connection beyond its file.
 */
export type LookupOptions = {
  /**
   * The client id the developer gave, which an existing file holding another
   * one contradicts.
   */
  readonly clientId?: ClientId | undefined;
};

/**
 * What enabling a provider is told beyond the connection itself.
 */
export type SsoOptions = LookupOptions & {
  /**
   * The settings the developer gave, which an existing connection may not
   * have.
   */
  readonly given?: readonly ConnectionSetting[] | undefined;

  /**
   * Whether the edit is only previewed, so what it says about its outcome is
   * said as what would happen.
   */
  readonly dryRun?: boolean | undefined;
};

/**
 * A property no claim fills, of a schema that signs in through a connection.
 */
export type UnmappedProperty = {
  /**
   * The property.
   */
  readonly property: PropertyName;

  /**
   * Whether the schema requires it, so a sign-up through the connection has to
   * collect it in a step of its own.
   */
  readonly required: boolean;
};

/**
 * What a connection fills a user with, and who signs in through it, read from
 * the files as they are.
 */
export type ConnectionSummary = {
  /**
   * Each property `claim_mapping` fills, and the claim that fills it.
   */
  readonly mappings: readonly ClaimRow<string>[];

  /**
   * Each property `verified_claims` verifies, and what verifies it.
   */
  readonly verifications: readonly ClaimRow[];

  /**
   * The scopes `oidc.scopes` asks for; none when the file names none.
   */
  readonly scopes: readonly string[];

  /**
   * Whether a sign-up through the connection can create a user, so a property
   * no claim fills has to be collected by a step. False when its
   * `provisioning.creation` is `disabled`.
   */
  readonly createsUsers: boolean;

  /**
   * The top-level properties of the schemas that sign in through it that no
   * claim fills, sorted by name, each once.
   */
  readonly unmapped: readonly UnmappedProperty[];

  /**
   * The names of the schemas that list the connection with SSO enabled, in
   * file order.
   */
  readonly usedBy: readonly string[];
};

/**
 * A connection nothing offers any more, which a removed provider leaves
 * behind, and the project variables only it reads.
 */
export type UnusedConnection = {
  /**
   * The connection.
   */
  readonly connection: Connection;

  /**
   * The variables its credentials read that no other connection reads, so
   * removing them breaks nothing else.
   */
  readonly variables: readonly CredentialVariable[];
};
