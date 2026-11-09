import { basename } from "node:path";

import { Collection } from "@/lib/zitadel/resources/collection";
import type { ZitadelConfig } from "@/lib/zitadel/config";
import type { DocumentFile } from "@/lib/zitadel/resources/document";
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
   * @returns The policy, marked as read.
   */
  static read(file: DocumentFile): Policy {
    if (file.body.operation === PasswordPolicy.OPERATION) {
      return PasswordPolicy.of(file);
    }
    return Policy.of(file);
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
    return this.select(this.all, Policy.fileName, operations);
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
    const selection = this.select(this.tests, PolicyTest.fileName, operations);
    const missing = operations
      .map(PolicyTest.fileName)
      .filter((name) => {
        return !this.tests.some((test) => {
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
   * the rest.
   *
   * @remarks
   * The operations narrow the documents by file name before any is checked,
   * so a broken file of another operation never blocks the ones asked for.
   *
   * @param documents - The policies or the test files.
   * @param fileName - The name a document of an operation must have.
   * @param operations - The operations whose documents are read; every one
   *   when empty.
   * @returns The sound documents, and a line per problem found, naming its file.
   */
  private select<T extends Policy | PolicyTest>(
    documents: readonly T[],
    fileName: (operation: string) => string,
    operations: readonly string[],
  ): PolicySelection<T> {
    const wanted = new Set(operations.map(fileName));
    const chosen = documents.filter((document) => {
      return wanted.size === 0 || wanted.has(basename(document.path));
    });
    // Each document is checked once, and judged and reported from that one check.
    const checked = chosen.map((document) => {
      return { document, issues: document.check({}) };
    });
    return {
      documents: checked
        .filter((entry) => {
          return entry.issues.length === 0;
        })
        .map((entry) => {
          return entry.document;
        }),
      issues: checked.flatMap((entry) => {
        return entry.issues.map((issue) => {
          return `${entry.document.path}: ${issue.message}`;
        });
      }),
    };
  }
}
