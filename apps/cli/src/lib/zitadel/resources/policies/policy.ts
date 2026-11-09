import { basename } from "node:path";

import { policyConfigSchema } from "@zitadel/config/schemas";

import type { BrokenFile } from "@/lib/zitadel/resources/broken";
import {
  ConfigDocument,
  type DocumentContract,
  type DocumentFile,
  type DocumentStatus,
} from "@/lib/zitadel/resources/document";
import {
  POLICY_FILE_SUFFIX,
  type PolicyFileName,
  type PolicyConfig,
  type PolicyOperation,
  type PolicyValue,
} from "@/lib/zitadel/resources/policies/types";
import type { Issue, ValidationContext } from "@/lib/zitadel/rules/types";
import type { ConfigStore } from "@/lib/zitadel/storage/types";
import type { JsonObject } from "@/lib/zitadel/types";

/**
 * An operation policy under `.zitadel/policies/` (ADR 066): the rules one
 * operation is held to, in a file named after the operation.
 */
export class Policy extends ConfigDocument<JsonObject, PolicyValue> {
  /**
   * The contract a policy is held to; a file it refuses is broken, with one
   * `contract/policy` finding per refusal.
   */
  static readonly CONTRACT: DocumentContract<typeof policyConfigSchema> = {
    kind: "policy",
    rule: "contract/policy",
    schema: policyConfigSchema,
  };

  /**
   * What kind of document this is: an operation policy.
   */
  readonly kind = "policy";

  /**
   * Hold a policy the policy contract took.
   *
   * @param file - The project-relative path and the body as written.
   * @param value - What the contract parsed the body to.
   * @param status - Where it stands against the file on disk.
   */
  protected constructor(file: DocumentFile, value: PolicyValue, status: DocumentStatus) {
    super(file, value, status);
  }

  /**
   * Read a policy file: the policy, or the broken file it is.
   *
   * @param file - The file.
   * @returns The policy, marked as read, or the broken file.
   */
  static read(file: DocumentFile): Policy | BrokenFile {
    return Policy.readFile(Policy.CONTRACT, file, (value) => {
      return new Policy(file, value, "read");
    });
  }

  /**
   * Take a policy as read.
   *
   * @param file - The file.
   * @returns The policy, marked as read.
   * @throws {@link BrokenFilesError} When the policy contract refuses the body.
   */
  static of(file: DocumentFile): Policy {
    return new Policy(file, Policy.parseFile(Policy.CONTRACT, file), "read");
  }

  /**
   * A new policy, not yet written: saving it never replaces a file already
   * there.
   *
   * @param file - Where it goes, and what it holds.
   * @returns The policy, marked as created.
   * @throws {@link BrokenFilesError} When the policy contract refuses the body.
   */
  static create(file: DocumentFile): Policy {
    return new Policy(file, Policy.parseFile(Policy.CONTRACT, file), "created");
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
   */
  get operation(): PolicyOperation {
    return this.value.operation;
  }

  /**
   * The rules the policy holds its operation to.
   *
   * @returns The rules, as the policy contract types them.
   */
  get config(): PolicyConfig {
    return this.value.config;
  }

  /**
   * The policy as saved: what it holds is now what the file holds.
   *
   * @returns The same policy, marked as read.
   */
  markRead(): Policy {
    return new Policy(this.file, this.value, "read");
  }

  /**
   * What else is wrong with the policy on its own, beyond what its contract
   * refuses: a file name that is not its operation's.
   *
   * @param _context - Unused: the policy checks need nothing beyond the file.
   * @returns The `contract/policy` finding; none when the policy is sound.
   */
  override check(_context: ValidationContext): readonly Issue[] {
    const operation = this.operation;
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
   * Loose like every document's wire body; {@link operation} and
   * {@link config} are the typed parts.
   *
   * @param _store - Unused: a policy holds no `$file` references.
   * @returns The body without the editor-only `$schema` pointer.
   */
  toWireBody(_store: ConfigStore): JsonObject {
    return this.contractBody;
  }
}
