import { Branding } from "@/lib/zitadel/resources/branding/branding";
import { Brandings } from "@/lib/zitadel/resources/branding/collection";
import { Connection } from "@/lib/zitadel/resources/connections/connection";
import { Connections } from "@/lib/zitadel/resources/connections/collection";
import { BrokenFilesError } from "@/lib/zitadel/errors";
import { Flow } from "@/lib/zitadel/resources/flows/flow";
import { Flows } from "@/lib/zitadel/resources/flows/collection";
import { Policies } from "@/lib/zitadel/resources/policies/collection";
import { Policy, POLICY_TEST_SUFFIX, PolicyTest } from "@/lib/zitadel/resources/policies/policy";
import { CONTRACT_RULES } from "@/lib/zitadel/rules/contracts";
import { ENVIRONMENT_RULES } from "@/lib/zitadel/rules/environment";
import { FLOW_RULES } from "@/lib/zitadel/rules/flows";
import { SSO_RULES } from "@/lib/zitadel/rules/sso";
import type { Issue, ValidationContext } from "@/lib/zitadel/rules/types";
import { Schemas } from "@/lib/zitadel/resources/schemas/collection";
import { UserSchema } from "@/lib/zitadel/resources/schemas/schema";
import type { ConfigStore } from "@/lib/zitadel/storage/types";
import type { ConfigFiles } from "@/lib/zitadel/types";

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
        .map(Policy.of),
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
      ...edited(this.parts, document, placed),
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
      ...edited(this.parts, document, kept),
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
function edited(parts: Parts, document: AnyDocument, edit: ListEdit): Parts {
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
function placed<T extends AnyDocument>(documents: readonly T[], document: T): readonly T[] {
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
function kept<T extends AnyDocument>(documents: readonly T[], document: T): readonly T[] {
  return documents.filter((current) => {
    return current.path !== document.path;
  });
}
