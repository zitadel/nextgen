/**
 * The types and constants of identity-provider connections: a connection's
 * claim rows and credentials, the contract its blocks are held to, and what
 * finding or enabling one is told beyond its file.
 */

import type {
  ClientId,
  ClientIdVariable,
  ClientSecretVariable,
  DisplayName,
  Issuer,
} from "@zitadel/config/idp";
import { metaSchemaFiles } from "@zitadel/config/meta-schemas";

import type { ClaimName, PropertyName } from "@/lib/zitadel/names";
import type { Connection } from "@/lib/zitadel/resources/connections/connection";
import type { CONFIG_DIRECTORIES, JsonObject, JsonValue } from "@/lib/zitadel/types";
import { isJsonObject, isJsonValue } from "@/lib/zitadel/utils/json";

/**
 * The project-relative path of a connection file.
 */
export type ConnectionPath = `${typeof CONFIG_DIRECTORIES.connections}/${string}.json`;

/**
 * One row of a connection's `claim_mapping` or `verified_claims`.
 */
export type ClaimRow = {
  /**
   * The schema property the row fills or verifies.
   */
  readonly property: PropertyName;

  /**
   * The claim as written; a well-formed file holds a string.
   */
  readonly claim: JsonValue;
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
 * A credential field that names a project variable instead of holding a value.
 *
 * @remarks
 * The variable's brand follows the field: what `client_id` references is a
 * client id's variable, whatever it is called.
 */
export type VariableUse =
  | {
      readonly field: "client_id";
      readonly variable: ClientIdVariable;
    }
  | {
      readonly field: "client_secret";
      readonly variable: ClientSecretVariable;
    };

/**
 * The project variables a connection reads its credentials from.
 *
 * @remarks
 * A credential the file holds as a value names no variable, so it is
 * `undefined`: there is nothing to publish to.
 */
export type CredentialNames = {
  /**
   * The variable the client id is read from.
   */
  readonly clientId: ClientIdVariable | undefined;

  /**
   * The variable the client secret is read from.
   */
  readonly clientSecret: ClientSecretVariable | undefined;
};

/**
 * The settings of a connection of the developer's own beyond its slug that a
 * file holds and a run reusing it takes, each held to the rules a typed answer
 * is.
 */
export type StoredSettings = {
  /**
   * The name shown on the sign-in button, or `undefined` when the run was
   * given one or the file holds none.
   */
  readonly displayName: DisplayName | undefined;

  /**
   * The provider's issuer, or `undefined` when the run was given one.
   */
  readonly issuer: Issuer | undefined;
};

/**
 * The same settings as a run gives them, before they are checked.
 */
export type GivenSettings = { readonly [K in keyof StoredSettings]?: string | undefined };

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
