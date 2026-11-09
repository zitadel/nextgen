import {
  DEFAULT_FLOW_CONFIG_PATH,
  DEFAULT_SCHEMA_CONFIG_PATH,
  getDefaultHumanUserSchemaBody,
  getDefaultLoginFlow,
} from "@zitadel/config/defaults";
import { providerOf } from "@zitadel/config/idp";

import { Change } from "@/lib/zitadel/change";
import { Branding } from "@/lib/zitadel/resources/branding/branding";
import { Brandings } from "@/lib/zitadel/resources/branding/collection";
import { Connection } from "@/lib/zitadel/resources/connections/connection";
import { Connections } from "@/lib/zitadel/resources/connections/collection";
import {
  BrokenFilesError,
  ConfigError,
  ConnectionExistsError,
  FileExistsError,
} from "@/lib/zitadel/errors";
import { Flow } from "@/lib/zitadel/resources/flows/flow";
import { Flows } from "@/lib/zitadel/resources/flows/collection";
import { Policies } from "@/lib/zitadel/resources/policies/collection";
import { PasswordPolicy } from "@/lib/zitadel/resources/policies/password";
import type { Policy } from "@/lib/zitadel/resources/policies/policy";
import { PolicyTest } from "@/lib/zitadel/resources/policies/suite";
import { POLICY_TEST_SUFFIX } from "@/lib/zitadel/resources/policies/types";
import { CONTRACT_RULES } from "@/lib/zitadel/rules/contracts";
import { ENVIRONMENT_RULES } from "@/lib/zitadel/rules/environment";
import { FLOW_RULES } from "@/lib/zitadel/rules/flows";
import { SSO_RULES } from "@/lib/zitadel/rules/sso";
import type { Issue, ValidationContext } from "@/lib/zitadel/rules/types";
import { Schemas } from "@/lib/zitadel/resources/schemas/collection";
import { UserSchema } from "@/lib/zitadel/resources/schemas/schema";
import type { ConfigStore } from "@/lib/zitadel/storage/types";
import type {
  BuiltBundle,
  ConfigFiles,
  ConfigurationBundle,
  Scaffold,
  ScaffoldedProvider,
  ScaffoldOptions,
} from "@/lib/zitadel/types";

/**
 * Any document of the configuration that a collection holds and a change
 * writes.
 */
export type AnyDocument = UserSchema | Flow | Connection | Policy | PolicyTest | Branding;

/**
 * What a configuration knows beyond its files, which the caller keeps
 * elsewhere and hands in.
 */
export type ConfigOptions = Readonly<{
  /**
   * The slugs of the connections the server already has.
   *
   * @remarks
   * Some advice only holds before a connection's first deploy. Absent when
   * the caller cannot tell, and the advice is then given anyway.
   */
  deployed?: ReadonlySet<string> | undefined;

  /**
   * The platform ids each user schema was published as, by the schema's
   * project-relative path: the id it was last synced as and the one that
   * replaced, which a flow's `user_schema` may still name.
   *
   * @remarks
   * Absent before a first deploy, and for a caller that does not keep them;
   * a flow is then matched to its schema by what the schema file states.
   */
  published?: ReadonlyMap<string, readonly string[]> | undefined;
}>;

/**
 * The documents of a configuration by kind, what it knows beyond them, and
 * the documents removed since it was read.
 */
type Parts = Readonly<{
  schemas: readonly UserSchema[];
  flows: readonly Flow[];
  connections: readonly Connection[];
  policies: readonly Policy[];
  policyTests: readonly PolicyTest[];
  brandings: readonly Branding[];
  removed: readonly AnyDocument[];
  options: ConfigOptions;
}>;

/**
 * An edit to the documents of one kind: a list, and the document it places or
 * leaves out.
 *
 * @typeParam T - The kind of document.
 */
type ListEdit = <T extends AnyDocument>(documents: readonly T[], document: T) => readonly T[];

/**
 * A project's whole configuration under `.zitadel/`: its user schemas, login
 * flows, identity-provider connections, operation policies and branding, read
 * and written together.
 *
 * @remarks
 * Immutable. Each kind of document is a collection, and every question and
 * edit belongs to the collection of the document it is about, with the rest
 * of the configuration in reach. An edit returns a {@link Change}, which
 * writes only the files that differ from what was read, are new, or were
 * removed.
 */
export class ZitadelConfig {
  /**
   * The most resources a release may pin: the cap `POST /releases/build`
   * enforces.
   */
  private static readonly MAX_BUNDLE_RESOURCES = 50;

  /**
   * The user schemas under `.zitadel/schemas/`.
   */
  readonly schemas: Schemas;

  /**
   * The login flows under `.zitadel/flows/`.
   */
  readonly flows: Flows;

  /**
   * The identity-provider connections under `.zitadel/idps/`, in path order.
   */
  readonly connections: Connections;

  /**
   * The operation policies under `.zitadel/policies/`, and their test files.
   */
  readonly policies: Policies;

  /**
   * The branding descriptors under `.zitadel/branding/`; a deploy refuses
   * more than one.
   */
  readonly branding: Brandings;

  /**
   * What the configuration knows beyond its files.
   */
  readonly options: ConfigOptions;

  /**
   * The documents removed since the configuration was read, whose files
   * saving deletes.
   */
  private readonly removed: readonly AnyDocument[];

  /**
   * Hold the documents of a configuration in their collections.
   *
   * @param parts - The documents by kind, the options and what was removed.
   */
  private constructor(parts: Parts) {
    this.schemas = new Schemas(this, parts.schemas);
    this.flows = new Flows(this, parts.flows);
    this.connections = new Connections(this, parts.connections);
    this.policies = new Policies(this, parts.policies, parts.policyTests);
    this.branding = new Brandings(this, parts.brandings);
    this.options = parts.options;
    this.removed = parts.removed;
  }

  /**
   * Read the configuration and hold every file to its contract.
   *
   * @param store - Where the configuration is kept.
   * @param options - What is known beyond the files.
   * @returns The configuration.
   * @throws {@link BrokenFilesError} Naming every file the contract rules refuse.
   */
  static async load(store: ConfigStore, options: ConfigOptions = {}): Promise<ZitadelConfig> {
    const config = await ZitadelConfig.loadUnchecked(store, options);
    const problems = CONTRACT_RULES.flatMap((rule) => {
      return rule.check(config, { store });
    })
      .filter((issue) => {
        return issue.severity === "error";
      })
      .map((issue) => {
        return { path: issue.file, problem: issue.message };
      });
    if (problems.length > 0) {
      throw new BrokenFilesError(problems);
    }
    return config;
  }

  /**
   * Read the configuration without holding the files to their contracts.
   *
   * @remarks
   * For a caller that already has, such as `deploy`, whose validate step
   * checks every file's shape before it checks how the files agree.
   *
   * @param store - Where the configuration is kept.
   * @param options - What is known beyond the files.
   * @returns The configuration.
   */
  static async loadUnchecked(
    store: ConfigStore,
    options: ConfigOptions = {},
  ): Promise<ZitadelConfig> {
    const [schemas, flows, connections, policies, branding] = await Promise.all([
      store.read("schemas"),
      store.read("flows"),
      store.read("connections"),
      store.read("policies"),
      store.read("branding"),
    ]);
    return ZitadelConfig.of({ schemas, flows, connections, policies, branding }, options);
  }

  /**
   * Take files already in memory as the configuration, without holding them
   * to their contracts, so a test states only what a rule reads.
   *
   * @param files - The files, by kind.
   * @param options - What is known beyond the files.
   * @returns The configuration.
   */
  static of(files: ConfigFiles, options: ConfigOptions = {}): ZitadelConfig {
    const connections = [...files.connections]
      .sort((a, b) => {
        return a.path.localeCompare(b.path);
      })
      .map(Connection.of);
    return new ZitadelConfig({
      schemas: files.schemas.map(UserSchema.of),
      flows: files.flows.map(Flow.of),
      connections,
      policies: files.policies
        .filter((file) => {
          return !file.path.endsWith(POLICY_TEST_SUFFIX);
        })
        .map(Policies.read),
      policyTests: files.policies
        .filter((file) => {
          return file.path.endsWith(POLICY_TEST_SUFFIX);
        })
        .map(PolicyTest.of),
      brandings: files.branding.map(Branding.of),
      removed: [],
      options,
    });
  }

  /**
   * A configuration with no files, for a caller that only writes new ones.
   *
   * @returns The empty configuration.
   */
  static empty(): ZitadelConfig {
    return ZitadelConfig.of({
      schemas: [],
      flows: [],
      connections: [],
      policies: [],
      branding: [],
    });
  }

  /**
   * Check the configuration against every rule: each file's contract, the
   * server's flow rules, the environment, and how the files agree.
   *
   * @param context - What some rules need beyond the files; a rule that needs
   *   what is not given is skipped.
   * @returns Every finding; none when it is consistent.
   */
  validate(context: ValidationContext = {}): readonly Issue[] {
    return [...CONTRACT_RULES, ...FLOW_RULES, ...ENVIRONMENT_RULES, ...SSO_RULES].flatMap(
      (rule) => {
        return rule.check(this, context);
      },
    );
  }

  /**
   * Assemble the bundle a deploy sends: each document's wire body, grouped by
   * kind.
   *
   * @remarks
   * An empty configuration and one over the cap both fail before any server
   * call, with the messages the server would answer.
   *
   * @param store - Where branding's referenced files are read from.
   * @returns The bundle and how many resources it carries.
   * @throws {@link ConfigError} When there is nothing to deploy, more than one
   *   branding, or more resources than a release may pin.
   */
  bundle(store: ConfigStore): BuiltBundle {
    // A project has one branding, so the bundle carries a single one. The cap
    // below would not catch a second descriptor, so it is refused here, before
    // anything is inlined or sent.
    if (this.branding.all.length > 1) {
      throw new ConfigError(
        `A release carries at most one branding, but .zitadel/branding/ holds ${this.branding.all.length}`,
        { hint: "A project has a single branding; keep one descriptor under .zitadel/branding/." },
      );
    }
    const branding = this.branding.all[0]?.wireBody(store);
    const policyBodies = this.policies.all.map((policy) => {
      return policy.wireBody(store);
    });
    const policies = policyBodies.length === 0 ? {} : { policies: policyBodies };
    const brandingPart = branding === undefined ? {} : { branding };
    const bundle: ConfigurationBundle = {
      schemas: this.schemas.all.map((schema) => {
        return schema.wireBody(store);
      }),
      flow_definitions: this.flows.all.map((flow) => {
        return flow.wireBody(store);
      }),
      idps: this.connections.all.map((connection) => {
        return connection.wireBody(store);
      }),
      ...policies,
      ...brandingPart,
    };
    const resourceCount =
      this.schemas.all.length +
      this.flows.all.length +
      this.connections.all.length +
      this.policies.all.length +
      this.branding.all.length;
    if (resourceCount === 0) {
      throw new ConfigError("There is nothing in .zitadel/ to deploy", {
        hint: "Add a schema, flow, policy or branding under .zitadel/, or run `zitadel setup` to scaffold one.",
      });
    }
    if (resourceCount > ZitadelConfig.MAX_BUNDLE_RESOURCES) {
      throw new ConfigError(
        `A release pins at most ${ZitadelConfig.MAX_BUNDLE_RESOURCES} resources, but .zitadel/ holds ${resourceCount}`,
      );
    }
    return { bundle, resourceCount };
  }

  /**
   * Scaffold a new project's configuration on top of this one: the default
   * user schema and login flow for a preset and use case, a connection for
   * each chosen provider, and the password policy.
   *
   * @remarks
   * Every file is refused before anything is built, so a conflict is found
   * before the caller creates anything that depends on it. A connection is
   * refused with or without `force`: the file is the developer's, holding a
   * client id registered with the vendor and a slug other files may name, so
   * it is never replaced. Each connection's claim mapping reads the template's
   * properties, which enabling a provider does not change. A password policy
   * kept by `force` is deployed as it is, so it must be a sound password
   * policy.
   *
   * @typeParam P - The provider as the caller chose it, handed back with its
   *   connection.
   * @param options - What to scaffold, and whether files may be replaced.
   * @returns The change that writes it, and its documents.
   * @throws {@link ConnectionExistsError} When a chosen provider already has
   *   a connection.
   * @throws {@link FileExistsError} Without `force`, when the default schema,
   *   flow or password policy file is already there.
   * @throws {@link ConflictError} When a chosen provider's connection would
   *   collide with another connection, by file name, slug or variables.
   * @throws {@link ConfigError} When `force` keeps a password policy file
   *   that is not a sound password policy.
   */
  scaffold<P extends ScaffoldedProvider>(options: ScaffoldOptions<P>): Scaffold<P> {
    const template = UserSchema.create({
      path: DEFAULT_SCHEMA_CONFIG_PATH,
      body: getDefaultHumanUserSchemaBody({ preset: options.preset, useCase: options.useCase }),
    });
    const connections = options.sso.map((chosen) => {
      const provider = providerOf(chosen.selection);
      return { chosen, connection: Connection.forProvider(provider, template, chosen.endpoints) };
    });
    for (const scaffolded of connections) {
      const connection = scaffolded.connection;
      const existing =
        this.connections.existing(connection) ?? this.connections.get(connection.path);
      if (existing !== undefined) {
        throw new ConnectionExistsError(existing.path, scaffolded.chosen.selection);
      }
    }
    const defaults = [
      this.schemas.get(DEFAULT_SCHEMA_CONFIG_PATH),
      this.flows.get(DEFAULT_FLOW_CONFIG_PATH),
      this.policies.get(PasswordPolicy.PATH),
    ];
    for (const taken of defaults) {
      if (!options.force && taken !== undefined) {
        throw new FileExistsError(taken.path);
      }
    }
    const policy = this.scaffoldedPasswordPolicy(options);
    const slugs = options.sso.map((chosen) => {
      return providerOf(chosen.selection).slug;
    });
    // The edits are additive and idempotent, so folding them builds one schema
    // that names every chosen provider.
    const schema = slugs.reduce((document, slug) => {
      return document.withProvider(slug).document;
    }, template);
    // The conflict step a provider needs can only offer what this schema
    // enables, so the methods are read off the composed schema rather than
    // inferred from the preset.
    const login = Flow.create({
      path: DEFAULT_FLOW_CONFIG_PATH,
      body: getDefaultLoginFlow({ preset: options.preset, useCase: options.useCase }),
    });
    const flow = slugs.reduce((document, slug) => {
      return document.withProvider(slug, schema.enabledMethods).document;
    }, login);
    const written = connections.map((scaffolded) => {
      return scaffolded.connection;
    });
    const documents: readonly AnyDocument[] = [schema, flow, ...written, policy];
    const after = documents.reduce((current: ZitadelConfig, document) => {
      return current.with(document);
    }, this);
    return {
      change: new Change({ before: this, after }),
      schema,
      flow,
      connections,
      policy,
    };
  }

  /**
   * The configuration with a document in it: replacing the one at the same
   * path, or added when there is none.
   *
   * @remarks
   * The step every edit is built from; a caller edits through a collection,
   * which returns a {@link Change}.
   *
   * @param document - The edited or new document.
   * @returns The new configuration.
   */
  with(document: AnyDocument): ZitadelConfig {
    return new ZitadelConfig({
      ...ZitadelConfig.edited(this.parts, document, ZitadelConfig.placed),
      // A document put back where one was removed is written, not deleted.
      removed: this.removed.filter((gone) => {
        return gone.path !== document.path;
      }),
    });
  }

  /**
   * The configuration without a document, whose file saving then deletes.
   *
   * @remarks
   * The step a removal is built from; a caller removes through a collection,
   * which returns a {@link Change}. A document created since the
   * configuration was read has no file, so it is dropped and nothing is
   * deleted.
   *
   * @param document - The document to remove.
   * @returns The new configuration.
   */
  without(document: AnyDocument): ZitadelConfig {
    return new ZitadelConfig({
      ...ZitadelConfig.edited(this.parts, document, ZitadelConfig.kept),
      removed: document.status === "created" ? this.removed : [...this.removed, document],
    });
  }

  /**
   * The documents an edit has changed or created since the configuration
   * was read, of every kind, policy test files included.
   *
   * @returns The documents, by kind.
   */
  get changedDocuments(): readonly AnyDocument[] {
    const documents: readonly AnyDocument[] = [
      ...this.schemas.all,
      ...this.flows.all,
      ...this.connections.all,
      ...this.policies.all,
      ...this.policies.tests,
      ...this.branding.all,
    ];
    return documents.filter((document) => {
      return document.changed;
    });
  }

  /**
   * The documents removed since the configuration was read, whose files
   * saving deletes.
   *
   * @returns The documents, in the order they were removed.
   */
  get removedDocuments(): readonly AnyDocument[] {
    return this.removed;
  }

  /**
   * The password policy a scaffold leaves the project with: the one `force`
   * keeps, with the minimum it was given, or a new one.
   *
   * @param options - Whether files may be replaced, and the minimum given.
   * @returns The policy.
   * @throws {@link ConfigError} When `force` keeps a password policy file that
   *   is not a sound password policy.
   */
  private scaffoldedPasswordPolicy(options: ScaffoldOptions): PasswordPolicy {
    const kept = this.policies.password;
    if (!options.force) {
      return PasswordPolicy.initial(options.passwordMinLength);
    }
    if (this.policies.get(PasswordPolicy.PATH) === undefined) {
      return PasswordPolicy.initial(options.passwordMinLength);
    }
    if (kept === undefined || kept.problems({}).length > 0) {
      throw new ConfigError(`${PasswordPolicy.PATH} is not a valid password policy`, {
        hint: "Setup keeps an existing policy file and deploys it, so fix it against .zitadel/meta/policy.json or move it aside to start from an empty one.",
        details: { file: PasswordPolicy.PATH },
      });
    }
    return kept.withMinLength(options.passwordMinLength).document;
  }

  /**
   * Everything the configuration is made of, for an edit to copy and change
   * one part of.
   *
   * @returns The parts.
   */
  private get parts(): Parts {
    return {
      schemas: this.schemas.all,
      flows: this.flows.all,
      connections: this.connections.all,
      policies: this.policies.all,
      policyTests: this.policies.tests,
      brandings: this.branding.all,
      removed: this.removed,
      options: this.options,
    };
  }

  /**
   * The parts of a configuration with one list edited: the list the document's
   * kind is held in.
   *
   * @param parts - The parts.
   * @param document - The document the edit places or leaves out.
   * @param edit - The edit to its list.
   * @returns The new parts.
   */
  private static edited(parts: Parts, document: AnyDocument, edit: ListEdit): Parts {
    switch (document.kind) {
      case "schema": {
        return { ...parts, schemas: edit(parts.schemas, document) };
      }
      case "flow": {
        return { ...parts, flows: edit(parts.flows, document) };
      }
      case "connection": {
        return { ...parts, connections: edit(parts.connections, document) };
      }
      case "policy": {
        return { ...parts, policies: edit(parts.policies, document) };
      }
      case "policy-test": {
        return { ...parts, policyTests: edit(parts.policyTests, document) };
      }
      case "branding": {
        return { ...parts, brandings: edit(parts.brandings, document) };
      }
    }
  }

  /**
   * A list of documents with one in place: replacing the document at the same
   * path, where it was, or appended when there is none.
   *
   * @typeParam T - The kind of document.
   * @param documents - The documents.
   * @param document - The document to place.
   * @returns The new list.
   */
  private static placed<T extends AnyDocument>(documents: readonly T[], document: T): readonly T[] {
    if (
      !documents.some((current) => {
        return current.path === document.path;
      })
    ) {
      return [...documents, document];
    }
    return documents.map((current) => {
      if (current.path === document.path) {
        return document;
      }
      return current;
    });
  }

  /**
   * A list of documents without the one at a document's path.
   *
   * @typeParam T - The kind of document.
   * @param documents - The documents.
   * @param document - The document to leave out.
   * @returns The new list.
   */
  private static kept<T extends AnyDocument>(documents: readonly T[], document: T): readonly T[] {
    return documents.filter((current) => {
      return current.path !== document.path;
    });
  }
}
