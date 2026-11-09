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

import type { ContractValue } from "@/lib/zitadel/resources/document";

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
 * What a policy holds once the policy contract took its body.
 */
export type PolicyValue = ContractValue<typeof policyConfigSchema>;

/**
 * What a policy test file holds once the policy test contract took its body.
 */
export type PolicyTestValue = ContractValue<typeof policyTestFileSchema>;

/**
 * An operation a policy guards.
 */
export type PolicyOperation = PolicyValue["operation"];

/**
 * The rules a policy holds its operation to.
 */
export type PolicyConfig = PolicyValue["config"];

/**
 * A policy test file as the policy test contract takes it.
 */
export type PolicyTestBody = z.infer<typeof policyTestFileSchema>;

/**
 * One case of a policy test file: an input, the facts it would look up, and
 * the decision it expects.
 */
export type PolicyCase = PolicyTestValue["cases"][number];

/**
 * The decision a case expects.
 */
export type PolicyExpectation = PolicyCase["expect"];

/**
 * The decision the server reached for a case, as a case is held to it.
 *
 * @remarks
 * The shape of `POST /policies/evaluate`'s answer, spelled out here so the
 * library depends on nothing that talks to the server.
 */
export type PolicyVerdict = {
  /**
   * Whether the operation would go ahead.
   */
  readonly allowed: boolean;

  /**
   * The error code a refusal answers with, when it refuses.
   */
  readonly code?: string | undefined;

  /**
   * Every failed rule keyed by name, with the value of the setting it is
   * named after.
   */
  readonly violations?: Readonly<Record<string, unknown>> | undefined;
};

/**
 * One case's outcome: what it expected and what the server decided.
 */
export type PolicyCaseResult = {
  /**
   * The case's name.
   */
  readonly name: string;

  /**
   * Whether the decision is what the case expects.
   */
  readonly passed: boolean;

  /**
   * The decision the case expects.
   */
  readonly expected: PolicyExpectation;

  /**
   * The decision the server made.
   */
  readonly actual: PolicyVerdict;
};

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
