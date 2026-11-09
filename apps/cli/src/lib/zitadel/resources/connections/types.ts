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
