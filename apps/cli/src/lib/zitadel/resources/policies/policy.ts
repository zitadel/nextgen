import { basename } from "node:path";

import { POLICY_FILE_SCHEMA_REF } from "@zitadel/config/meta-schemas";
import { policyConfigSchema, RECOMMENDED_PASSWORD_MIN_LENGTH } from "@zitadel/config/schemas";

import { BrokenFilesError } from "@/lib/zitadel/errors";
import {
  ConfigDocument,
  type DocumentFile,
  type DocumentStatus,
  type Edit,
} from "@/lib/zitadel/resources/document";
import {
  PASSWORD_POLICY_OPERATION,
  type PasswordMinLength,
  POLICY_FILE_SUFFIX,
  type PolicyBody,
  type PolicyConfig,
  type PolicyOperation,
} from "@/lib/zitadel/resources/policies/types";
import type { Issue, ValidationContext } from "@/lib/zitadel/rules/types";
import type { ConfigStore } from "@/lib/zitadel/storage/types";
import { CONFIG_DIRECTORIES, type JsonObject } from "@/lib/zitadel/types";

/**
 * An operation policy under `.zitadel/policies/` (ADR 066): the rules one
 * operation is held to, in a file named after the operation.
 */
export class Policy<Body extends JsonObject = JsonObject> extends ConfigDocument<Body> {
  /**
   * What kind of document this is: an operation policy.
   */
  readonly kind = "policy";

  /**
   * Where the password policy lives, relative to the project root: the file
   * {@link fileName} names for its operation.
   */
  static readonly PASSWORD_PATH = `${CONFIG_DIRECTORIES.policies}/${Policy.fileName(PASSWORD_POLICY_OPERATION)}`;

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
   * The password policy `setup` writes for a new project.
   *
   * @param minLength - The minimum setup was given: a length, `null` for an
   *   explicit "none", or `undefined` when none was given.
   * @returns A new policy at {@link PASSWORD_PATH} with the given minimum,
   *   {@link RECOMMENDED_PASSWORD_MIN_LENGTH} when none was given, and an
   *   empty `config`, which enforces nothing, for "none".
   */
  static password(minLength?: PasswordMinLength): Policy {
    const value = minLength === undefined ? RECOMMENDED_PASSWORD_MIN_LENGTH : minLength;
    return Policy.create({
      path: Policy.PASSWORD_PATH,
      body: {
        $schema: POLICY_FILE_SCHEMA_REF,
        operation: PASSWORD_POLICY_OPERATION,
        config: value === null ? {} : { min_length: value },
      },
    });
  }

  /**
   * The name a policy file must have, so one file holds one operation's
   * policy.
   *
   * @param operation - The operation the policy guards.
   * @returns The operation followed by `.json`.
   */
  static fileName(operation: string): string {
    return `${operation}${POLICY_FILE_SUFFIX}`;
  }

  /**
   * The operation the policy guards.
   *
   * @returns The operation, as the policy contract types it.
   * @throws {@link BrokenFilesError} When the policy contract refuses the
   *   body; a policy with no {@link problems} never throws.
   */
  get operation(): PolicyOperation {
    return this.contract.operation;
  }

  /**
   * The rules the policy holds its operation to.
   *
   * @returns The rules, as the policy contract types them.
   * @throws {@link BrokenFilesError} When the policy contract refuses the
   *   body; a policy with no {@link problems} never throws.
   */
  get config(): PolicyConfig {
    return this.contract.config;
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
   * The policy with the minimum password length `setup` was given.
   *
   * @remarks
   * Its other settings stay as the project chose them.
   *
   * @param minLength - The minimum: a length, `null` for an explicit "none",
   *   or `undefined` when none was given.
   * @returns The edit: the same policy when none was given or the minimum is
   *   already that one; otherwise the policy without `min_length` for "none",
   *   or with the new length.
   * @throws {@link BrokenFilesError} When the policy contract refuses the body.
   */
  withMinLength(minLength: PasswordMinLength | undefined): Edit<Policy<Body>> {
    if (minLength === undefined || (minLength ?? undefined) === this.config.min_length) {
      return { document: this, changed: false, skipped: [] };
    }
    const { min_length: _replaced, ...kept } = this.config;
    const config = minLength === null ? kept : { ...kept, min_length: minLength };
    return {
      document: new Policy(this.path, { ...this.body, config }, this.editedStatus),
      changed: true,
      skipped: [],
    };
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
    const expected = Policy.fileName(this.operation);
    if (basename(this.path) !== expected) {
      return [
        this.issue(
          "contract/policy",
          `holds the ${this.operation} policy, so it must be named ${expected}`,
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
   * checks run; {@link operation} and {@link config} are the typed parts.
   *
   * @param _store - Unused: a policy holds no `$file` references.
   * @returns The body without the editor-only `$schema` pointer.
   */
  wireBody(_store: ConfigStore): JsonObject {
    return this.contractBody;
  }

  /**
   * The body as the policy contract takes it.
   *
   * @returns The parsed body.
   * @throws {@link BrokenFilesError} When the policy contract refuses the
   *   body, naming each refusal.
   */
  private get contract(): PolicyBody {
    const result = policyConfigSchema.safeParse(this.contractBody);
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
