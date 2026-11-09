import {
  DEFAULT_FLOW_CONFIG_PATH,
  DEFAULT_SCHEMA_CONFIG_PATH,
  getDefaultHumanUserSchemaBody,
  getDefaultLoginFlow,
  type SetupPreset,
  type SetupUseCase,
} from "@zitadel/config/defaults";
import { type ConnectionEndpoints, type ProviderSelection, providerOf } from "@zitadel/config/idp";

import { Change } from "@/lib/zitadel/change";
import type { ZitadelConfig } from "@/lib/zitadel/config";
import { ConfigError, ConnectionExistsError, FileExistsError } from "@/lib/zitadel/errors";
import { Connection } from "@/lib/zitadel/resources/connections/connection";
import { Flow } from "@/lib/zitadel/resources/flows/flow";
import { PASSWORD_POLICY_PATH, passwordPolicy } from "@/lib/zitadel/resources/policies/password";
import type { Policy } from "@/lib/zitadel/resources/policies/policy";
import type { PasswordMinLength } from "@/lib/zitadel/resources/policies/types";
import { UserSchema } from "@/lib/zitadel/resources/schemas/schema";

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
  policy: Policy;
}>;

/**
 * Scaffold a new project's configuration on top of what a configuration
 * already holds: the default user schema and login flow for a preset and use
 * case, a connection for each chosen provider, and the password policy.
 *
 * @remarks
 * Every file is refused before anything is built, so a conflict is found
 * before the caller creates anything that depends on it. A connection is
 * refused with or without `force`: the file is the developer's, holding a
 * client id registered with the vendor and a slug other files may name, so it
 * is never replaced. Each connection's claim mapping reads the template's
 * properties, which enabling a provider does not change.
 *
 * @typeParam P - The provider as the caller chose it.
 * @param config - The configuration the project has.
 * @param options - What to scaffold, and whether files may be replaced.
 * @returns The change that writes it, and its documents.
 * @throws {@link ConnectionExistsError} When a chosen provider already has a
 *   connection.
 * @throws {@link FileExistsError} Without `force`, when the default schema,
 *   flow or password policy file is already there.
 * @throws {@link ConflictError} When a chosen provider's connection would
 *   collide with another connection, by file name, slug or variables.
 * @throws {@link ConfigError} When `force` keeps a password policy file that
 *   is not a valid password policy.
 */
export function scaffold<P extends ScaffoldedProvider>(
  config: ZitadelConfig,
  options: ScaffoldOptions<P>,
): Scaffold<P> {
  const template = UserSchema.create({
    path: DEFAULT_SCHEMA_CONFIG_PATH,
    body: getDefaultHumanUserSchemaBody({ preset: options.preset, useCase: options.useCase }),
  });
  const connections = options.sso.map((chosen) => {
    return {
      chosen,
      connection: Connection.forProvider(providerOf(chosen.selection), template, chosen.endpoints),
    };
  });
  for (const { chosen, connection } of connections) {
    const existing =
      config.connections.existing(connection) ?? config.connections.get(connection.path);
    if (existing !== undefined) {
      throw new ConnectionExistsError(existing.path, chosen.selection);
    }
  }
  if (!options.force) {
    for (const taken of [
      config.schemas.get(DEFAULT_SCHEMA_CONFIG_PATH),
      config.flows.get(DEFAULT_FLOW_CONFIG_PATH),
      config.policies.get(PASSWORD_POLICY_PATH),
    ]) {
      if (taken !== undefined) {
        throw new FileExistsError(taken.path);
      }
    }
  }
  const kept = options.force ? keptPasswordPolicy(config) : undefined;
  const policy =
    kept === undefined
      ? passwordPolicy(options.passwordMinLength)
      : kept.withMinLength(options.passwordMinLength);
  const slugs = options.sso.map((chosen) => {
    return providerOf(chosen.selection).slug;
  });
  // The edits are additive and idempotent, so folding them builds one schema
  // that names every chosen provider.
  const schema = slugs.reduce((document, slug) => {
    return document.withProvider(slug);
  }, template);
  // The conflict step a provider needs can only offer what this schema
  // enables, so the methods are read off the composed schema rather than
  // inferred from the preset.
  const flow = slugs.reduce(
    (document, slug) => {
      return document.withProvider(slug, schema.enabledMethods);
    },
    Flow.create({
      path: DEFAULT_FLOW_CONFIG_PATH,
      body: getDefaultLoginFlow({ preset: options.preset, useCase: options.useCase }),
    }),
  );
  const documents = [
    schema,
    flow,
    ...connections.map(({ connection }) => {
      return connection;
    }),
    policy,
  ];
  const after = documents.reduce((current, document) => {
    return current.with(document);
  }, config);
  return {
    change: new Change({ before: config, after }),
    schema,
    flow,
    connections,
    policy,
  };
}

/**
 * The password policy file a project already has, which `force` keeps.
 *
 * @remarks
 * It must be a valid policy for the password operation: it is deployed as it
 * is, so a broken one is refused before anything is written.
 *
 * @param config - The project's configuration.
 * @returns The policy, or `undefined` when there is none.
 * @throws {@link ConfigError} When the file is not a valid password policy.
 */
function keptPasswordPolicy(config: ZitadelConfig): Policy | undefined {
  const policy = config.policies.password;
  if (policy === undefined) {
    return undefined;
  }
  if (policy.problems({}).length > 0) {
    throw new ConfigError(`${PASSWORD_POLICY_PATH} is not a valid password policy`, {
      hint: "Setup keeps an existing policy file and deploys it, so fix it against .zitadel/meta/policy.json or move it aside to start from an empty one.",
      details: { file: PASSWORD_POLICY_PATH },
    });
  }
  return policy;
}
