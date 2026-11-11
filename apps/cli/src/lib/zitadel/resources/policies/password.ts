import type { Parsed } from "@zitadel/config/idp";
import { POLICY_FILE_SCHEMA_REF } from "@zitadel/config/meta-schemas";
import {
  passwordSetPolicyFileSchema,
  RECOMMENDED_PASSWORD_MIN_LENGTH,
} from "@zitadel/config/schemas";

import type { BrokenFile } from "@/lib/zitadel/resources/broken";
import type {
  DocumentFile,
  DocumentStatus,
  Edit,
  ReadableFile,
} from "@/lib/zitadel/resources/document";
import { Policy } from "@/lib/zitadel/resources/policies/policy";
import {
  PASSWORD_POLICY_OPERATION,
  type PasswordMinLength,
  POLICY_FILE_SUFFIX,
} from "@/lib/zitadel/resources/policies/types";
import { CONFIG_DIRECTORIES, type JsonObject } from "@/lib/zitadel/types";
import { objectAt, withoutKey } from "@/lib/zitadel/utils/json";

/**
 * The password policy under `.zitadel/policies/`: the policy of the password
 * operation, which `setup` writes and keeps, and whose minimum length it sets.
 */
export class PasswordPolicy extends Policy {
  /**
   * The operation the password policy guards.
   */
  static readonly OPERATION = PASSWORD_POLICY_OPERATION;

  /**
   * Where the password policy lives, relative to the project root: the file
   * {@link Policy.fileName} names for its operation.
   */
  static readonly PATH =
    `${CONFIG_DIRECTORIES.policies}/${PASSWORD_POLICY_OPERATION}${POLICY_FILE_SUFFIX}` as const;

  /**
   * The bounds the policy contract sets on a minimum password length, so the
   * CLI and the server cannot disagree on them.
   *
   * @remarks
   * Here rather than in `types.ts`, which imports no value.
   */
  private static readonly MIN_LENGTH_BOUNDS =
    passwordSetPolicyFileSchema.shape.config.shape.min_length.unwrap();

  /**
   * Read a password policy file: the policy, or the broken file it is.
   *
   * @param file - The file.
   * @returns The policy, marked as read, or the broken file.
   */
  static override read(file: ReadableFile): PasswordPolicy | BrokenFile {
    return PasswordPolicy.readFile(Policy.CONTRACT, file, (value, parsed) => {
      return new PasswordPolicy(parsed, value, "read");
    });
  }

  /**
   * Take a password policy as read.
   *
   * @param file - The file.
   * @returns The policy, marked as read.
   * @throws {@link BrokenFilesError} When the policy contract refuses the body.
   */
  static override of(file: DocumentFile): PasswordPolicy {
    return PasswordPolicy.build(file, "read");
  }

  /**
   * A new password policy, not yet written: saving it never replaces a file
   * already there.
   *
   * @param file - Where it goes, and what it holds.
   * @returns The policy, marked as created.
   * @throws {@link BrokenFilesError} When the policy contract refuses the body.
   */
  static override create(file: DocumentFile): PasswordPolicy {
    return PasswordPolicy.build(file, "created");
  }

  /**
   * Make a password policy of a body that must pass the policy contract, as
   * every factory and edit does.
   *
   * @param file - The project-relative path and the body.
   * @param status - Where it stands against the file on disk.
   * @returns The policy.
   * @throws {@link BrokenFilesError} When the policy contract refuses the body.
   */
  private static build(file: DocumentFile, status: DocumentStatus): PasswordPolicy {
    return new PasswordPolicy(file, PasswordPolicy.parseFile(Policy.CONTRACT, file), status);
  }

  /**
   * The password policy `setup` writes for a new project.
   *
   * @remarks
   * Not `create`, which every document takes a file to.
   *
   * @param minLength - The minimum setup was given: a length, `null` for an
   *   explicit "none", or `undefined` when none was given.
   * @returns A new policy at {@link PATH} with the given minimum,
   *   {@link RECOMMENDED_PASSWORD_MIN_LENGTH} when none was given, and an
   *   empty `config`, which enforces nothing, for "none".
   */
  static initial(minLength?: PasswordMinLength): PasswordPolicy {
    return PasswordPolicy.create({
      path: PasswordPolicy.PATH,
      body: {
        $schema: POLICY_FILE_SCHEMA_REF,
        operation: PASSWORD_POLICY_OPERATION,
        config: PasswordPolicy.minLengthConfig(minLength),
      },
    });
  }

  /**
   * The `config` keys a minimum given to `setup` writes.
   *
   * @param minLength - The minimum: a length, `null` for an explicit "none",
   *   or `undefined` when none was given.
   * @returns `min_length` with the length, or the recommended one when none
   *   was given; nothing for "none".
   */
  private static minLengthConfig(minLength: PasswordMinLength | undefined): JsonObject {
    if (minLength === null) {
      return {};
    }
    if (minLength === undefined) {
      return { min_length: RECOMMENDED_PASSWORD_MIN_LENGTH };
    }
    return { min_length: minLength };
  }

  /**
   * Read a minimum password length the way `setup` takes one, from its flag
   * or its prompt.
   *
   * @remarks
   * A minimum of 0 enforces nothing, so it means none: the file keeps one form
   * for "off", the setting left out, which the contract's bounds (1 and up)
   * teach.
   *
   * @param value - The text given.
   * @returns `null` for an empty answer or 0, the length for a whole number the
   *   contract's bounds accept, and the problem for anything else.
   */
  static parseMinLength(value: string): Parsed<PasswordMinLength> {
    const text = value.trim();
    if (text === "" || /^0+$/.test(text)) {
      return { ok: true, value: null };
    }
    const result = PasswordPolicy.MIN_LENGTH_BOUNDS.safeParse(Number(text));
    if (!/^\d+$/.test(text) || !result.success) {
      return {
        ok: false,
        problem: `Must be a whole number from ${PasswordPolicy.MIN_LENGTH_BOUNDS.minValue} to ${PasswordPolicy.MIN_LENGTH_BOUNDS.maxValue}, or 0 for none`,
      };
    }
    return { ok: true, value: result.data };
  }

  /**
   * The minimum password length the policy enforces.
   *
   * @returns The length, or `undefined` when it enforces none.
   */
  get minLength(): number | undefined {
    // The contract types a policy by its operation, so the password settings
    // are read off the password branch.
    const value = this.value;
    if (value.operation !== PASSWORD_POLICY_OPERATION) {
      return undefined;
    }
    return value.config.min_length;
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
  withMinLength(minLength: PasswordMinLength | undefined): Edit<PasswordPolicy> {
    const unchanged: Edit<PasswordPolicy> = { document: this, changed: false, skipped: [] };
    if (minLength === undefined) {
      return unchanged;
    }
    const current = this.minLength;
    if (minLength === null && current === undefined) {
      return unchanged;
    }
    if (minLength === current) {
      return unchanged;
    }
    // The body passed the policy contract, so its `config` is an object, and
    // every key but `min_length` stays as the project wrote it.
    const kept = withoutKey(objectAt(this.body, "config"), "min_length");
    const config = { ...kept, ...PasswordPolicy.minLengthConfig(minLength) };
    return {
      document: PasswordPolicy.build(
        { path: this.path, body: { ...this.body, config } },
        this.editedStatus,
      ),
      changed: true,
      skipped: [],
    };
  }
}
