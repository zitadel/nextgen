import type { Parsed } from "@zitadel/config/idp";
import { POLICY_FILE_SCHEMA_REF } from "@zitadel/config/meta-schemas";
import { policyConfigSchema, RECOMMENDED_PASSWORD_MIN_LENGTH } from "@zitadel/config/schemas";

import type { DocumentFile, Edit } from "@/lib/zitadel/resources/document";
import { Policy } from "@/lib/zitadel/resources/policies/policy";
import {
  PASSWORD_POLICY_OPERATION,
  type PasswordMinLength,
  POLICY_FILE_SUFFIX,
} from "@/lib/zitadel/resources/policies/types";
import { CONFIG_DIRECTORIES, type JsonObject } from "@/lib/zitadel/types";

/**
 * The password policy under `.zitadel/policies/`: the policy of the password
 * operation, which `setup` writes and keeps, and whose minimum length it sets.
 */
export class PasswordPolicy<Body extends JsonObject = JsonObject> extends Policy<Body> {
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
    policyConfigSchema.shape.config.shape.min_length.unwrap();

  /**
   * Take a password policy as read.
   *
   * @param file - The file.
   * @returns The policy, marked as read.
   */
  static override of<Body extends JsonObject>(file: DocumentFile<Body>): PasswordPolicy<Body> {
    return new PasswordPolicy(file.path, file.body, "read");
  }

  /**
   * A new password policy, not yet written: saving it never replaces a file
   * already there.
   *
   * @param file - Where it goes, and what it holds.
   * @returns The policy, marked as created.
   */
  static override create<Body extends JsonObject>(file: DocumentFile<Body>): PasswordPolicy<Body> {
    return new PasswordPolicy(file.path, file.body, "created");
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
    const value = minLength === undefined ? RECOMMENDED_PASSWORD_MIN_LENGTH : minLength;
    return PasswordPolicy.create({
      path: PasswordPolicy.PATH,
      body: {
        $schema: POLICY_FILE_SCHEMA_REF,
        operation: PASSWORD_POLICY_OPERATION,
        config: value === null ? {} : { min_length: value },
      },
    });
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
   * @throws {@link BrokenFilesError} When the policy contract refuses the body.
   */
  readMinLength(): number | undefined {
    return this.readConfig().min_length;
  }

  /**
   * The policy as saved: what it holds is now what the file holds.
   *
   * @returns The same policy, marked as read.
   */
  override asRead(): PasswordPolicy<Body> {
    return new PasswordPolicy(this.path, this.body, "read");
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
  withMinLength(minLength: PasswordMinLength | undefined): Edit<PasswordPolicy<Body>> {
    if (minLength === undefined || (minLength ?? undefined) === this.readMinLength()) {
      return { document: this, changed: false, skipped: [] };
    }
    const { min_length: _replaced, ...kept } = this.readConfig();
    const config = minLength === null ? kept : { ...kept, min_length: minLength };
    return {
      document: new PasswordPolicy(this.path, { ...this.body, config }, this.editedStatus),
      changed: true,
      skipped: [],
    };
  }
}
