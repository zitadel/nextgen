import { basename } from "node:path";

import { policyTestFileSchema } from "@zitadel/config/schemas";

import { BrokenFilesError } from "@/lib/zitadel/errors";
import type { BrokenFile } from "@/lib/zitadel/resources/broken";
import {
  ConfigDocument,
  type DocumentContract,
  type DocumentFile,
  type DocumentStatus,
} from "@/lib/zitadel/resources/document";
import {
  POLICY_TEST_SUFFIX,
  type PolicyTestFileName,
  type PolicyCase,
  type PolicyOperation,
  type PolicyTestBody,
  type PolicyTestValue,
} from "@/lib/zitadel/resources/policies/types";
import type { Issue, ValidationContext } from "@/lib/zitadel/rules/types";
import type { ConfigStore } from "@/lib/zitadel/storage/types";
import type { JsonObject } from "@/lib/zitadel/types";

/**
 * A policy's test suite under `.zitadel/policies/`: the cases that
 * `zitadel policies test` runs, which a release never carries.
 */
export class PolicyTest extends ConfigDocument<JsonObject, PolicyTestValue> {
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
  static read(file: DocumentFile): PolicyTest | BrokenFile {
    return PolicyTest.readFile(PolicyTest.CONTRACT, file, (value) => {
      return new PolicyTest(file, value, "read");
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
    return new PolicyTest(this.file, this.value, "read");
  }

  /**
   * What else is wrong with the test file on its own, beyond what its
   * contract refuses: a file name that is not its operation's.
   *
   * @param _context - Unused: the test file checks need nothing beyond the file.
   * @returns The `contract/policy` finding; none when the file is sound.
   */
  override check(_context: ValidationContext): readonly Issue[] {
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
