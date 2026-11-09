/**
 * The types every part of `lib/zitadel` shares: a file, its body, where each
 * kind of file lives, and what a new project is scaffolded from.
 */

import type { SetupPreset, SetupUseCase } from "@zitadel/config/defaults";
import type { ConnectionEndpoints, ProviderSelection } from "@zitadel/config/idp";

import type { Change } from "@/lib/zitadel/change";
import type { Connection } from "@/lib/zitadel/resources/connections/connection";
import type { Flow } from "@/lib/zitadel/resources/flows/flow";
import type { PasswordPolicy } from "@/lib/zitadel/resources/policies/password";
import {
  type PasswordMinLength,
  POLICY_FILE_SUFFIX,
  POLICY_TEST_SUFFIX,
} from "@/lib/zitadel/resources/policies/types";
import type { UserSchema } from "@/lib/zitadel/resources/schemas/schema";

/**
 * A parsed JSON object, as a configuration file holds at its root.
 */
export type JsonObject = Readonly<Record<string, unknown>>;

/**
 * The directories the configuration is made of, one per kind of file.
 */
export const CONFIG_KINDS = ["schemas", "flows", "connections", "policies", "branding"] as const;

/**
 * One directory of the configuration.
 */
export type ConfigKind = (typeof CONFIG_KINDS)[number];

/**
 * Where each kind of file lives, relative to the project root.
 */
export const CONFIG_DIRECTORIES = {
  schemas: ".zitadel/schemas",
  flows: ".zitadel/flows",
  connections: ".zitadel/idps",
  policies: ".zitadel/policies",
  branding: ".zitadel/branding",
} as const satisfies Readonly<Record<ConfigKind, string>>;

/**
 * The policy files a release carries, as project-relative globs whose `*`
 * stops at a `/`, for git to diff on a deploy.
 *
 * @remarks
 * The files the bundle reads: the `*.json` files at the top of the policies
 * directory, never its `README.md` or a subdirectory, and never the test
 * files beside the policies, which `zitadel policies test` runs.
 */
export const RELEASE_POLICY_GLOBS = {
  /**
   * The files a release carries, test files included until {@link excluded}
   * takes them out.
   */
  included: `${CONFIG_DIRECTORIES.policies}/*${POLICY_FILE_SUFFIX}`,
  /**
   * The test files, which no release carries.
   */
  excluded: `${CONFIG_DIRECTORIES.policies}/*${POLICY_TEST_SUFFIX}`,
} as const;

/**
 * One configuration file: its project-relative path and its parsed body.
 */
export type ConfigFile = Readonly<{
  /**
   * The file's project-relative path.
   */
  path: string;
  /**
   * The file's parsed body.
   */
  body: JsonObject;
}>;

/**
 * Every file of the configuration, by kind.
 */
export type ConfigFiles = Readonly<Record<ConfigKind, readonly ConfigFile[]>>;

/**
 * One provider a new project offers for signing in, as it was chosen.
 */
export type ScaffoldedProvider = Readonly<{
  /**
   * The provider: one from the catalog, or the developer's own.
   */
  selection: ProviderSelection;

  /**
   * Where the provider answers, when not at its own issuer.
   */
  endpoints?: ConnectionEndpoints;
}>;

/**
 * A chosen provider and the connection scaffolded for it.
 *
 * @typeParam P - The provider as the caller chose it.
 */
export type ScaffoldedConnection<P extends ScaffoldedProvider = ScaffoldedProvider> = Readonly<{
  /**
   * The provider, as the caller handed it in.
   */
  chosen: P;

  /**
   * The connection written for it.
   */
  connection: Connection;
}>;

/**
 * What a new project's configuration is scaffolded from.
 *
 * @typeParam P - The provider as the caller chose it, handed back with its
 *   connection.
 */
export type ScaffoldOptions<P extends ScaffoldedProvider = ScaffoldedProvider> = Readonly<{
  /**
   * The sign-in preset: which method the login flow starts with.
   */
  preset: SetupPreset;

  /**
   * The use case: which fields the user schema asks for.
   */
  useCase: SetupUseCase;

  /**
   * The providers to offer, in the order they were chosen: each gets a
   * connection, and the schema and flow name every one.
   */
  sso: readonly P[];

  /**
   * The minimum password length for the password policy: a number, `null`
   * for an explicit none, or `undefined` when none was given.
   *
   * @remarks
   * A new policy gets the recommended minimum when none was given, and an
   * empty `config`, which enforces nothing, for none. A kept one keeps its
   * `min_length` when none was given.
   */
  passwordMinLength?: PasswordMinLength | undefined;

  /**
   * Whether the default schema and flow may replace the files at their
   * paths, and an existing password policy is kept instead of refused.
   */
  force: boolean;
}>;

/**
 * A new project's configuration: the change that writes it, and the
 * documents it writes.
 *
 * @typeParam P - The provider as the caller chose it.
 */
export type Scaffold<P extends ScaffoldedProvider = ScaffoldedProvider> = Readonly<{
  /**
   * The edit that writes every file, to save with `overwrite` set as `force`
   * was.
   */
  change: Change;

  /**
   * The default user schema, with every chosen provider enabled.
   */
  schema: UserSchema;

  /**
   * The default login flow, offering every chosen provider.
   */
  flow: Flow;

  /**
   * Each chosen provider with its connection, in the order chosen.
   */
  connections: readonly ScaffoldedConnection<P>[];

  /**
   * The password policy the project holds afterwards: new, or the one it
   * kept, with the minimum it was given.
   */
  policy: PasswordPolicy;
}>;
