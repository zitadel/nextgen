/**
 * Operation policies under `.zitadel/policies/`, the password and sign-up
 * policies `setup` writes, and their test files.
 */
export { Policies } from "@/lib/zitadel/resources/policies/collection";
export { PasswordPolicy } from "@/lib/zitadel/resources/policies/password";
export { Policy } from "@/lib/zitadel/resources/policies/policy";
export { SignupPolicy } from "@/lib/zitadel/resources/policies/signup";
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
  USER_CREATE_POLICY_OPERATION,
} from "@/lib/zitadel/resources/policies/types";
