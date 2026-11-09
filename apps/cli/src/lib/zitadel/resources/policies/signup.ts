import { POLICY_FILE_SCHEMA_REF } from "@zitadel/config/meta-schemas";
import { DEFAULT_USER_CREATE_POLICY } from "@zitadel/config/schemas";

import type { BrokenFile } from "@/lib/zitadel/resources/broken";
import type { DocumentFile, ReadableFile } from "@/lib/zitadel/resources/document";
import { Policy } from "@/lib/zitadel/resources/policies/policy";
import {
  POLICY_FILE_SUFFIX,
  USER_CREATE_POLICY_OPERATION,
} from "@/lib/zitadel/resources/policies/types";
import { CONFIG_DIRECTORIES } from "@/lib/zitadel/types";

/**
 * The sign-up policy under `.zitadel/policies/`: the policy of the operation
 * that creates a user, which `setup` writes and keeps (ADR 087 §5).
 */
export class SignupPolicy extends Policy {
  /**
   * The operation the sign-up policy guards.
   */
  static readonly OPERATION = USER_CREATE_POLICY_OPERATION;

  /**
   * Where the sign-up policy lives, relative to the project root: the file
   * {@link Policy.fileName} names for its operation.
   */
  static readonly PATH =
    `${CONFIG_DIRECTORIES.policies}/${USER_CREATE_POLICY_OPERATION}${POLICY_FILE_SUFFIX}` as const;

  /**
   * Read a sign-up policy file: the policy, or the broken file it is.
   *
   * @param file - The file.
   * @returns The policy, marked as read, or the broken file.
   */
  static override read(file: ReadableFile): SignupPolicy | BrokenFile {
    return SignupPolicy.readFile(Policy.CONTRACT, file, (value, parsed) => {
      return new SignupPolicy(parsed, value, "read");
    });
  }

  /**
   * Take a sign-up policy as read.
   *
   * @param file - The file.
   * @returns The policy, marked as read.
   * @throws {@link BrokenFilesError} When the policy contract refuses the body.
   */
  static override of(file: DocumentFile): SignupPolicy {
    return new SignupPolicy(file, SignupPolicy.parseFile(Policy.CONTRACT, file), "read");
  }

  /**
   * A new sign-up policy, not yet written: saving it never replaces a file
   * already there.
   *
   * @param file - Where it goes, and what it holds.
   * @returns The policy, marked as created.
   * @throws {@link BrokenFilesError} When the policy contract refuses the body.
   */
  static override create(file: DocumentFile): SignupPolicy {
    return new SignupPolicy(file, SignupPolicy.parseFile(Policy.CONTRACT, file), "created");
  }

  /**
   * The sign-up policy `setup` writes for a new project.
   *
   * @remarks
   * The default, which restates the server's own protection: a proof of work
   * on every password or passkey sign-up. Deleting the file changes nothing,
   * because the server applies that protection without a policy.
   *
   * @returns A new policy at {@link PATH} holding the default's `config`.
   */
  static initial(): SignupPolicy {
    return SignupPolicy.create({
      path: SignupPolicy.PATH,
      body: {
        $schema: POLICY_FILE_SCHEMA_REF,
        operation: DEFAULT_USER_CREATE_POLICY.operation,
        config: { ...DEFAULT_USER_CREATE_POLICY.config },
      },
    });
  }
}
