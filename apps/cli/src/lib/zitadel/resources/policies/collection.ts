import { basename } from "node:path";

import { Collection } from "@/lib/zitadel/resources/collection";
import type { ZitadelConfig } from "@/lib/zitadel/config";
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
   * The password policy, which `setup` writes and keeps.
   *
   * @returns The policy at its file, or `undefined` when there is none.
   */
  get password(): Policy | undefined {
    return this.get(Policy.PASSWORD_PATH);
  }

  /**
   * The sound policies of some operations, and what is wrong with the rest.
   *
   * @remarks
   * A policy with a problem is never "no policy": testing `{}` in its place
   * would report on a policy nobody wrote.
   *
   * @param operations - The operations whose policies are read; every one
   *   when empty.
   * @returns The sound policies, and a line per problem found.
   */
  for(operations: readonly string[] = []): PolicySelection<Policy> {
    return this.select(this.all, Policy.fileName, operations);
  }

  /**
   * The sound test files of some operations, and what is wrong with the rest.
   *
   * @remarks
   * An operation asked for that has no test file is a problem too, so a typo
   * in the filter never passes silently.
   *
   * @param operations - The operations whose test files are read; every one
   *   when empty.
   * @returns The sound test files, and a line per problem found.
   */
  testsFor(operations: readonly string[] = []): PolicySelection<PolicyTest> {
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
   * The sound documents of some operations, and what is wrong with the rest.
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
    return {
      documents: chosen.filter((document) => {
        return document.problems({}).length === 0;
      }),
      issues: chosen.flatMap((document) => {
        return document.problems({}).map((issue) => {
          return `${document.path}: ${issue.message}`;
        });
      }),
    };
  }
}
