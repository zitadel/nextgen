import {
  DEFAULT_FLOW_CONFIG_PATH,
  DEFAULT_SCHEMA_CONFIG_PATH,
  getDefaultHumanUserSchemaBody,
  getDefaultLoginFlow,
  type SetupPreset,
  type SetupUseCase,
} from "@zitadel/config/defaults";
import { providerOf } from "@zitadel/config/idp";

import { Change } from "@/lib/zitadel/change";
import { BrokenFile } from "@/lib/zitadel/resources/broken";
import { Branding } from "@/lib/zitadel/resources/branding/branding";
import { Brandings } from "@/lib/zitadel/resources/branding/collection";
import { Connection } from "@/lib/zitadel/resources/connections/connection";
import { Connections } from "@/lib/zitadel/resources/connections/collection";
import {
  BrokenFilesError,
  ConfigError,
  ConflictError,
  ConnectionExistsError,
  FileExistsError,
} from "@/lib/zitadel/errors";
import { Flow } from "@/lib/zitadel/resources/flows/flow";
import { Flows } from "@/lib/zitadel/resources/flows/collection";
import { Policies } from "@/lib/zitadel/resources/policies/collection";
import { PasswordPolicy } from "@/lib/zitadel/resources/policies/password";
import type { Policy } from "@/lib/zitadel/resources/policies/policy";
import { SignupPolicy } from "@/lib/zitadel/resources/policies/signup";
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
import { toJsonObject } from "@/lib/zitadel/utils/json";
import {
  CONFIG_KINDS,
  type BuiltBundle,
  type ConfigFiles,
  type ConfigKind,
  type ConfigurationBundle,
  type Scaffold,
  type ScaffoldedProvider,
  type ScaffoldOptions,
  type StoredFile,
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
export type ConfigOptions = {
  /**
   * The slugs of the connections the server already has.
   *
   * @remarks
   * Some advice only holds before a connection's first deploy. Absent when
   * the caller cannot tell, and the advice is then given anyway.
   */
  readonly deployed?: ReadonlySet<string> | undefined;

  /**
   * The platform ids each user schema was published as, by the schema's
   * project-relative path: the id it was last synced as and the one that
   * replaced, which a flow's `user_schema` may still name.
   *
   * @remarks
   * Absent before a first deploy, and for a caller that does not keep them;
   * a flow is then matched to its schema by what the schema file states.
   */
  readonly published?: ReadonlyMap<string, readonly string[]> | undefined;
};

/**
 * The documents of a configuration by kind, the files that are no document,
 * what it knows beyond them, and the files it was read as.
 */
type Parts = {
  readonly schemas: readonly UserSchema[];
  readonly flows: readonly Flow[];
  readonly connections: readonly Connection[];
  readonly policies: readonly Policy[];
  readonly policyTests: readonly PolicyTest[];
  readonly brandings: readonly Branding[];
  readonly broken: readonly BrokenFile[];
  readonly read: readonly (AnyDocument | BrokenFile)[];
  readonly options: ConfigOptions;
};

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
   * The files read that their kind's contract refuses, so no collection holds
   * them: schemas, flows, connections, policies, policy test files and
   * branding, in that order and each kind in the order it was read.
   */
  readonly broken: readonly BrokenFile[];

  /**
   * What the configuration knows beyond its files.
   */
  readonly options: ConfigOptions;

  /**
   * The documents and broken files the configuration was read as, whose
   * files are on disk.
   */
  private readonly read: readonly (AnyDocument | BrokenFile)[];

  /**
   * Hold the documents of a configuration in their collections.
   *
   * @param parts - The documents by kind, the broken files, the options and
   *   the files it was read as.
   */
  private constructor(parts: Parts) {
    this.schemas = new Schemas(this, parts.schemas);
    this.flows = new Flows(this, parts.flows);
    this.connections = new Connections(this, parts.connections);
    this.policies = new Policies(this, parts.policies, parts.policyTests);
    this.branding = new Brandings(this, parts.brandings);
    this.broken = parts.broken;
    this.options = parts.options;
    this.read = parts.read;
  }

  /**
   * Read the configuration and hold every file to its contract.
   *
   * @remarks
   * Refuses every broken file, and every finding a document makes about
   * itself, so a configuration that loads is one whose files validate on
   * their own. A broken policy test file is left to `zitadel policy test`,
   * as no release carries one.
   *
   * @param store - Where the configuration is kept.
   * @param options - What is known beyond the files.
   * @returns The configuration, holding no broken file of a kind a release
   *   carries.
   * @throws {@link BrokenFilesError} Naming every file the contract rules refuse.
   */
  static async load(store: ConfigStore, options: ConfigOptions = {}): Promise<ZitadelConfig> {
    const config = await ZitadelConfig.loadUnchecked(store, options);
    return config.refuseBroken(store);
  }

  /**
   * Read the configuration without refusing a broken file.
   *
   * @remarks
   * For a caller that reports everything in one pass, such as `deploy`, whose
   * validate step reports every broken file beside how the valid ones agree.
   * The broken files are kept on {@link broken}.
   *
   * @param store - Where the configuration is kept.
   * @param options - What is known beyond the files.
   * @returns The configuration.
   */
  static async loadUnchecked(
    store: ConfigStore,
    options: ConfigOptions = {},
  ): Promise<ZitadelConfig> {
    return ZitadelConfig.loadKinds(store, CONFIG_KINDS, options);
  }

  /**
   * Read only some kinds of the configuration, without refusing a broken file.
   *
   * @remarks
   * For a caller that needs some kinds and must not fail on an unreadable file
   * of another. The kinds not named are not read and are empty, so every rule
   * and question about them sees no file: a flow's connection is not found
   * when connections were not read, and nothing is broken in a kind that was
   * not read. Name every kind the caller, or an edit it saves, looks at.
   *
   * @param store - Where the configuration is kept.
   * @param kinds - The kinds to read.
   * @param options - What is known beyond the files.
   * @returns The configuration, with the kinds not named empty.
   * @throws The error the read of the first named kind in the kinds' fixed
   *   order (schemas, flows, connections, policies, branding) failed with.
   */
  static async loadKinds(
    store: ConfigStore,
    kinds: readonly ConfigKind[],
    options: ConfigOptions = {},
  ): Promise<ZitadelConfig> {
    const settled = await Promise.allSettled([
      ZitadelConfig.readKind(store, kinds, "schemas"),
      ZitadelConfig.readKind(store, kinds, "flows"),
      ZitadelConfig.readKind(store, kinds, "connections"),
      ZitadelConfig.readKind(store, kinds, "policies"),
      ZitadelConfig.readKind(store, kinds, "branding"),
    ]);
    return ZitadelConfig.of(
      {
        schemas: ZitadelConfig.unwrap(settled[0]),
        flows: ZitadelConfig.unwrap(settled[1]),
        connections: ZitadelConfig.unwrap(settled[2]),
        policies: ZitadelConfig.unwrap(settled[3]),
        branding: ZitadelConfig.unwrap(settled[4]),
      },
      options,
    );
  }

  /**
   * Read one kind's files when the caller asked for the kind, and none when it
   * did not.
   *
   * @param store - Where the configuration is kept.
   * @param kinds - The kinds the caller asked for.
   * @param kind - The kind to read.
   * @returns The kind's files, none when it was not asked for.
   * @throws {@link ConfigError} When a file of an asked-for kind cannot be read.
   */
  private static async readKind(
    store: ConfigStore,
    kinds: readonly ConfigKind[],
    kind: ConfigKind,
  ): Promise<readonly StoredFile[]> {
    if (!kinds.includes(kind)) {
      return [];
    }
    return store.read(kind);
  }

  /**
   * Take what one kind's read gave, or fail as it failed.
   *
   * @remarks
   * The reads run together, so the kinds are unwrapped one after another in
   * their fixed order (schemas, flows, connections, policies, branding). When
   * several fail, the same one is named every time, rather than whichever
   * settled first.
   *
   * @typeParam T - What the read gave.
   * @param result - How the read ended.
   * @returns What the read gave.
   * @throws The error the read failed with.
   */
  private static unwrap<T>(result: PromiseSettledResult<T>): T {
    if (result.status === "rejected") {
      throw result.reason;
    }
    return result.value;
  }

  /**
   * Take files already in memory as the configuration: each file a document
   * of its kind, or a broken file when its contract refuses it.
   *
   * @remarks
   * Refuses nothing, like {@link loadUnchecked}. Every kind is held in the order
   * given; a store reads its files in path order.
   *
   * @param files - The files, by kind.
   * @param options - What is known beyond the files.
   * @returns The configuration.
   */
  static of(files: ConfigFiles, options: ConfigOptions = {}): ZitadelConfig {
    const schemas = files.schemas.map(UserSchema.read);
    const flows = files.flows.map(Flow.read);
    const connections = files.connections.map(Connection.read);
    const policies = files.policies
      .filter((file) => {
        return !file.path.endsWith(POLICY_TEST_SUFFIX);
      })
      .map(Policies.read);
    const policyTests = files.policies
      .filter((file) => {
        return file.path.endsWith(POLICY_TEST_SUFFIX);
      })
      .map(PolicyTest.read);
    const brandings = files.branding.map(Branding.read);
    const readings = [
      ...schemas,
      ...flows,
      ...connections,
      ...policies,
      ...policyTests,
      ...brandings,
    ];
    return new ZitadelConfig({
      schemas: ZitadelConfig.documentsIn(schemas),
      flows: ZitadelConfig.documentsIn(flows),
      connections: ZitadelConfig.documentsIn(connections),
      policies: ZitadelConfig.documentsIn(policies),
      policyTests: ZitadelConfig.documentsIn(policyTests),
      brandings: ZitadelConfig.documentsIn(brandings),
      broken: readings.filter((reading): reading is BrokenFile => {
        return reading instanceof BrokenFile;
      }),
      read: [
        ...readings.filter((reading): reading is AnyDocument => {
          return !(reading instanceof BrokenFile);
        }),
        ...readings.filter((reading): reading is BrokenFile => {
          return reading instanceof BrokenFile;
        }),
      ],
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
   * call, with the messages the server would answer. Only documents are
   * bundled, but a broken file counts towards both, as the file it would be.
   *
   * @param store - Where branding's referenced files are read from.
   * @returns The bundle and how many resources it carries.
   * @throws {@link ConfigError} When there is nothing to deploy, more than one
   *   branding, or more resources than a release may pin.
   */
  bundle(store: ConfigStore): BuiltBundle {
    const brandingCount =
      this.branding.all.length +
      this.broken.filter((file) => {
        return file.kind === "branding";
      }).length;
    // A project has one branding, so the bundle carries a single one. The cap
    // below would not catch a second descriptor, so it is refused here, before
    // anything is inlined or sent.
    if (brandingCount > 1) {
      throw new ConfigError(
        `A release carries at most one branding, but .zitadel/branding/ holds ${brandingCount}`,
        { hint: "A project has a single branding; keep one descriptor under .zitadel/branding/." },
      );
    }
    const branding = this.branding.all[0]?.toWireBody(store);
    const policyBodies = this.policies.all.map((policy) => {
      return policy.toWireBody(store);
    });
    const policies = policyBodies.length === 0 ? {} : { policies: policyBodies };
    const brandingPart = branding === undefined ? {} : { branding };
    const bundle: ConfigurationBundle = {
      schemas: this.schemas.all.map((schema) => {
        return schema.toWireBody(store);
      }),
      flow_definitions: this.flows.all.map((flow) => {
        return flow.toWireBody(store);
      }),
      idps: this.connections.all.map((connection) => {
        return connection.toWireBody(store);
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
    // A broken file is left out of the bundle, which a deploy never sends
    // while one is there, but it still counts: its validation names it.
    const fileCount =
      resourceCount +
      this.broken.filter((file) => {
        return file.kind !== "policy-test";
      }).length;
    if (fileCount === 0) {
      throw new ConfigError("There is nothing in .zitadel/ to deploy", {
        hint: "Add a schema, flow, policy or branding under .zitadel/, or run `zitadel setup` to scaffold one.",
      });
    }
    if (fileCount > ZitadelConfig.MAX_BUNDLE_RESOURCES) {
      throw new ConfigError(
        `A release pins at most ${ZitadelConfig.MAX_BUNDLE_RESOURCES} resources, but .zitadel/ holds ${fileCount}`,
      );
    }
    return { bundle, resourceCount };
  }

  /**
   * Scaffold a new project's configuration on top of this one: the default
   * user schema and login flow for a preset and use case, a connection for
   * each chosen provider, the password policy and the sign-up policy.
   *
   * @remarks
   * Every file is refused before anything is built, so a conflict is found
   * before the caller creates anything that depends on it. A connection is
   * refused with or without `force`: the file is the developer's, holding a
   * client id registered with the vendor and a slug other files may name, so
   * it is never replaced. Each connection's claim mapping reads the template's
   * properties, which enabling a provider does not change. A password or
   * sign-up policy kept by `force` is deployed as it is, so it must be a sound
   * policy of its operation. A broken file at any of these paths stands in
   * the way just as a document there does.
   *
   * @typeParam P - The provider as the caller chose it, handed back with its
   *   connection.
   * @param options - What to scaffold, and whether files may be replaced.
   * @returns The change that writes it, and its documents.
   * @throws {@link ConnectionExistsError} When a chosen provider already has
   *   a connection.
   * @throws {@link FileExistsError} Without `force`, when the default schema,
   *   flow, password policy or sign-up policy file is already there.
   * @throws {@link ConflictError} When a chosen provider's connection would
   *   collide with another connection, by file name, slug or variables, or when
   *   two providers would create the same property as different types.
   * @throws {@link ConfigError} When `force` keeps a password or sign-up
   *   policy file that is not a sound policy of its operation.
   */
  scaffold<P extends ScaffoldedProvider>(options: ScaffoldOptions<P>): Scaffold<P> {
    const variant = { preset: options.preset, useCase: options.useCase };
    // The defaults are typed by the API's generated models, so each enters the
    // library through the one JSON check.
    const flowBody = toJsonObject(getDefaultLoginFlow(variant), "The default login flow");
    const template = ZitadelConfig.defaultSchema(options.preset, options.useCase);
    const connections = options.sso.map((chosen) => {
      const plain = Connection.forProvider(
        providerOf(chosen.selection),
        template,
        chosen.endpoints,
      );
      const claims = chosen.claims?.(plain, template);
      return {
        chosen,
        connection: claims === undefined ? plain : plain.withClaims(claims).document,
        created: claims?.created ?? [],
        notes: claims?.notes ?? [],
      };
    });
    const proposed = connections.flatMap((scaffolded) => {
      return scaffolded.created;
    });
    const clashing = proposed.find((property) => {
      return proposed.some((other) => {
        return other.name === property.name && other.type !== property.type;
      });
    });
    if (clashing !== undefined) {
      const types = [
        ...new Set(
          proposed
            .filter((property) => {
              return property.name === clashing.name;
            })
            .map((property) => {
              return property.type;
            }),
        ),
      ];
      throw new ConflictError(
        `Two providers would create ${clashing.name} in the user schema as different types: ${types.join(" and ")}`,
        {
          hint: "Give the property one type for both providers, or map the claims to different property names.",
          details: { property: clashing.name, types },
        },
      );
    }
    const created = [
      ...new Map(
        proposed.map((property) => {
          return [property.name, property] as const;
        }),
      ).values(),
    ];
    for (const scaffolded of connections) {
      const connection = scaffolded.connection;
      // `resolveExisting` refuses any connection file at the path, so only a
      // broken file can still stand there.
      const existing =
        this.connections.resolveExisting(connection) ?? this.findBroken(connection.path);
      if (existing !== undefined) {
        throw new ConnectionExistsError(existing.path, scaffolded.chosen.selection);
      }
    }
    const defaults = [
      this.schemas.get(DEFAULT_SCHEMA_CONFIG_PATH) ?? this.findBroken(DEFAULT_SCHEMA_CONFIG_PATH),
      this.flows.get(DEFAULT_FLOW_CONFIG_PATH) ?? this.findBroken(DEFAULT_FLOW_CONFIG_PATH),
      this.policies.get(PasswordPolicy.PATH) ?? this.findBroken(PasswordPolicy.PATH),
      this.policies.get(SignupPolicy.PATH) ?? this.findBroken(SignupPolicy.PATH),
    ];
    for (const taken of defaults) {
      if (!options.force && taken !== undefined) {
        throw new FileExistsError(taken.path);
      }
    }
    const policy = this.scaffoldedPasswordPolicy(options);
    const signupPolicy = this.scaffoldedSignupPolicy(options);
    const slugs = options.sso.map((chosen) => {
      return providerOf(chosen.selection).slug;
    });
    // The edits are additive and idempotent, so folding them builds one schema
    // that names every chosen provider.
    const schema = slugs.reduce((document, slug) => {
      return document.withProvider(slug).document;
    }, template.withProperties(created).document);
    // The conflict step a provider needs can only offer what this schema
    // enables, so the methods are read off the composed schema rather than
    // inferred from the preset.
    const login = Flow.create({ path: DEFAULT_FLOW_CONFIG_PATH, body: flowBody }).withFields(
      created.map((property) => {
        return property.name;
      }),
    ).document;
    const flow = slugs.reduce((document, slug) => {
      return document.withProvider(slug, schema.enabledMethods).document;
    }, login);
    const written = connections.map((scaffolded) => {
      return scaffolded.connection;
    });
    const documents: readonly AnyDocument[] = [
      schema,
      flow,
      ...written,
      policy,
      ...(signupPolicy === undefined ? [] : [signupPolicy]),
    ];
    const after = documents.reduce((current: ZitadelConfig, document) => {
      return current.with(document);
    }, this);
    return {
      change: new Change({ before: this, after }),
      schema,
      flow,
      connections,
      policy,
      signupPolicy,
    };
  }

  /**
   * The default user schema for a preset and use case, as a scaffold starts
   * from it.
   *
   * @remarks
   * What a developer's claim mapping is read against before the schema file
   * exists.
   *
   * @param preset - The sign-in preset.
   * @param useCase - The use case.
   * @returns The schema, at the default schema's path.
   */
  static defaultSchema(preset: SetupPreset, useCase: SetupUseCase): UserSchema {
    return UserSchema.create({
      path: DEFAULT_SCHEMA_CONFIG_PATH,
      body: toJsonObject(getDefaultHumanUserSchemaBody({ preset, useCase }), "The default schema"),
    });
  }

  /**
   * The configuration with a document in it: replacing the one at the same
   * path, or added when there is none.
   *
   * @remarks
   * The step every edit is built from; a caller edits through a collection,
   * which returns a {@link Change}. A broken file at the document's path is
   * no longer reported, since saving writes the document over it.
   *
   * @param document - The edited or new document.
   * @returns The new configuration.
   */
  with(document: AnyDocument): ZitadelConfig {
    const parts = ZitadelConfig.editParts(this.parts, document, ZitadelConfig.place);
    // A document written over a broken file replaces it.
    const broken = this.broken.filter((file) => {
      return file.path !== document.path;
    });
    return new ZitadelConfig({ ...parts, broken });
  }

  /**
   * The same configuration, knowing more than it did.
   *
   * @remarks
   * Replaces the options and keeps everything else: the documents, the broken
   * files and what was removed. For a caller that has to read the files to
   * learn what to pass, such as the ids a chosen schema was published as.
   *
   * @param options - What is known beyond the files, in place of what was.
   * @returns The new configuration.
   */
  withOptions(options: ConfigOptions): ZitadelConfig {
    return new ZitadelConfig({ ...this.parts, options });
  }

  /**
   * This configuration, once every file is held to its contract.
   *
   * @remarks
   * Refuses every broken file, and every finding a document makes about
   * itself, so a configuration that passes is one whose files validate on
   * their own. A broken policy test file is left to `zitadel policy test`,
   * as no release carries one.
   *
   * @param store - Where the configuration is kept, for the rules that read
   *   beside the files.
   * @returns This configuration.
   * @throws {@link BrokenFilesError} Naming every file the contract rules refuse.
   */
  refuseBroken(store: ConfigStore): ZitadelConfig {
    const problems = CONTRACT_RULES.flatMap((rule) => {
      return rule.check(this, { store });
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
    return this;
  }

  /**
   * The configuration without a document, whose file saving then deletes.
   *
   * @remarks
   * The step a removal is built from; a caller removes through a collection,
   * which returns a {@link Change}. A file is deleted only when the
   * configuration was read with one at the path: a document created since
   * has no file, unless it was written over one that was.
   *
   * @param document - The document to remove.
   * @returns The new configuration.
   */
  without(document: AnyDocument): ZitadelConfig {
    const parts = ZitadelConfig.editParts(this.parts, document, ZitadelConfig.leaveOut);
    return new ZitadelConfig(parts);
  }

  /**
   * The configuration without a broken file, whose file saving then deletes.
   *
   * @remarks
   * The step removing a file no document holds is built from; a caller removes
   * through a collection, which returns a {@link Change}.
   *
   * @param file - The broken file to remove.
   * @returns The new configuration.
   */
  withoutBroken(file: BrokenFile): ZitadelConfig {
    const broken = this.broken.filter((current) => {
      return current.path !== file.path;
    });
    return new ZitadelConfig({ ...this.parts, broken });
  }

  /**
   * The documents and broken files the configuration was read as that it no
   * longer holds, whose files saving deletes.
   *
   * @remarks
   * Exact whatever the edits were: a path is removed when the configuration
   * was read with a file there and holds nothing at it now, so removing,
   * recreating and removing again deletes the file once, and a document
   * written over a file and then left out still deletes that file.
   *
   * @returns What was removed, in the order the files were read.
   */
  get removedDocuments(): readonly (AnyDocument | BrokenFile)[] {
    const held = new Set(
      [
        ...this.schemas.all,
        ...this.flows.all,
        ...this.connections.all,
        ...this.policies.all,
        ...this.policies.tests,
        ...this.branding.all,
        ...this.broken,
      ].map((file) => {
        return file.path;
      }),
    );
    return this.read.filter((file) => {
      return !held.has(file.path);
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
      return document.isUnsaved;
    });
  }

  /**
   * Find the broken file at a path.
   *
   * @param path - The project-relative path.
   * @returns The broken file, or `undefined` when the file there, if any, is
   *   a document.
   */
  findBroken(path: string): BrokenFile | undefined {
    return this.broken.find((file) => {
      return file.path === path;
    });
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
    const taken = this.policies.get(PasswordPolicy.PATH) ?? this.findBroken(PasswordPolicy.PATH);
    if (taken === undefined) {
      return PasswordPolicy.initial(options.passwordMinLength);
    }
    if (kept === undefined) {
      throw new ConfigError(`${PasswordPolicy.PATH} is not a valid password policy`, {
        hint: "Setup keeps an existing policy file and deploys it, so fix it against .zitadel/meta/policy.json or move it aside to start from an empty one.",
        details: { file: PasswordPolicy.PATH },
      });
    }
    return kept.withMinLength(options.passwordMinLength).document;
  }

  /**
   * The sign-up policy a scaffold leaves the project with: the one `force`
   * keeps, as it is, or the default.
   *
   * @param options - Whether files may be replaced, and whether a project
   *   without the policy gets the default.
   * @returns The policy, or `undefined` when the project has none and gets
   *   none.
   * @throws {@link ConfigError} When `force` keeps a sign-up policy file that
   *   is not a sound sign-up policy.
   */
  private scaffoldedSignupPolicy(options: ScaffoldOptions): SignupPolicy | undefined {
    const taken = options.force
      ? (this.policies.get(SignupPolicy.PATH) ?? this.findBroken(SignupPolicy.PATH))
      : undefined;
    if (taken === undefined) {
      return options.signupPolicy === false ? undefined : SignupPolicy.initial();
    }
    const kept = this.policies.signup;
    if (kept === undefined) {
      throw new ConfigError(`${SignupPolicy.PATH} is not a valid sign-up policy`, {
        hint: "Setup keeps an existing policy file and deploys it, so fix it against .zitadel/meta/policy.json or move it aside to start from the default.",
        details: { file: SignupPolicy.PATH },
      });
    }
    return kept;
  }

  /**
   * Keep the documents of some files read, leaving out the broken ones.
   *
   * @typeParam T - The kind of document.
   * @param readings - What each file was read as, in the order read.
   * @returns The documents, in the same order.
   */
  private static documentsIn<T extends AnyDocument>(
    readings: readonly (T | BrokenFile)[],
  ): readonly T[] {
    return readings.filter((reading): reading is T => {
      return !(reading instanceof BrokenFile);
    });
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
      broken: this.broken,
      read: this.read,
      options: this.options,
    };
  }

  /**
   * Edit one list of a configuration's parts: the list the document's kind is
   * held in.
   *
   * @remarks
   * Switches on the document's `kind`, so a new kind of document that is not
   * handled here does not compile.
   *
   * @param parts - The parts.
   * @param document - The document the edit places or leaves out.
   * @param edit - The edit to its list.
   * @returns The new parts.
   */
  private static editParts(parts: Parts, document: AnyDocument, edit: ListEdit): Parts {
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
   * Place a document in a list: replacing the document at the same path, where
   * it was, or appended when there is none.
   *
   * @typeParam T - The kind of document.
   * @param documents - The documents.
   * @param document - The document to place.
   * @returns The new list.
   */
  private static place<T extends AnyDocument>(documents: readonly T[], document: T): readonly T[] {
    const there = documents.some((current) => {
      return current.path === document.path;
    });
    if (!there) {
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
   * Leave the document at a document's path out of a list.
   *
   * @typeParam T - The kind of document.
   * @param documents - The documents.
   * @param document - The document to leave out.
   * @returns The new list.
   */
  private static leaveOut<T extends AnyDocument>(
    documents: readonly T[],
    document: T,
  ): readonly T[] {
    return documents.filter((current) => {
      return current.path !== document.path;
    });
  }
}
