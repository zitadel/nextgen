import { basename } from "node:path";

import { policyConfigSchema } from "@zitadel/config/schemas";

import { BrokenFilesError } from "@/lib/zitadel/errors";
import {
  ConfigDocument,
  type DocumentFile,
  type DocumentStatus,
} from "@/lib/zitadel/resources/document";
import {
  POLICY_FILE_SUFFIX,
  type PolicyBody,
  type PolicyFileName,
  type PolicyConfig,
  type PolicyOperation,
} from "@/lib/zitadel/resources/policies/types";
import type { Issue, ValidationContext } from "@/lib/zitadel/rules/types";
import type { ConfigStore } from "@/lib/zitadel/storage/types";
import type { JsonObject } from "@/lib/zitadel/types";

/**
 * An operation policy under `.zitadel/policies/` (ADR 066): the rules one
 * operation is held to, in a file named after the operation.
 */
export class Policy extends ConfigDocument {
  /**
   * What kind of document this is: an operation policy.
   */
  readonly kind = "policy";

  /**
   * Hold a policy's body at its path.
   *
   * @param path - The project-relative path.
   * @param body - The body as written.
   * @param status - Where it stands against the file on disk.
   */
  protected constructor(path: string, body: JsonObject, status: DocumentStatus) {
    super(path, body, status);
  }

  /**
   * Take a policy as read.
   *
   * @param file - The file.
   * @returns The policy, marked as read.
   */
  static of(file: DocumentFile): Policy {
    return new Policy(file.path, file.body, "read");
  }

  /**
   * A new policy, not yet written: saving it never replaces a file already
   * there.
   *
   * @param file - Where it goes, and what it holds.
   * @returns The policy, marked as created.
   */
  static create(file: DocumentFile): Policy {
    return new Policy(file.path, file.body, "created");
  }

  /**
   * The name a policy file must have, so one file holds one operation's
   * policy.
   *
   * @param operation - The operation the policy guards.
   * @returns The operation followed by `.json`.
   */
  static fileName<Operation extends string>(operation: Operation): PolicyFileName<Operation> {
    return `${operation}${POLICY_FILE_SUFFIX}`;
  }

  /**
   * The operation the policy guards.
   *
   * @returns The operation, as the policy contract types it.
   * @throws {@link BrokenFilesError} When the policy contract refuses the
   *   body; a policy {@link check} finds sound never throws.
   */
  readOperation(): PolicyOperation {
    return this.parse().operation;
  }

  /**
   * The rules the policy holds its operation to.
   *
   * @returns The rules, as the policy contract types them.
   * @throws {@link BrokenFilesError} When the policy contract refuses the
   *   body; a policy {@link check} finds sound never throws.
   */
  readConfig(): PolicyConfig {
    return this.parse().config;
  }

  /**
   * The policy as saved: what it holds is now what the file holds.
   *
   * @returns The same policy, marked as read.
   */
  markRead(): Policy {
    return new Policy(this.path, this.body, "read");
  }

  /**
   * Everything wrong with the policy on its own: what the policy contract
   * refuses, or a file name that is not its operation's.
   *
   * @param _context - Unused: the policy contract needs nothing beyond the file.
   * @returns The `contract/policy` findings; none when the policy is sound.
   */
  check(_context: ValidationContext): readonly Issue[] {
    const refusals = this.checkContract("contract/policy", policyConfigSchema);
    if (refusals.length > 0) {
      return refusals;
    }
    const operation = this.readOperation();
    const expected = Policy.fileName(operation);
    if (basename(this.path) !== expected) {
      return [
        this.makeIssue(
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
   * @remarks
   * Loose like every document's, since a deploy builds its bundle before its
   * checks run; {@link readOperation} and {@link readConfig} are the typed parts.
   *
   * @param _store - Unused: a policy holds no `$file` references.
   * @returns The body without the editor-only `$schema` pointer.
   */
  toWireBody(_store: ConfigStore): JsonObject {
    return this.contractBody;
  }

  /**
   * The body as the policy contract takes it.
   *
   * @returns The parsed body.
   * @throws {@link BrokenFilesError} When the policy contract refuses the
   *   body, naming each refusal.
   */
  private parse(): PolicyBody {
    const result = policyConfigSchema.safeParse(this.contractBody);
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
