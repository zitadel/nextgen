/**
 * Operation policies under `.zitadel/policies/`, the password policy `setup`
 * writes, and their test files.
 */
export { Policies } from "@/lib/zitadel/resources/policies/collection";
export { PasswordPolicy } from "@/lib/zitadel/resources/policies/password";
export { Policy } from "@/lib/zitadel/resources/policies/policy";
export { PolicyTest } from "@/lib/zitadel/resources/policies/suite";
export {
  PASSWORD_POLICY_OPERATION,
  POLICY_FILE_SUFFIX,
  POLICY_TEST_SUFFIX,
  type PasswordMinLength,
  type PolicyCase,
  type PolicyCaseResult,
  type PolicyConfig,
  type PolicyExpectation,
  type PolicyOperation,
  type PolicySelection,
  type PolicyVerdict,
} from "@/lib/zitadel/resources/policies/types";
