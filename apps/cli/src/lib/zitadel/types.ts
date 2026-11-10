/**
 * The types every part of `lib/zitadel` shares: a file, its body, where each
 * kind of file lives, and what a new project is scaffolded from.
 */

import type { SetupPreset, SetupUseCase } from "@zitadel/config/defaults";
import type { ConnectionEndpoints, ProviderSelection } from "@zitadel/config/idp";
import type { JsonPrimitive } from "type-fest";

export type { JsonPrimitive } from "type-fest";

import type { Change } from "@/lib/zitadel/change";
import type { Connection } from "@/lib/zitadel/resources/connections/connection";
import type { Flow } from "@/lib/zitadel/resources/flows/flow";
import type { PasswordPolicy } from "@/lib/zitadel/resources/policies/password";
import type { SignupPolicy } from "@/lib/zitadel/resources/policies/signup";
import {
  type PasswordMinLength,
  POLICY_FILE_SUFFIX,
  POLICY_TEST_SUFFIX,
} from "@/lib/zitadel/resources/policies/types";
import type { UserSchema } from "@/lib/zitadel/resources/schemas/schema";
import type { UnparsedFile } from "@/lib/zitadel/storage/unparsed-file";

export type { UnparsedFile } from "@/lib/zitadel/storage/unparsed-file";

/**
 * A JSON value, read-only all the way down: what a configuration file parses
 * to, and what a wire body is built from.
 */
export type JsonValue = JsonPrimitive | JsonArray | JsonObject;

/**
 * A JSON list, read-only all the way down.
 */
export type JsonArray = readonly JsonValue[];

/**
 * A JSON object, read-only all the way down, as a configuration file holds at
 * its root.
 *
 * @remarks
 * A member may be `undefined`, which stands for an absent key: TypeScript
 * gives every object literal in a mixed list, and every JSON module import,
 * `key?: undefined` members, and the API's generated models have optional
 * ones. `JSON.stringify` drops such a key, so the wire body is the same.
 * Code that builds a body leaves a key out rather than setting it to
 * `undefined`, so `{}` and an edited `{}` still compare equal.
 */
export type JsonObject = { readonly [key: string]: JsonValue | undefined };

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
} as const satisfies Record<ConfigKind, `.zitadel/${string}`>;

/**
 * The directory one kind of file lives in.
 */
export type ConfigDirectory = (typeof CONFIG_DIRECTORIES)[ConfigKind];

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
export type ConfigFile = {
  /**
   * The file's project-relative path.
   */
  readonly path: string;
  /**
   * The file's parsed body.
   */
  readonly body: JsonObject;
};

/**
 * What a store reads of one file: a {@link ConfigFile} with its body, or an
 * {@link UnparsedFile} with the reason it has none.
 */
export type StoredFile = ConfigFile | UnparsedFile;

/**
 * Every file of the configuration, by kind.
 */
export type ConfigFiles = { readonly [K in ConfigKind]: readonly StoredFile[] };

/**
 * One provider a new project offers for signing in, as it was chosen.
 */
export type ScaffoldedProvider = {
  /**
   * The provider: one from the catalog, or the developer's own.
   */
  readonly selection: ProviderSelection;

  /**
   * Where the provider answers, when not at its own issuer.
   */
  readonly endpoints?: ConnectionEndpoints;
};

/**
 * A chosen provider and the connection scaffolded for it.
 *
 * @typeParam P - The provider as the caller chose it.
 */
export type ScaffoldedConnection<P extends ScaffoldedProvider = ScaffoldedProvider> = {
  /**
   * The provider, as the caller handed it in.
   */
  readonly chosen: P;

  /**
   * The connection written for it.
   */
  readonly connection: Connection;
};

/**
 * What a new project's configuration is scaffolded from.
 *
 * @typeParam P - The provider as the caller chose it, handed back with its
 *   connection.
 */
export type ScaffoldOptions<P extends ScaffoldedProvider = ScaffoldedProvider> = {
  /**
   * The sign-in preset: which method the login flow starts with.
   */
  readonly preset: SetupPreset;

  /**
   * The use case: which fields the user schema asks for.
   */
  readonly useCase: SetupUseCase;

  /**
   * The providers to offer, in the order they were chosen: each gets a
   * connection, and the schema and flow name every one.
   */
  readonly sso: readonly P[];

  /**
   * The minimum password length for the password policy: a number, `null`
   * for an explicit none, or `undefined` when none was given.
   *
   * @remarks
   * A new policy gets the recommended minimum when none was given, and an
   * empty `config`, which enforces nothing, for none. A kept one keeps its
   * `min_length` when none was given.
   */
  readonly passwordMinLength?: PasswordMinLength | undefined;

  /**
   * Whether a project without a sign-up policy gets the default one; left
   * out, it does.
   *
   * @remarks
   * False for a server that does not take the policy yet. A sign-up policy
   * kept by `force` stays either way: the file is the developer's.
   */
  readonly signupPolicy?: boolean | undefined;

  /**
   * Whether the default schema and flow may replace the files at their
   * paths, and an existing password or sign-up policy is kept instead of
   * refused.
   */
  readonly force: boolean;
};

/**
 * A new project's configuration: the change that writes it, and the
 * documents it writes.
 *
 * @typeParam P - The provider as the caller chose it.
 */
export type Scaffold<P extends ScaffoldedProvider = ScaffoldedProvider> = {
  /**
   * The edit that writes every file, to save with `overwrite` set as `force`
   * was.
   */
  readonly change: Change;

  /**
   * The default user schema, with every chosen provider enabled.
   */
  readonly schema: UserSchema;

  /**
   * The default login flow, offering every chosen provider.
   */
  readonly flow: Flow;

  /**
   * Each chosen provider with its connection, in the order chosen.
   */
  readonly connections: readonly ScaffoldedConnection<P>[];

  /**
   * The password policy the project holds afterwards: new, or the one it
   * kept, with the minimum it was given.
   */
  readonly policy: PasswordPolicy;

  /**
   * The sign-up policy the project holds afterwards: new, or the one it kept
   * as it is. `undefined` when it has none.
   */
  readonly signupPolicy: SignupPolicy | undefined;
};

/**
 * The configuration as `POST /releases/build` takes it, grouped by kind.
 *
 * @remarks
 * Loose on purpose: the files are untyped JSON until the deploy's checks have
 * run, and the publisher narrows them to the API's bundle before they are sent.
 */
export type ConfigurationBundle = {
  /**
   * Every user schema's wire body.
   */
  readonly schemas: readonly JsonObject[];
  /**
   * Every login flow's wire body.
   */
  readonly flow_definitions: readonly JsonObject[];
  /**
   * Every connection's wire body.
   */
  readonly idps: readonly JsonObject[];
  /**
   * Every policy's wire body; absent when there are none.
   */
  readonly policies?: readonly JsonObject[];
  /**
   * The branding descriptor's wire body; absent when there is none.
   */
  readonly branding?: JsonObject;
};

/**
 * A built bundle, and the number of resources it carries across every kind.
 */
export type BuiltBundle = {
  /**
   * The bundle to send.
   */
  readonly bundle: ConfigurationBundle;
  /**
   * How many resources it carries across every kind.
   */
  readonly resourceCount: number;
};
