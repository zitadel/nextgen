import { policyConfigSchema, policyTestFileSchema } from "@zitadel/config/schemas";

import { ConfigDocument, type DocumentStatus } from "@/lib/zitadel/document";
import type { ConfigFile, JsonObject } from "@/lib/zitadel/types";

/** The suffix that marks a policy's test file, which sits beside the policies. */
export const POLICY_TEST_SUFFIX = ".test.json";

/**
 * An operation policy under `.zitadel/policies/` (ADR 066): the rules one
 * operation is held to, in a file named after the operation.
 */
export class Policy extends ConfigDocument {
  private constructor(path: string, body: JsonObject, status: DocumentStatus) {
    super(path, body, status);
  }

  /**
   * Take a policy as read.
   *
   * @param file - The file.
   * @returns The policy.
   */
  static of(file: ConfigFile): Policy {
    return new Policy(file.path, file.body, "read");
  }

  /**
   * The document as saved: what it holds is now what the file holds.
   *
   * @returns The document, marked as read.
   */
  asRead(): Policy {
    return new Policy(this.path, this.body, "read");
  }

  /**
   * A new policy file, not yet written: saving it never replaces a file
   * already there.
   *
   * @param file - Where it goes, and what it holds.
   * @returns The policy.
   */
  static create(file: ConfigFile): Policy {
    return new Policy(file.path, file.body, "created");
  }

  /**
   * What is wrong with the file: anything its contract refuses, or a name that
   * is not its operation's.
   */
  get problems(): readonly string[] {
    const result = policyConfigSchema.safeParse(this.wireBody);
    if (!result.success) {
      return result.error.issues.map((issue) => {
        return `${issue.path.join(".") || "(root)"} ${issue.message}`;
      });
    }
    const expected = `${result.data.operation}.json`;
    if (this.path.split("/").at(-1) !== expected) {
      return [`holds the ${result.data.operation} policy, so it must be named ${expected}`];
    }
    return [];
  }

  /** The body the server takes: the operation and its rules, nothing an editor added. */
  get wireBody(): JsonObject {
    const { $schema: _editorOnly, ...body } = this.body;
    return body;
  }
}

/**
 * A policy's tests under `.zitadel/policies/`: cases `zitadel policies test`
 * runs, which a release never carries.
 */
export class PolicyTest extends ConfigDocument {
  private constructor(path: string, body: JsonObject, status: DocumentStatus) {
    super(path, body, status);
  }

  /**
   * Take a policy test file as read.
   *
   * @param file - The file.
   * @returns The test file.
   */
  static of(file: ConfigFile): PolicyTest {
    return new PolicyTest(file.path, file.body, "read");
  }

  /**
   * What is wrong with the file: anything its contract refuses, or a name that
   * is not its operation's.
   */
  get problems(): readonly string[] {
    const { $schema: _editorOnly, ...body } = this.body;
    const result = policyTestFileSchema.safeParse(body);
    if (!result.success) {
      return result.error.issues.map((issue) => {
        return `${issue.path.join(".") || "(root)"} ${issue.message}`;
      });
    }
    const expected = `${result.data.operation}${POLICY_TEST_SUFFIX}`;
    if (this.path.split("/").at(-1) !== expected) {
      return [`tests the ${result.data.operation} policy, so it must be named ${expected}`];
    }
    return [];
  }
}
