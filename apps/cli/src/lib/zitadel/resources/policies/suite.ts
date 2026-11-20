import { basename } from "node:path";

import { policyTestFileSchema } from "@zitadel/config/schemas";

import type { BrokenFile } from "@/lib/zitadel/resources/broken";
import {
  ConfigDocument,
  type DocumentContract,
  type DocumentFile,
  type ReadableFile,
  type DocumentStatus,
} from "@/lib/zitadel/resources/document";
import {
  POLICY_TEST_SUFFIX,
  type PolicyTestFileName,
  type PolicyCase,
  type PolicyCaseResult,
  type PolicyExpectation,
  type PolicyOperation,
  type PolicyTestValue,
  type PolicyVerdict,
} from "@/lib/zitadel/resources/policies/types";
import type { Issue, ValidationContext } from "@/lib/zitadel/rules/types";
import type { ConfigStore } from "@/lib/zitadel/storage/types";
import type { JsonObject } from "@/lib/zitadel/types";

/**
 * A policy's test suite under `.zitadel/policies/`: the cases that
 * `zitadel policy test` runs, which a release never carries.
 */
export class PolicyTest extends ConfigDocument<PolicyTestValue> {
  /**
   * The contract a policy test file is held to; a file it refuses is broken,
   * with one `contract/policy` finding per refusal.
   */
  static readonly CONTRACT: DocumentContract<typeof policyTestFileSchema> = {
    kind: "policy-test",
    rule: "contract/policy",
    schema: policyTestFileSchema,
  };

  /**
   * What kind of document this is: a policy's test file.
   */
  readonly kind = "policy-test";

  /**
   * Hold a test file the policy test contract took.
   *
   * @param file - The project-relative path and the body as written.
   * @param value - What the contract parsed the body to.
   * @param status - Where it stands against the file on disk.
   */
  private constructor(file: DocumentFile, value: PolicyTestValue, status: DocumentStatus) {
    super(file, value, status);
  }

  /**
   * Read a policy test file: the test file, or the broken file it is.
   *
   * @param file - The file.
   * @returns The test file, marked as read, or the broken file.
   */
  static read(file: ReadableFile): PolicyTest | BrokenFile {
    return PolicyTest.readFile(PolicyTest.CONTRACT, file, (value, parsed) => {
      return new PolicyTest(parsed, value, "read");
    });
  }

  /**
   * Take a policy test file as read.
   *
   * @param file - The file.
   * @returns The test file, marked as read.
   * @throws {@link BrokenFilesError} When the policy test contract refuses the body.
   */
  static of(file: DocumentFile): PolicyTest {
    return new PolicyTest(file, PolicyTest.parseFile(PolicyTest.CONTRACT, file), "read");
  }

  /**
   * A new policy test file, not yet written: saving it never replaces a file
   * already there.
   *
   * @param file - Where it goes, and what it holds.
   * @returns The test file, marked as created.
   * @throws {@link BrokenFilesError} When the policy test contract refuses the body.
   */
  static create(file: DocumentFile): PolicyTest {
    return new PolicyTest(file, PolicyTest.parseFile(PolicyTest.CONTRACT, file), "created");
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
   * A case's outcome against the decision the server made for it.
   *
   * @remarks
   * The case passes when the decision agrees on `allowed` always, on `code`
   * when the case gives one, and on `violations` when the case gives them, as
   * exactly that set of rule names, so a rule that fails unexpectedly fails
   * the case too.
   *
   * @param testCase - The case, with the decision it expects.
   * @param actual - The decision the server made for the case's input.
   * @returns The case's name, whether it passed, and both decisions.
   */
  static resultOf(testCase: PolicyCase, actual: PolicyVerdict): PolicyCaseResult {
    return {
      name: testCase.name,
      passed: PolicyTest.holds(testCase.expect, actual),
      expected: testCase.expect,
      actual,
    };
  }

  /**
   * Whether a decision is what a case expects.
   *
   * @param expected - The decision the case expects.
   * @param actual - The decision the server made.
   * @returns Whether they agree on `allowed`, and on the code and the set of
   *   violated rules where the case names them.
   */
  private static holds(expected: PolicyExpectation, actual: PolicyVerdict): boolean {
    if (expected.allowed !== actual.allowed) {
      return false;
    }
    if (expected.code !== undefined && expected.code !== actual.code) {
      return false;
    }
    if (expected.violations === undefined) {
      return true;
    }
    const got = new Set(Object.keys(actual.violations ?? {}));
    const want = new Set(expected.violations);
    if (got.size !== want.size) {
      return false;
    }
    return [...got].every((name) => {
      return want.has(name);
    });
  }

  /**
   * The operation the cases test.
   *
   * @returns The operation, as the policy test contract types it.
   */
  get operation(): PolicyOperation {
    return this.value.operation;
  }

  /**
   * The cases, in the file's order.
   *
   * @returns The cases, as the policy test contract types them.
   */
  get cases(): readonly PolicyCase[] {
    return this.value.cases;
  }

  /**
   * What else is wrong with the test file on its own, beyond what its
   * contract refuses: a file name that is not its operation's.
   *
   * @param _context - Unused: the test file checks need nothing beyond the file.
   * @returns The `contract/policy` finding; none when the file is sound.
   */
  override check(_context: ValidationContext): readonly Issue[] {
    const operation = this.operation;
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
   * The body as `zitadel policy test` reads it.
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
}
