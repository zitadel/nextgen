import type { JsonObject } from "@/lib/zitadel";
import { PASSWORD_POLICY } from "@tests/helpers/config";

/**
 * The name the password policy's file must have under `.zitadel/policies/`.
 */
export const PASSWORD_POLICY_FILE = `${PASSWORD_POLICY}.json`;

/**
 * The name the password policy's test file must have under `.zitadel/policies/`.
 */
export const PASSWORD_POLICY_TEST_FILE = `${PASSWORD_POLICY}.test.json`;

/**
 * A case the policy test contract takes: a password expected to be refused for
 * being too short.
 */
export const TOO_SHORT_CASE = {
  name: "too short",
  input: { password: "short1" },
  expect: { allowed: false, violations: ["min_length"] },
};

/**
 * A test file of the password policy that the policy test contract takes.
 *
 * @param cases - The cases it holds.
 * @returns The test file's body.
 */
export function aPolicyTest(cases: readonly JsonObject[] = [TOO_SHORT_CASE]): JsonObject {
  return { operation: PASSWORD_POLICY, cases };
}
