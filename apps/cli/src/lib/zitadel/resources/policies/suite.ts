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
  type PolicyCase,
  type PolicyOperation,
  type PolicyTestBody,
} from "@/lib/zitadel/resources/policies/types";
import type { Issue, ValidationContext } from "@/lib/zitadel/rules/types";
import type { ConfigStore } from "@/lib/zitadel/storage/types";
import type { JsonObject } from "@/lib/zitadel/types";

/**
 * A policy's test suite under `.zitadel/policies/`: cases `zitadel policies
 * test` runs, which a release never carries.
 */
export class PolicyTest<Body extends JsonObject = JsonObject> extends ConfigDocument<Body> {
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
  private constructor(path: string, body: Body, status: DocumentStatus) {
    super(path, body, status);
  }

  /**
   * Take a policy test file as read.
   *
   * @param file - The file.
   * @returns The test file, marked as read.
   */
  static of<Body extends JsonObject>(file: DocumentFile<Body>): PolicyTest<Body> {
    return new PolicyTest(file.path, file.body, "read");
  }

  /**
   * A new policy test file, not yet written: saving it never replaces a file
   * already there.
   *
   * @param file - Where it goes, and what it holds.
   * @returns The test file, marked as created.
   */
  static create<Body extends JsonObject>(file: DocumentFile<Body>): PolicyTest<Body> {
    return new PolicyTest(file.path, file.body, "created");
  }

  /**
   * The name a test file must have, so it sits beside its operation's policy.
   *
   * @param operation - The operation the cases test.
   * @returns The operation followed by `.test.json`.
   */
  static fileName(operation: string): string {
    return `${operation}${POLICY_TEST_SUFFIX}`;
  }

  /**
   * The operation the cases test.
   *
   * @returns The operation, as the policy test contract types it.
   * @throws {@link BrokenFilesError} When the policy test contract refuses the
   *   body; a test file with no {@link problems} never throws.
   */
  readOperation(): PolicyOperation {
    return this.parse().operation;
  }

  /**
   * The cases, in the file's order.
   *
   * @returns The cases, as the policy test contract types them.
   * @throws {@link BrokenFilesError} When the policy test contract refuses the
   *   body; a test file with no {@link problems} never throws.
   */
  readCases(): readonly PolicyCase[] {
    return this.parse().cases;
  }

  /**
   * The test file as saved: what it holds is now what the file holds.
   *
   * @returns The same test file, marked as read.
   */
  asRead(): PolicyTest<Body> {
    return new PolicyTest(this.path, this.body, "read");
  }

  /**
   * Everything wrong with the test file on its own: what the policy test
   * contract refuses, or a file name that is not its operation's.
   *
   * @param _context - Unused: the test contract needs nothing beyond the file.
   * @returns The `contract/policy` findings; none when the file is sound.
   */
  problems(_context: ValidationContext): readonly Issue[] {
    const refusals = this.contractIssues("contract/policy", policyTestFileSchema);
    if (refusals.length > 0) {
      return refusals;
    }
    const expected = PolicyTest.fileName(this.readOperation());
    if (basename(this.path) !== expected) {
      return [
        this.issue(
          "contract/policy",
          `tests the ${this.readOperation()} policy, so it must be named ${expected}`,
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
  wireBody(_store: ConfigStore): JsonObject {
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
        this.problems({}).map((issue) => {
          return { path: this.path, problem: issue.message };
        }),
      );
    }
    return result.data;
  }
}
