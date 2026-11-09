import { basename } from "node:path";

import { policyTestFileSchema } from "@zitadel/config/schemas";

import { BrokenFilesError } from "@/lib/zitadel/errors";
import {
  ConfigDocument,
  type DocumentFile,
  type DocumentStatus,
} from "@/lib/zitadel/resources/document";
import {
  POLICY_TEST_SUFFIX,
  type PolicyTestFileName,
  type PolicyCase,
  type PolicyOperation,
  type PolicyTestBody,
} from "@/lib/zitadel/resources/policies/types";
import type { Issue, ValidationContext } from "@/lib/zitadel/rules/types";
import type { ConfigStore } from "@/lib/zitadel/storage/types";
import type { JsonObject } from "@/lib/zitadel/types";

/**
 * A policy's test suite under `.zitadel/policies/`: the cases that
 * `zitadel policies test` runs, which a release never carries.
 */
export class PolicyTest extends ConfigDocument {
  /**
   * What kind of document this is: a policy's test file.
   */
  readonly kind = "policy-test";

  /**
   * Hold a test file's body at its path.
   *
   * @param path - The project-relative path.
   * @param body - The body as written.
   * @param status - Where it stands against the file on disk.
   */
  private constructor(path: string, body: JsonObject, status: DocumentStatus) {
    super(path, body, status);
  }

  /**
   * Take a policy test file as read.
   *
   * @param file - The file.
   * @returns The test file, marked as read.
   */
  static of(file: DocumentFile): PolicyTest {
    return new PolicyTest(file.path, file.body, "read");
  }

  /**
   * A new policy test file, not yet written: saving it never replaces a file
   * already there.
   *
   * @param file - Where it goes, and what it holds.
   * @returns The test file, marked as created.
   */
  static create(file: DocumentFile): PolicyTest {
    return new PolicyTest(file.path, file.body, "created");
  }

  /**
   * The name a test file must have, so it sits beside its operation's policy.
   *
   * @param operation - The operation the cases test.
   * @returns The operation followed by `.test.json`.
   */
  static fileName<Operation extends string>(operation: Operation): PolicyTestFileName<Operation> {
    return `${operation}${POLICY_TEST_SUFFIX}`;
  }

  /**
   * The operation the cases test.
   *
   * @returns The operation, as the policy test contract types it.
   * @throws {@link BrokenFilesError} When the policy test contract refuses the
   *   body; a test file {@link check} finds sound never throws.
   */
  readOperation(): PolicyOperation {
    return this.parse().operation;
  }

  /**
   * The cases, in the file's order.
   *
   * @returns The cases, as the policy test contract types them.
   * @throws {@link BrokenFilesError} When the policy test contract refuses the
   *   body; a test file {@link check} finds sound never throws.
   */
  readCases(): readonly PolicyCase[] {
    return this.parse().cases;
  }

  /**
   * The test file as saved: what it holds is now what the file holds.
   *
   * @returns The same test file, marked as read.
   */
  markRead(): PolicyTest {
    return new PolicyTest(this.path, this.body, "read");
  }

  /**
   * Everything wrong with the test file on its own: what the policy test
   * contract refuses, or a file name that is not its operation's.
   *
   * @param _context - Unused: the test contract needs nothing beyond the file.
   * @returns The `contract/policy` findings; none when the file is sound.
   */
  check(_context: ValidationContext): readonly Issue[] {
    const refusals = this.checkContract("contract/policy", policyTestFileSchema);
    if (refusals.length > 0) {
      return refusals;
    }
    const operation = this.readOperation();
    const expected = PolicyTest.fileName(operation);
    if (basename(this.path) !== expected) {
      return [
        this.makeIssue(
          "contract/policy",
          `tests the ${operation} policy, so it must be named ${expected}`,
        ),
      ];
    }
    return [];
  }

  /**
   * The body as `zitadel policies test` reads it.
   *
   * @remarks
   * A release never carries a test file; this is the body without what an
   * editor added, for the standard every document follows.
   *
   * @param _store - Unused: a test file holds no `$file` references.
   * @returns The body without the editor-only `$schema` pointer.
   */
  toWireBody(_store: ConfigStore): JsonObject {
    return this.contractBody;
  }

  /**
   * The body as the policy test contract takes it.
   *
   * @returns The parsed body.
   * @throws {@link BrokenFilesError} When the policy test contract refuses the
   *   body, naming each refusal.
   */
  private parse(): PolicyTestBody {
    const result = policyTestFileSchema.safeParse(this.contractBody);
    if (!result.success) {
      throw new BrokenFilesError(
        this.check({}).map((issue) => {
          return { path: this.path, problem: issue.message };
        }),
      );
    }
    return result.data;
  }
}
