/**
 * Operation policies under `.zitadel/policies/`, their test files, and the
 * password policy `setup` writes.
 */
export { Policies } from "@/lib/zitadel/resources/policies/collection";
export {
  PASSWORD_POLICY_PATH,
  parsePasswordMinLength,
  passwordPolicy,
} from "@/lib/zitadel/resources/policies/password";
export { Policy } from "@/lib/zitadel/resources/policies/policy";
export { PolicyTest } from "@/lib/zitadel/resources/policies/suite";
export {
  PASSWORD_POLICY_OPERATION,
  POLICY_FILE_SUFFIX,
  POLICY_TEST_SUFFIX,
  type PasswordMinLength,
  type PolicyBody,
  type PolicyCase,
  type PolicyConfig,
  type PolicyExpectation,
  type PolicyOperation,
  type PolicySelection,
  type PolicyTestBody,
} from "@/lib/zitadel/resources/policies/types";
