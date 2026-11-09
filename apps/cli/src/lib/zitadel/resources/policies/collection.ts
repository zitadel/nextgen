import { basename } from "node:path";

import type { BrokenFile } from "@/lib/zitadel/resources/broken";
import { Collection } from "@/lib/zitadel/resources/collection";
import type { ZitadelConfig } from "@/lib/zitadel/config";
import type { ReadableFile } from "@/lib/zitadel/resources/document";
import { PasswordPolicy } from "@/lib/zitadel/resources/policies/password";
import { Policy } from "@/lib/zitadel/resources/policies/policy";
import { PolicyTest } from "@/lib/zitadel/resources/policies/suite";
import type { PolicySelection } from "@/lib/zitadel/resources/policies/types";
import { CONFIG_DIRECTORIES } from "@/lib/zitadel/types";

/**
 * The operation policies under `.zitadel/policies/`, and the test files
 * beside them.
 */
export class Policies extends Collection<Policy> {
  /**
   * The kinds of file the collection owns: policies and their test files.
   */
  readonly kinds = ["policy", "policy-test"] as const;

  /**
   * The policies' test files, which `zitadel policies test` runs and a
   * release never carries.
   */
  readonly tests: readonly PolicyTest[];

  /**
   * Hold the policies of a configuration and their test files.
   *
   * @param config - The configuration the collection is part of.
   * @param documents - The policies.
   * @param tests - The policies' test files.
   */
  constructor(config: ZitadelConfig, documents: readonly Policy[], tests: readonly PolicyTest[]) {
    super(config, documents);
    this.tests = tests;
  }

  /**
   * Read a policy file into the class that knows its operation: a
   * {@link PasswordPolicy} for the password operation, a plain {@link Policy}
   * for any other.
   *
   * @param file - The file.
   * @returns The policy, marked as read, or the broken file it is.
   */
  static read(file: ReadableFile): Policy | BrokenFile {
    if (!("unparsed" in file) && file.body.operation === PasswordPolicy.OPERATION) {
      return PasswordPolicy.read(file);
    }
    return Policy.read(file);
  }

  /**
   * The password policy, which `setup` writes and keeps.
   *
   * @returns The policy for the password operation at its file, or
   *   `undefined` when there is none.
   */
  get password(): PasswordPolicy | undefined {
    const policy = this.get(PasswordPolicy.PATH);
    if (policy instanceof PasswordPolicy) {
      return policy;
    }
    return undefined;
  }

  /**
   * Select the sound policies of some operations, and say what is wrong with
   * the rest.
   *
   * @remarks
   * A policy with a problem is never "no policy": testing `{}` in its place
   * would report on a policy nobody wrote.
   *
   * @param operations - The operations whose policies are read; every one
   *   when empty.
   * @returns The sound policies, and a line per problem found.
   */
  selectPolicies(operations: readonly string[] = []): PolicySelection<Policy> {
    return this.select(this.all, "policy", Policy.fileName, operations);
  }

  /**
   * Select the sound test files of some operations, and say what is wrong with
   * the rest.
   *
   * @remarks
   * An operation asked for that has no test file is a problem too, so a typo
   * in the filter never passes silently.
   *
   * @param operations - The operations whose test files are read; every one
   *   when empty.
   * @returns The sound test files, and a line per problem found.
   */
  selectTests(operations: readonly string[] = []): PolicySelection<PolicyTest> {
    const selection = this.select(this.tests, "policy-test", PolicyTest.fileName, operations);
    const present = [
      ...this.tests,
      ...this.config.broken.filter((file) => {
        return file.kind === "policy-test";
      }),
    ];
    const missing = operations
      .map(PolicyTest.fileName)
      .filter((name) => {
        return !present.some((test) => {
          return basename(test.path) === name;
        });
      })
      .map((name) => {
        return `${CONFIG_DIRECTORIES.policies}/${name} does not exist`;
      });
    return { documents: selection.documents, issues: [...selection.issues, ...missing] };
  }

  /**
   * Select the sound documents of some operations, and say what is wrong with
   * the rest: the documents' own findings, and every broken file's.
   *
   * @remarks
   * The operations narrow the files by name before any is judged, so a broken
   * file of another operation never blocks the ones asked for. The files are
   * reported in path order, the order a store reads them in.
   *
   * @param documents - The policies or the test files.
   * @param kind - Which of the two they are, which the broken files are
   *   filed under.
   * @param fileName - The name a document of an operation must have.
   * @param operations - The operations whose documents are read; every one
   *   when empty.
   * @returns The sound documents, and a line per problem found, naming its file.
   */
  private select<T extends Policy | PolicyTest>(
    documents: readonly T[],
    kind: T["kind"],
    fileName: (operation: string) => string,
    operations: readonly string[],
  ): PolicySelection<T> {
    const wanted = new Set(operations.map(fileName));
    const isWanted = (path: string): boolean => {
      return wanted.size === 0 || wanted.has(basename(path));
    };
    // Each document is checked once, and judged and reported from that one check.
    const checked = documents
      .filter((document) => {
        return isWanted(document.path);
      })
      .map((document) => {
        return { path: document.path, document, issues: document.check({}) };
      });
    const broken = this.config.broken
      .filter((file) => {
        return file.kind === kind && isWanted(file.path);
      })
      .map((file) => {
        return { path: file.path, document: undefined, issues: file.issues };
      });
    // The spread makes a fresh list, so sorting it changes nothing anyone else holds.
    const judged = [...checked, ...broken].sort((a, b) => {
      return a.path.localeCompare(b.path);
    });
    return {
      documents: checked
        .filter((entry) => {
          return entry.issues.length === 0;
        })
        .map((entry) => {
          return entry.document;
        }),
      issues: judged.flatMap((entry) => {
        return entry.issues.map((issue) => {
          return `${entry.path}: ${issue.message}`;
        });
      }),
    };
  }
}
