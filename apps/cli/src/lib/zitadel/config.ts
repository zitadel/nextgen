import { Change } from "@/lib/zitadel/change";
import { Branding } from "@/lib/zitadel/branding/branding";
import { Connection } from "@/lib/zitadel/connections/connection";
import {
  connectionNamed,
  existingConnection,
  type LookupOptions,
} from "@/lib/zitadel/connections/lookup";
import { disableSso, enableSso, ssoFlows, type SsoOptions } from "@/lib/zitadel/connections/sso";
import { Flow } from "@/lib/zitadel/flows/flow";
import { Policy, POLICY_TEST_SUFFIX, PolicyTest } from "@/lib/zitadel/policies/policy";
import type { Step } from "@/lib/zitadel/flows/step";
import { disableMethod, enableMethod, type ForceOptions } from "@/lib/zitadel/schemas/methods";
import { UserSchema } from "@/lib/zitadel/schemas/schema";
import { reachableMethods } from "@/lib/zitadel/schemas/signin";
import { BrokenFilesError } from "@/lib/zitadel/errors";
import { CONTRACT_RULES } from "@/lib/zitadel/rules/contracts";
import { ENVIRONMENT_RULES } from "@/lib/zitadel/rules/environment";
import { FLOW_RULES } from "@/lib/zitadel/rules/flows";
import { SSO_RULES } from "@/lib/zitadel/rules/sso";
import type {
  ConfigFiles,
  ConfigStore,
  Issue,
  ToggleableMethod,
  ValidationContext,
} from "@/lib/zitadel/types";

/** Any document of the configuration. */
export type AnyDocument = UserSchema | Flow | Connection | Policy | Branding;

/** The documents of a configuration, by kind. */
type Parts = Readonly<{
  schemas: readonly UserSchema[];
  flows: readonly Flow[];
  connections: readonly Connection[];
  policies: readonly Policy[];
  policyTests: readonly PolicyTest[];
  brandings: readonly Branding[];
  deployed: ReadonlySet<string> | undefined;
}>;

/** What a configuration knows beyond its files. */
export type ConfigOptions = Readonly<{
  /**
   * The slugs of the connections the server already has. Some advice only
   * holds before a connection's first deploy. Absent when the caller cannot
   * tell, and the advice is then given anyway.
   */
  deployed?: ReadonlySet<string> | undefined;
}>;

/** A provider a flow step offers. */
export type Offer = Readonly<{
  flow: Flow;
  step: Step;
  slug: string;
  /** The connection the slug names, or `undefined` when no file has it. */
  connection: Connection | undefined;
}>;

/**
 * A way to sign up that reaches a step creating a user without ever asking for
 * a property the schema requires, from a provider that does not supply it.
 */
export type SignUpGap = Readonly<{
  flow: Flow;
  schema: UserSchema;
  /** The step that creates the user. */
  step: Step;
  /** The provider the person signed up with. */
  connection: Connection;
  /** The required property's dotted path. */
  path: string;
}>;

/** The outcomes a provider sign-in can end in, which carry the provider to the next step. */
const SSO_OUTCOMES: ReadonlySet<string> = new Set([
  "sso_authenticated",
  "sso_user_not_found",
  "user_already_exists",
]);

/**
 * A project's whole configuration under `.zitadel/`: its user schemas, login
 * flows, identity-provider connections, operation policies and branding, read
 * and written together.
 *
 * @remarks
 * Immutable. An edit returns a new configuration, and {@link save} writes only
 * the files that differ from what was read, or are new. Every question that needs more
 * than one file, such as which connection a flow step offers, is answered
 * here, so no caller reads two files to put them together.
 */
export class ZitadelConfig {
  readonly schemas: readonly UserSchema[];
  readonly flows: readonly Flow[];
  /** Every connection file, in path order. */
  readonly connections: readonly Connection[];
  readonly policies: readonly Policy[];
  /** The policies' test files, which `zitadel policies test` runs and a release never carries. */
  readonly policyTests: readonly PolicyTest[];
  /** Every branding descriptor; a deploy refuses more than one. */
  readonly brandings: readonly Branding[];
  private readonly deployed: ReadonlySet<string> | undefined;

  private constructor(parts: Parts) {
    this.schemas = parts.schemas;
    this.flows = parts.flows;
    this.connections = parts.connections;
    this.policies = parts.policies;
    this.policyTests = parts.policyTests;
    this.brandings = parts.brandings;
    this.deployed = parts.deployed;
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
    const config = ZitadelConfig.of(await readAll(store), options);
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
   * Read the configuration without holding the files to their contracts, for a
   * caller that already has, such as `deploy`, whose validate step checks every
   * file's shape before it checks how the files agree.
   *
   * @param store - Where the configuration is kept.
   * @param options - What is known beyond the files.
   * @returns The configuration.
   */
  static async loadUnchecked(
    store: ConfigStore,
    options: ConfigOptions = {},
  ): Promise<ZitadelConfig> {
    return ZitadelConfig.of(await readAll(store), options);
  }

  /**
   * Take files already in memory as the configuration, without holding them
   * to their contracts: a test states only what a rule reads.
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
        .map(Policy.of),
      policyTests: files.policies
        .filter((file) => {
          return file.path.endsWith(POLICY_TEST_SUFFIX);
        })
        .map(PolicyTest.of),
      brandings: files.branding.map(Branding.of),
      deployed: options.deployed,
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

  /** Every provider a flow step offers, once for each time a step lists it. */
  get offers(): readonly Offer[] {
    return this.flows.flatMap((flow) => {
      return flow.steps.flatMap((step) => {
        return step.providers.map((slug) => {
          return { flow, step, slug, connection: this.connection(slug) };
        });
      });
    });
  }

  /**
   * Every way someone signing up with a provider reaches a step that creates
   * their user without having been asked for a required property the provider
   * does not map.
   *
   * @remarks
   * Walks each flow from its entry steps, one required property at a time. A
   * step that asks for the property ends that path; a provider outcome carries
   * the provider that was chosen on to the next step. The engine keeps every
   * answer given on the way, so a property asked for on an earlier step counts.
   */
  get signUpGaps(): readonly SignUpGap[] {
    return this.flows.flatMap((flow) => {
      const schema = this.schemaOf(flow);
      if (schema === undefined) {
        return [];
      }
      return schema.requiredPaths.flatMap((path) => {
        return this.gapsFor(flow, schema, path);
      });
    });
  }

  /**
   * The connection a slug names: the first file in path order that has it, so
   * two files claiming one slug do not both stand for it.
   *
   * @param slug - The slug.
   * @returns The connection, or `undefined` when no file has the slug.
   */
  connection(slug: string): Connection | undefined {
    return this.connections.find((connection) => {
      return connection.slug === slug;
    });
  }

  /**
   * The local schema a flow's `user_schema` names, by its `objectType` or its
   * `$id`, as `deploy` resolves it.
   *
   * @param flow - The flow.
   * @returns The schema, or `undefined` when no local schema is named.
   */
  schemaOf(flow: Flow): UserSchema | undefined {
    const reference = flow.userSchema;
    if (reference === undefined) {
      return undefined;
    }
    return this.schemas.find((schema) => {
      return schema.isNamedBy(reference);
    });
  }

  /**
   * The schemas that list a provider in `sso.providers`.
   *
   * @param slug - The provider.
   * @returns The schemas.
   */
  schemasListing(slug: string): readonly UserSchema[] {
    return this.schemas.filter((schema) => {
      return schema.lists(slug);
    });
  }

  /**
   * Whether the server is known to have a connection already.
   *
   * @param slug - The connection's slug.
   * @returns True only when the caller said it is deployed.
   */
  isDeployed(slug: string): boolean {
    return this.deployed?.has(slug) === true;
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
   * The flows that run against a user schema: those whose `user_schema` names
   * it, by its `objectType` or its `$id`.
   *
   * @param schema - The schema.
   * @returns Its flows.
   */
  flowsFor(schema: UserSchema): readonly Flow[] {
    return this.flows.filter((flow) => {
      return this.schemaOf(flow)?.path === schema.path;
    });
  }

  /**
   * The local schema at a path.
   *
   * @param path - The schema's project-relative path.
   * @returns The schema, or `undefined` when none is there.
   */
  schema(path: string): UserSchema | undefined {
    return this.schemas.find((schema) => {
      return schema.path === path;
    });
  }

  /**
   * The methods a schema enables that some active login flow lets an existing
   * user sign in with.
   *
   * @param schema - The schema.
   * @returns The methods.
   */
  reachableMethods(schema: UserSchema): readonly string[] {
    return reachableMethods(this, schema);
  }

  /**
   * The schemas that list a provider and the flows that offer it.
   *
   * @param slug - The provider.
   * @returns Their paths.
   */
  offeredBy(slug: string): readonly string[] {
    const schemas = this.schemas.filter((schema) => {
      return schema.lists(slug);
    });
    const flows = this.flows.filter((flow) => {
      return flow.offers(slug);
    });
    return [...schemas, ...flows].map((document) => {
      return document.path;
    });
  }

  /**
   * The variables a connection's credentials read that no other connection
   * reads, so removing them breaks nothing else.
   *
   * @param connection - The connection.
   * @returns The variable names.
   */
  unsharedVariables(connection: Connection): readonly string[] {
    const elsewhere = this.connections
      .filter((other) => {
        return other.path !== connection.path;
      })
      .flatMap((other) => {
        return other.variableNames;
      });
    return connection.variableNames.filter((name) => {
      return !elsewhere.includes(name);
    });
  }

  /**
   * The connection already in the project that a new one would be.
   *
   * @param candidate - The connection that would be written.
   * @param options - What is known beyond the file.
   * @returns The existing connection, or `undefined` when it is new.
   * @throws {@link ConflictError} When it would step on another connection.
   */
  existingConnection(candidate: Connection, options: LookupOptions = {}): Connection | undefined {
    return existingConnection(this.connections, candidate, options);
  }

  /**
   * The connection a slug names, with everything the slug alone decides
   * refused, so a caller can check a slug the moment it is typed.
   *
   * @param slug - The slug.
   * @param issuer - The issuer the developer gave, if any.
   * @returns The connection, or `undefined` when the slug is free.
   * @throws {@link ConflictError} When the slug is ambiguous or names a
   *   connection to another issuer.
   */
  connectionNamed(slug: string, issuer?: string): Connection | undefined {
    return connectionNamed(this.connections, slug, issuer);
  }

  /**
   * The login flows a provider would be offered on.
   *
   * @param schema - The schema.
   * @returns The flows.
   * @throws {@link NotFoundError} When no flow runs against the schema.
   * @throws {@link RefusedEditError} When a region the edit writes is not the shape it writes.
   */
  ssoFlows(schema: UserSchema): readonly Flow[] {
    return ssoFlows(this, schema);
  }

  /**
   * Add a document, or replace the one at its path.
   *
   * @param document - The new or edited document.
   * @returns The change.
   */
  put(document: AnyDocument): Change {
    return new Change({ before: this, after: this.with(document) });
  }

  /**
   * Turn a method on for a user schema.
   *
   * @param schema - The schema.
   * @param method - The method.
   * @returns The change.
   * @throws {@link RefusedEditError} When the edit cannot be made.
   * @throws {@link BrokenFlowsError} When a flow would stop validating.
   */
  enableMethod(schema: UserSchema, method: ToggleableMethod): Change {
    return enableMethod(this, schema, method);
  }

  /**
   * Turn a method off for a user schema.
   *
   * @param schema - The schema.
   * @param method - The method.
   * @param options - Whether to leave the schema with no way to sign in.
   * @returns The change.
   * @throws {@link BrokenFlowsError} When a flow still uses the method.
   * @throws {@link NoSignInLeftError} When it is the last way to sign in.
   */
  disableMethod(schema: UserSchema, method: ToggleableMethod, options: ForceOptions = {}): Change {
    return disableMethod(this, schema, method, options);
  }

  /**
   * Offer a provider on a user schema, writing its connection unless the
   * project already has it.
   *
   * @param schema - The schema.
   * @param connection - The connection to write when the project has none for the provider.
   * @param options - What is known beyond the connection.
   * @returns The change.
   * @throws {@link ConfigError} When anything about it is refused.
   */
  enableSso(schema: UserSchema, connection: Connection, options: SsoOptions = {}): Change {
    return enableSso(this, schema, connection, options);
  }

  /**
   * Stop offering a provider on a user schema. The connection file stays.
   *
   * @param schema - The schema.
   * @param slug - The provider.
   * @param options - Whether to leave the schema with no way to sign in.
   * @returns The change.
   * @throws {@link ConfigError} When anything about it is refused.
   */
  disableSso(schema: UserSchema, slug: string, options: ForceOptions = {}): Change {
    return disableSso(this, schema, slug, options);
  }

  /**
   * The configuration with a document in it: replacing the one at the same
   * path, or added when there is none.
   *
   * @param document - The edited or new document.
   * @returns The new configuration.
   */
  with(document: AnyDocument): ZitadelConfig {
    const parts: Parts = {
      schemas: this.schemas,
      flows: this.flows,
      connections: this.connections,
      policies: this.policies,
      policyTests: this.policyTests,
      brandings: this.brandings,
      deployed: this.deployed,
    };
    if (document instanceof UserSchema) {
      return new ZitadelConfig({ ...parts, schemas: placed(this.schemas, document) });
    }
    if (document instanceof Flow) {
      return new ZitadelConfig({ ...parts, flows: placed(this.flows, document) });
    }
    if (document instanceof Connection) {
      return new ZitadelConfig({ ...parts, connections: placed(this.connections, document) });
    }
    if (document instanceof Policy) {
      return new ZitadelConfig({ ...parts, policies: placed(this.policies, document) });
    }
    return new ZitadelConfig({ ...parts, brandings: placed(this.brandings, document) });
  }

  /** The documents an edit has changed or created since the configuration was read. */
  get changedDocuments(): readonly AnyDocument[] {
    const documents: readonly AnyDocument[] = [
      ...this.schemas,
      ...this.flows,
      ...this.connections,
      ...this.policies,
      ...this.brandings,
    ];
    return documents.filter((document) => {
      return document.changed;
    });
  }

  /**
   * The sign-up gaps for one required property of one flow.
   *
   * @param flow - The flow.
   * @param schema - The schema it runs against.
   * @param path - The required property's dotted path.
   * @returns The gaps.
   */
  private gapsFor(flow: Flow, schema: UserSchema, path: string): SignUpGap[] {
    const unasked = (name: string): Step | undefined => {
      const step = flow.step(name);
      if (step === undefined || step.asksFor(path)) {
        return undefined;
      }
      return step;
    };
    const starts = flow.entrySteps.flatMap((name) => {
      const step = unasked(name);
      if (step === undefined) {
        return [];
      }
      return [{ step, provider: "" }];
    });
    const visits = walk(starts, (visit) => {
      return visit.step.transitions.flatMap((transition) => {
        const next = unasked(transition.target);
        if (next === undefined) {
          return [];
        }
        if (SSO_OUTCOMES.has(transition.outcome)) {
          return visit.step.providers.map((provider) => {
            return { step: next, provider };
          });
        }
        return [{ step: next, provider: visit.provider }];
      });
    });
    const top = path.split(".")[0] ?? path;
    return visits.flatMap((visit) => {
      const connection = this.connection(visit.provider);
      if (
        !visit.step.createsUserFromSso ||
        connection === undefined ||
        !connection.createsUsers ||
        connection.maps(top)
      ) {
        return [];
      }
      return [{ flow, schema, step: visit.step, connection, path }];
    });
  }
}

/**
 * Every file of the configuration.
 *
 * @param store - Where the configuration is kept.
 * @returns The files, by kind.
 */
async function readAll(store: ConfigStore): Promise<ConfigFiles> {
  const [schemas, flows, connections, policies, branding] = await Promise.all([
    store.read("schemas"),
    store.read("flows"),
    store.read("connections"),
    store.read("policies"),
    store.read("branding"),
  ]);
  return { schemas, flows, connections, policies, branding };
}

/**
 * A list of documents with one in place: replacing the document at the same
 * path, or appended when there is none.
 *
 * @param documents - The documents.
 * @param document - The document to place.
 * @returns The new list.
 */
function placed<T extends { readonly path: string }>(documents: readonly T[], document: T): T[] {
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

/** A step reached while walking a flow, and the provider chosen on the way there. */
type Visit = Readonly<{ step: Step; provider: string }>;

/**
 * Every visit reachable from the starts, each once.
 *
 * @param starts - Where the walk begins.
 * @param next - The visits one step on from a visit.
 * @returns The visits, in the order they were reached.
 */
function walk(starts: readonly Visit[], next: (visit: Visit) => readonly Visit[]): Visit[] {
  const seen = new Map<string, Visit>();
  const queue = [...starts];
  // A queue drained as it grows: the walk ends when no visit is new.
  while (queue.length > 0) {
    const visit = queue.shift();
    if (visit === undefined) {
      break;
    }
    const key = JSON.stringify([visit.step.name, visit.provider]);
    if (!seen.has(key)) {
      seen.set(key, visit);
      queue.push(...next(visit));
    }
  }
  return [...seen.values()];
}
