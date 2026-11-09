/**
 * The types and constants of operation policies and their test files under
 * `.zitadel/policies/`.
 *
 * @remarks
 * Imports no value from elsewhere in the library, so the root `types.ts` can
 * build the release's policy globs from the suffixes here.
 */

import type { policyConfigSchema, policyTestFileSchema } from "@zitadel/config/schemas";
import type { z } from "zod";

/**
 * The suffix of a policy file, which follows its operation in its name.
 */
export const POLICY_FILE_SUFFIX = ".json";

/**
 * The suffix that marks a policy's test file, which sits beside the policies.
 */
export const POLICY_TEST_SUFFIX = ".test.json";

/**
 * The name of the policy file of an operation.
 *
 * @typeParam Operation - The operation, as spelled.
 */
export type PolicyFileName<Operation extends string> = `${Operation}${typeof POLICY_FILE_SUFFIX}`;

/**
 * The name of the test file of an operation.
 *
 * @typeParam Operation - The operation, as spelled.
 */
export type PolicyTestFileName<Operation extends string> =
  `${Operation}${typeof POLICY_TEST_SUFFIX}`;

/**
 * The operation the password policy guards, which names its file.
 */
export const PASSWORD_POLICY_OPERATION = "auth.factor.password.set" satisfies PolicyOperation;

/**
 * A policy file as the policy contract takes it: the publish body plus the
 * editor-only `$schema` pointer.
 */
export type PolicyBody = z.infer<typeof policyConfigSchema>;

/**
 * An operation a policy guards.
 */
export type PolicyOperation = PolicyBody["operation"];

/**
 * The rules a policy holds its operation to.
 */
export type PolicyConfig = PolicyBody["config"];

/**
 * A policy test file as the policy test contract takes it.
 */
export type PolicyTestBody = z.infer<typeof policyTestFileSchema>;

/**
 * One case of a policy test file: an input, the facts it would look up, and
 * the decision it expects.
 */
export type PolicyCase = PolicyTestBody["cases"][number];

/**
 * The decision a case expects.
 */
export type PolicyExpectation = PolicyCase["expect"];

/**
 * A minimum password length as `setup` was given it.
 *
 * @remarks
 * A number, or `null` for an explicit "none" (an empty answer, or 0), which
 * is not the same as not being asked: a new policy gets the recommended
 * minimum when nothing was given, and a kept one loses its `min_length` on
 * "none" and keeps it when nothing was given.
 */
export type PasswordMinLength = number | null;

/**
 * The documents of some operations that are sound, and what is wrong with
 * the rest.
 *
 * @typeParam T - The kind of document.
 */
export type PolicySelection<T> = {
  /**
   * The documents with nothing wrong, in file order.
   */
  readonly documents: readonly T[];

  /**
   * One line per problem found, each naming its file.
   */
  readonly issues: readonly string[];
};
