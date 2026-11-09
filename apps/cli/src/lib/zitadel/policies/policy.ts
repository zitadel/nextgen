import { basename } from "node:path";

import { policyConfigSchema, policyTestFileSchema } from "@zitadel/config/schemas";

import { ConfigDocument, type DocumentFile, type DocumentStatus } from "@/lib/zitadel/document";
import type { Issue, ValidationContext } from "@/lib/zitadel/rules/types";
import type { ConfigStore } from "@/lib/zitadel/storage/types";
import type { JsonObject } from "@/lib/zitadel/types";

/**
 * The suffix that marks a policy's test file, which sits beside the policies.
 */
export const POLICY_TEST_SUFFIX = ".test.json";

/**
 * An operation policy under `.zitadel/policies/` (ADR 066): the rules one
 * operation is held to, in a file named after the operation.
 */
export class Policy<Body extends JsonObject = JsonObject> extends ConfigDocument<Body> {
  /**
   * Hold a policy's body at its path.
   *
   * @param path - The project-relative path.
   * @param body - The body as written.
   * @param status - Where it stands against the file on disk.
   */
  private constructor(path: string, body: Body, status: DocumentStatus) {
    super(path, body, status);
  }

  /**
   * Take a policy as read.
   *
   * @param file - The file.
   * @returns The policy, marked as read.
   */
  static of<Body extends JsonObject>(file: DocumentFile<Body>): Policy<Body> {
    return new Policy(file.path, file.body, "read");
  }

  /**
   * A new policy, not yet written: saving it never replaces a file already
   * there.
   *
   * @param file - Where it goes, and what it holds.
   * @returns The policy, marked as created.
   */
  static create<Body extends JsonObject>(file: DocumentFile<Body>): Policy<Body> {
    return new Policy(file.path, file.body, "created");
  }

  /**
   * The policy as saved: what it holds is now what the file holds.
   *
   * @returns The same policy, marked as read.
   */
  asRead(): Policy<Body> {
    return new Policy(this.path, this.body, "read");
  }

  /**
   * Everything wrong with the policy on its own: what the policy contract
   * refuses, or a file name that is not its operation's.
   *
   * @param _context - Unused: the policy contract needs nothing beyond the file.
   * @returns The `contract/policy` findings; none when the policy is sound.
   */
  problems(_context: ValidationContext): readonly Issue[] {
    const refusals = this.contractIssues("contract/policy", policyConfigSchema);
    if (refusals.length > 0) {
      return refusals;
    }
    const { operation } = policyConfigSchema.parse(this.contractBody);
    const expected = `${operation}.json`;
    if (basename(this.path) !== expected) {
      return [
        this.issue(
          "contract/policy",
          `holds the ${operation} policy, so it must be named ${expected}`,
        ),
      ];
    }
    return [];
  }

  /**
   * The body the server receives: the operation and its rules.
   *
   * @param _store - Unused: a policy holds no `$file` references.
   * @returns The body without the editor-only `$schema` pointer.
   */
  wireBody(_store: ConfigStore): JsonObject {
    return this.contractBody;
  }
}

/**
 * A policy's tests under `.zitadel/policies/`: cases `zitadel policies test`
 * runs, which a release never carries.
 */
export class PolicyTest<Body extends JsonObject = JsonObject> extends ConfigDocument<Body> {
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
    const { operation } = policyTestFileSchema.parse(this.contractBody);
    const expected = `${operation}${POLICY_TEST_SUFFIX}`;
    if (basename(this.path) !== expected) {
      return [
        this.issue(
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
  wireBody(_store: ConfigStore): JsonObject {
    return this.contractBody;
  }
}
