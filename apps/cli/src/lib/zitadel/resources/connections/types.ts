/**
 * The types and constants of identity-provider connections: a connection's
 * claim rows and credentials, the contract its blocks are held to, and what
 * finding or enabling one is told beyond its file.
 */

import type { ClientIdVariable, ClientSecretVariable } from "@zitadel/config/idp";
import { metaSchemaFiles } from "@zitadel/config/meta-schemas";

import type { PropertyName } from "@/lib/zitadel/names";

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
export type CredentialField = "client_id" | "client_secret";

/**
 * The fields of the `oidc` block that hold a credential, in the order they are
 * reported.
 */
export const CREDENTIAL_FIELDS: readonly CredentialField[] = ["client_id", "client_secret"];

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
export type CheckedBlock = Readonly<{
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
export const CHECKED_BLOCKS: readonly CheckedBlock[] = [
  { path: [], where: "a connection" },
  { path: ["oidc"], where: "the oidc block" },
  { path: ["provisioning"], where: "the provisioning block" },
];

/**
 * The connection contract, as the meta-schema the editor validates against
 * states it.
 */
export const CONNECTION_CONTRACT: unknown = metaSchemaFiles().find((entry) => {
  return entry.name === "idp-connection.json";
})?.body;

/**
 * A setting the developer gave for a connection, which an existing file may
 * not have.
 */
export type ConnectionSetting = "display name" | "scopes";

/**
 * What is known about a connection beyond its file.
 */
export type LookupOptions = Readonly<{
  /**
   * The client id the developer gave, which an existing file holding another
   * one contradicts.
   */
  clientId?: string | undefined;
}>;

/**
 * What enabling a provider is told beyond the connection itself.
 */
export type SsoOptions = LookupOptions &
  Readonly<{
    /**
     * The settings the developer gave, which an existing connection may not
     * have.
     */
    given?: readonly ConnectionSetting[] | undefined;
  }>;
